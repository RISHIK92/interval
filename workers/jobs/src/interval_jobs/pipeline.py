"""The staged ingestion pipeline (ING-1, LOAD-3): discover, then fetch and extract, then
embed and tag, each stage a queue message (ADR-0014). Articles are not split
(ADR-0058): each is embedded, tagged and drafted questions for whole.

Every stage:
- checks the source's rights profile first (ING-2), so a message sent before a profile
  was lowered does nothing;
- is idempotent (LOAD-5): stores are upserts or replacements, so a redelivery or a
  duplicate changes nothing;
- runs in its own unit of work and enqueues the next stage only after it commits, so a
  later stage never sees uncommitted rows.
Discover keeps the feed's validators (conditional requests) only once its follow-ups are
queued: kept any earlier, a retry would get a 304 and the new entries would be lost.
A stage that raises is retried; after the third failure the message goes to the failed
store (the queue's job). Classify joins in W3-S02.

Normalize (Q-P1-08) runs inside discover and fetch: feed links arrive cleaned of
tracking parameters, fetch refines the canonical URL from the page and fingerprints
full text, and both link duplicates to the earliest-published item.
"""

import json
from collections.abc import Callable, Generator
from contextlib import AbstractContextManager, contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel

from interval_db.messages import (
    AgentNudge,
    AnswerInterviewer,
    Ask,
    BookCheckpoint,
    BookProcess,
    CheckLink,
    DiscoverSource,
    EmbedItem,
    FetchItem,
    GenerateQuestions,
    GithubSync,
    JudgeHld,
    LeaguePoints,
    MatchFinished,
    MessageName,
    OcrPage,
    PracticeJudged,
    ProjectNote,
    RateHldMatch,
    RecomputeFeed,
    RemoveFile,
    ReviewCode,
    TagItem,
    ValidateQuestion,
)
from interval_jobs import log
from interval_jobs.agent_push import NOTICE, deliver
from interval_jobs.ai.gateway import AiGateway, OverBudget
from interval_jobs.ask import MAX_PASSAGES, passage_body, relevant
from interval_jobs.ask import answer as ask_answer
from interval_jobs.books.checkpoint import (
    GAVE_UP as CHECKPOINT_GAVE_UP,
)
from interval_jobs.books.checkpoint import (
    NOT_CONFIGURED,
    CheckpointModels,
    make_checkpoint,
)
from interval_jobs.books.ocr import GAVE_UP, give_up, read_page
from interval_jobs.books.process import process_book
from interval_jobs.code_review import review as code_review
from interval_jobs.concept_vectors import concept_text, text_hash
from interval_jobs.embedding import embed_item
from interval_jobs.events.emitter import Emitter, EventContext
from interval_jobs.feed.precompute import recompute_user_feed
from interval_jobs.feed.project_notes import queue_project_notes, write_project_note
from interval_jobs.frameable import framed_at
from interval_jobs.github.sync import sync_user
from interval_jobs.hld_judge import JudgeInput
from interval_jobs.hld_judge import coach as hld_coach
from interval_jobs.hld_judge import judge as hld_judge
from interval_jobs.ingest.feed import NoValidEntryError, valid_entries
from interval_jobs.interviewer import answer as interviewer_answer
from interval_jobs.leagues import UTC_ZONE, credit_source, say_leagues
from interval_jobs.link_health import check_link
from interval_jobs.match_results import MatchResult, ResultsRedis, parse_result
from interval_jobs.normalize import page_canonical, simhash
from interval_jobs.polling import MIN_INTERVAL, next_interval
from interval_jobs.ports import (
    AskPassage,
    AskRequest,
    AskResult,
    ConceptGraph,
    Delivery,
    EventSink,
    Extractor,
    Fetcher,
    Files,
    GitHubApp,
    JobQueue,
    ModelError,
    Ocr,
    QuestionTarget,
    QueueHandler,
    RobotsDisallowed,
    SourceRecord,
    Store,
    TagInput,
    Validators,
    WebPush,
)
from interval_jobs.questions import PROMPT_VERSION as QUESTIONS_PROMPT_VERSION
from interval_jobs.questions import (
    QuestionReplyError,
    article_passage,
    content_hash,
    parse_answer,
    parse_reply,
    passage_chars,
    passage_with,
    prompt,
    question_count,
    shuffled,
    validation_prompt,
)
from interval_jobs.queue import ATTEMPTS
from interval_jobs.rights import EXCERPT_MAX_CHARS, allowed
from interval_jobs.tagging import (
    DECISIONS_PREFIX,
    PROMPT_VERSION,
    TaggingError,
    active_concepts,
    tag_item,
)
from interval_jobs.tagging_decide import decide
from interval_jobs.tagging_rollup import rollup

# Every queue the consumer serves: ingestion in the order an item moves through it,
# then the per-user feed recompute (CACHE-1, P1-W4-S04), its project lines (P2-W12-S05),
# and the weekly link health check (P1-W6-S03).
STAGES: tuple[MessageName, ...] = (
    "discover_source",
    "fetch_item",
    "tag_item",
    "embed_item",
    "recompute_feed",
    "check_link",
    "generate_questions",
    "validate_question",
    "remove_file",
    "book_process",
    "ocr_page",
    "book_checkpoint",
    "github_sync",
    "project_note",
)

# Q-P2-10: the free question model is an unimportant background task. A rate limit or
# a model error waits this long and tries again, without end (the queue's own retries,
# ATTEMPTS, would give up); a reply that breaks a rule does too, up to
# QUESTION_BROKEN_REPLIES times, so an article the model can't do doesn't spend the free
# tier's daily requests forever. Config and infrastructure errors still raise.
QUESTION_RETRY_SECONDS = 300
# Q-P2-13: QUESTIONS_MODEL=batch:<model> drafts and validates through the provider's
# batch API (question_batches.py) instead of one call per article here.
BATCH_PREFIX = "batch:"


def notes_batched(notes_model: str | None, questions_model: str | None) -> bool:
    """Q-P2-46: project notes ride the question batches only when both models are
    batched and the same (a batch holds one model); otherwise they're direct calls."""
    return (
        notes_model is not None
        and notes_model.startswith(BATCH_PREFIX)
        and notes_model == questions_model
    )


QUESTION_BROKEN_REPLIES = 5
# A retry this far past due was lost (a flushed queue): a fresh start is taken.
QUESTION_RETRY_LOST = timedelta(minutes=30)


@dataclass(frozen=True)
class StageServices:
    store: Store
    fetcher: Fetcher
    extractor: Extractor


type UnitOfWork = Callable[[], AbstractContextManager[StageServices]]


@dataclass(frozen=True)
class ModelJob:
    """A model-backed stage (tagging P1-W3-S02, embeddings P1-W3-S04): the model its
    eval picked, and a gateway per call (its ledger connection commits on its own,
    OPS-4)."""

    model: str
    gateway: Callable[[], AbstractContextManager[AiGateway]]


type Next = tuple[MessageName, dict[str, object], str]
# The feed URL and what it answered with; None when nothing is to be kept.
type Answered = tuple[str, Validators | None] | None


def question_passage(store: Store, target: QuestionTarget | None) -> str:
    """A question target's passage, as drafting reads it (ADR-0058); empty when there
    is none (the rights or the tags no longer allow it, ING-2)."""
    if target is None:
        return ""
    item = store.tags.input(target.item_id)
    if item is None or item.full_text is None:
        return ""
    return article_passage(item.full_text, question_count(target.sections))


def cited_passage(store: Store, target: QuestionTarget | None, citation: str) -> str:
    """The passage a drafted question is validated (or its stem rewritten) against:
    drafting's, or as long around the words it cites (a question drafted for one of
    the article's moments may cite past it); empty as question_passage is."""
    if target is None:
        return ""
    item = store.tags.input(target.item_id)
    if item is None or item.full_text is None:
        return ""
    chars = passage_chars(question_count(target.sections))
    return passage_with(item.full_text, chars, citation)


class Pipeline:
    def __init__(
        self,
        unit_of_work: UnitOfWork,
        queue: JobQueue,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
        tagging: ModelJob | None = None,
        embedding: ModelJob | None = None,
        max_entries: int | None = None,
        notes: ModelJob | None = None,
        questions: ModelJob | None = None,
        files: Files | None = None,
        ocr: Ocr | None = None,
        github: GitHubApp | None = None,
        results: ResultsRedis | None = None,
        push: WebPush | None = None,
        events: EventSink | None = None,
        ask: ModelJob | None = None,
        league_zone: ZoneInfo = UTC_ZONE,
    ) -> None:
        self._unit = unit_of_work
        # ADR-0045: the leagues' week and day (BATTLE_WINDOW_TIME_ZONE).
        self._league_zone = league_zone
        # ADR-0046: ASK_MODEL; None answers every question as unavailable.
        self._ask = ask
        # DB-5: where a stage's events go; None writes none (a stage's own tests).
        self._events = events
        # P3-W17-S05b: None without VAPID keys; agent nudges are then skipped.
        self._push = push
        # P3-W15-S05: where game servers leave match results (Valkey).
        self._results = results
        # DB-6: None when file storage isn't configured; a removal then fails, retried.
        self._files = files
        # ADR-0022: None when OCR_URL isn't set; a scanned page then waits, retried.
        self._ocr = ocr
        # ADR-0024: None without the App's id and key; reads are then skipped.
        self._github = github
        self._queue = queue
        self._clock = clock
        self._tagging = tagging
        self._embedding = embedding
        # Only for a one-off local run (consume --max-entries); polls take whole feeds.
        self._max_entries = max_entries
        self._notes = notes
        self._questions = questions

    def handlers(self) -> dict[MessageName, QueueHandler]:
        return {
            "discover_source": self._discover_stage,
            "fetch_item": self._stage(self._fetch),
            "tag_item": self._tag_stage,
            "embed_item": self._embed_stage,
            "recompute_feed": self._recompute_stage,
            "check_link": self._stage(self._check_link),
            "generate_questions": self._questions_stage,
            "validate_question": self._validate_stage,
            "remove_file": self._remove_file_stage,
            "book_process": self._book_stage,
            "ocr_page": self._ocr_stage,
            "book_checkpoint": self._book_checkpoint_stage,
            "github_sync": self._github_stage,
            "project_note": self._project_note_stage,
            "match_finished": self._match_stage,
            "practice_judged": self._practice_stage,
            "agent_nudge": self._nudge_stage,
            "answer_interviewer": self._interviewer_stage,
            "review_code": self._review_stage,
            "judge_hld": self._hld_judge_stage,
            "rate_hld_match": self._hld_rate_stage,
            "ask": self._ask_stage,
            "league_points": self._league_stage,
        }

    # ADR-0045: one source's weekly league points, once per player (LOAD-5); a
    # player's first points of the week place them, said after the commit (DB-5).
    def _league_stage(self, message: BaseModel, delivery: Delivery) -> None:
        assert isinstance(message, LeaguePoints)
        with self._unit() as services:
            placed = credit_source(
                services.store.leagues,
                message.source_kind,
                message.source_id,
                self._league_zone,
            )
        if self._events is not None:
            say_leagues(self._events, [], placed)

    # P5-W35 (§6.5, Q-P5-14, Q-P5-22): a battle player's AI code review, on request:
    # their best submission from the bucket, QUESTIONS_MODEL through the gateway.
    def _review_stage(self, message: BaseModel, delivery: Delivery) -> None:
        assert isinstance(message, ReviewCode)
        match_id, user_id = message.match_id, message.user_id

        def unavailable(reason: str) -> None:
            # Only a pending request changes: shown as unavailable, never waiting.
            log.warn("battle: review not written", match_id=match_id, reason=reason)
            with self._unit() as services:
                services.store.reviews.save(match_id, user_id, None, None)

        with self._unit() as services:
            ask = services.store.reviews.to_review(match_id, user_id)
        if ask is None:
            # Written already (a redelivery: save changes nothing then), or its best
            # submission is gone (pruned): a pending request is told so.
            unavailable("nothing to review")
            return
        if self._questions is None or self._files is None:
            unavailable("no model" if self._questions is None else "no bucket")
            return
        model = self._questions.model.removeprefix(BATCH_PREFIX)
        try:
            stored = self._files.get(ask.key)
            if stored is None:
                unavailable("code gone")
                return
            code = str(json.loads(stored)["code"])
            with self._questions.gateway() as gateway:
                written = code_review(
                    gateway, model, user_id, ask.statement, ask.language, code
                )
            if isinstance(written, OverBudget):
                # OPS-4, LOAD-5: over budget, said and shown as unavailable.
                log.warn("battle: review over budget", match_id=match_id)
                written = None
            with self._unit() as services:
                services.store.reviews.save(
                    match_id, user_id, written, model if written is not None else None
                )
        except Exception:
            # Retried by the queue; on its last try the player is told, not left
            # waiting.
            if delivery.attempt >= ATTEMPTS:
                unavailable("failed")
            raise

    # P6-W41 (CANVAS-6, §6.4, Q-P6-05): an HLD design's rubric levels (the median of 3)
    # and the coach's advice, on request, QUESTIONS_MODEL through the gateway. A design
    # that fails the baseline earns no rubric points (§6.4), so it's only coached.
    def _hld_judge_stage(self, message: BaseModel, delivery: Delivery) -> None:
        assert isinstance(message, JudgeHld)
        judgement_id = message.judgement_id

        def unavailable(reason: str) -> None:
            # Only a pending request changes: shown as unavailable, never waiting.
            log.warn("hld: judgement not written", id=judgement_id, reason=reason)
            with self._unit() as services:
                services.store.hld_judgements.save(judgement_id, None, None, None)

        with self._unit() as services:
            ask = services.store.hld_judgements.to_judge(judgement_id)
        if ask is None:
            return  # written already (a redelivery), or gone with its player
        if self._questions is None:
            unavailable("no model")
            return
        model = self._questions.model.removeprefix(BATCH_PREFIX)
        try:
            design = JudgeInput.model_validate_json(ask.input)
        except ValueError:
            # The web app wrote it from the same schema: retrying won't mend it.
            unavailable("malformed input")
            return
        try:
            with self._questions.gateway() as gateway:
                levels = (
                    hld_judge(gateway, model, ask.user_id, design)
                    if ask.baseline_passed
                    else None
                )
                over = isinstance(levels, OverBudget)
                if isinstance(levels, OverBudget):
                    # OPS-4, LOAD-5: over budget, said and shown as unavailable; the
                    # coach would be too.
                    log.warn("hld: judge over budget", id=judgement_id)
                    levels = None
                elif ask.baseline_passed and levels is None:
                    log.warn("hld: no valid judge run", id=judgement_id)
                advice = (
                    None if over else hld_coach(gateway, model, ask.user_id, design)
                )
                if isinstance(advice, OverBudget):
                    log.warn("hld: coach over budget", id=judgement_id)
                    advice = None
            with self._unit() as services:
                services.store.hld_judgements.save(
                    judgement_id,
                    None
                    if levels is None
                    else {k: v.model_dump() for k, v in levels.items()},
                    advice,
                    model if levels is not None or advice is not None else None,
                )
        except Exception:
            # Retried by the queue; on its last try the player is told, not left
            # waiting.
            if delivery.attempt >= ATTEMPTS:
                unavailable("failed")
            raise

    # ADR-0046 (AI-1, AI-3, ING-2, OPS-4): an Explore question, answered from the
    # user's catalogue: the question embedded (EMBEDDING_MODEL), the nearest passages,
    # each read as its rights allow, then one ASK_MODEL call, validated before it's
    # stored. Nothing relevant: no model is called.
    def _ask_stage(self, message: BaseModel, delivery: Delivery) -> None:
        assert isinstance(message, Ask)
        question_id = message.question_id
        with self._unit() as services:
            request = services.store.ask.to_answer(question_id)
        if request is None:
            return  # answered already (a redelivery), or deleted or purged
        try:
            result = self.answer(request)
        except Exception:
            # Retried by the queue; on its last try the user is told, not left waiting.
            if delivery.attempt >= ATTEMPTS:
                self._ask_done(request, AskResult("unavailable"))
            raise
        self._ask_done(request, result)

    def answer(self, request: AskRequest) -> AskResult:
        """An answer, not stored: the stage's, and the Ask eval's (AI-5)."""
        if self._ask is None or self._embedding is None:
            log.warn(
                "ask: no model",
                question_id=request.question_id,
                missing="ASK_MODEL" if self._ask is None else "EMBEDDING_MODEL",
            )
            return AskResult("unavailable")
        with self._embedding.gateway() as gateway:
            embedded = gateway.embed(
                feature="ask",
                user_id=request.user_id,
                model=self._embedding.model,
                texts=[request.text],
                purpose="query",
            )
        if isinstance(embedded, OverBudget):
            return AskResult("over_budget")
        with self._unit() as services:
            found = services.store.ask.nearest(
                request.user_id,
                embedded.vectors[0],
                self._embedding.model,
                MAX_PASSAGES,
            )
            passages = relevant(found)
            bodies = {
                p.passage: passage_body(p, self._article_text(services.store, p))
                for p in passages
            }
        if not passages:
            return AskResult("nothing_found", cost_usd=embedded.usage.cost_usd)
        model = self._ask.model.removeprefix(BATCH_PREFIX)
        with self._ask.gateway() as gateway:
            result = ask_answer(gateway, model, request, passages, bodies)
        if result.cost_usd is None:
            return result
        return AskResult(
            result.outcome,
            result.text,
            result.citations,
            result.model,
            result.prompt_version,
            result.cost_usd + embedded.usage.cost_usd,
            result.refused,
        )

    @staticmethod
    def _article_text(store: Store, p: AskPassage) -> str | None:
        # Full text is read here, in the worker, and only for an article of a source
        # whose rights allow it (ING-2); passage_body decides what the model sees.
        if p.kind != "item" or p.item_id is None:
            return None
        if p.rights_profile not in ("full_text_internal", "full_text_display"):
            return None
        item = store.tags.input(p.item_id)
        return None if item is None else item.full_text

    def _ask_done(self, request: AskRequest, result: AskResult) -> None:
        with self._unit() as services:
            saved = services.store.ask.save(request.question_id, result)
        log.info("ask: done", question_id=request.question_id, outcome=result.outcome)
        if not saved or self._events is None:
            return
        # After the commit, so a redelivery that finds it saved says nothing.
        events = Emitter(self._events)
        events.emit(
            "ask_answered",
            {
                "outcome": result.outcome,
                "citation_count": len(result.citations),
                "cost_micro_usd": int((result.cost_usd or 0) * 1_000_000),
            },
            EventContext(request.user_id, request.is_guest, request.beta_group, None),
        )
        events.flush()

    # P6-W42 (MATCH-1, Q-P6-06, ADR-0043): a scored HLD match's ratings, by its places.
    def _hld_rate_stage(self, message: BaseModel, delivery: Delivery) -> None:
        assert isinstance(message, RateHldMatch)
        with self._unit() as services:
            if services.store.hld_matches.rate(message.match_id):
                log.info("hld: match rated", match_id=message.match_id)

    def _interviewer_stage(self, message: BaseModel, delivery: Delivery) -> None:
        assert isinstance(message, AnswerInterviewer)
        with self._unit() as services:
            ask = services.store.interviewer.to_answer(message.question_id)
        if ask is None:
            return  # answered already (a redelivery), or gone with its match
        if self._questions is None:
            # The player isn't left waiting: said unanswered, and logged.
            log.warn("interviewer: no model", question_id=message.question_id)
            with self._unit() as services:
                services.store.interviewer.save(message.question_id, None, None)
            return
        model = self._questions.model.removeprefix(BATCH_PREFIX)
        try:
            with self._questions.gateway() as gateway:
                replied = interviewer_answer(gateway, model, ask)
        except Exception:
            # Retried by the queue; on its last try the player is told, not left
            # waiting on a question that will never be answered.
            if delivery.attempt >= ATTEMPTS:
                with self._unit() as services:
                    services.store.interviewer.save(message.question_id, None, None)
            raise
        if isinstance(replied, OverBudget):
            # OPS-4, LOAD-5: over budget, said and shown as unanswered.
            log.warn(
                "interviewer: over budget",
                question_id=message.question_id,
                scope=replied.scope,
            )
            replied = None
        with self._unit() as services:
            services.store.interviewer.save(
                message.question_id, replied, model if replied is not None else None
            )

    # P3-W17-S05b (§7, Q-P3-18): 45 s into an agent's task, a push if it still runs.
    # The pushes go out between two short units: no transaction waits on the network.
    def _nudge_stage(self, message: BaseModel, delivery: Delivery) -> None:
        assert isinstance(message, AgentNudge)
        if self._push is None:
            log.info("agent: nudge skipped", reason="push not configured")
            return
        with self._unit() as services:
            targets = services.store.agent_nudges.targets(
                message.task_id, self._clock()
            )
        if targets is None:
            log.info("agent: nudge skipped", reason="task not running")
            return
        delivered = deliver(self._push, targets, NOTICE)
        if delivered.gone:
            with self._unit() as services:
                for endpoint in delivered.gone:
                    services.store.agent_nudges.drop(endpoint)
        log.info(
            "agent: nudge",
            task_id=message.task_id,
            sent=delivered.sent,
            dropped=len(delivered.gone),
            failed=delivered.failed,
        )

    # P3-W15-S05 (ADR-0033): a live match's result, from Valkey, recorded once.
    def _match_stage(self, message: BaseModel, delivery: Delivery) -> None:
        assert isinstance(message, MatchFinished)
        if self._results is None:
            raise RuntimeError("match results need VALKEY_URL")
        raw = self._results.get(f"game:result:{message.match_id}")
        if raw is None:
            # Gone (a day passed, or never written): nothing to record, and retrying
            # won't bring it back.
            log.error("game: result missing", match_id=message.match_id)
            return
        result = parse_result(raw)
        if result is None:
            return
        if str(result.match_id) != message.match_id:
            log.error("game: result refused", reason="another match's result")
            return
        with self._unit() as services:
            recorded = services.store.match_results.record(result)
        log.info("game: result", match_id=message.match_id, recorded=recorded)
        # ADR-0045: its league points, on every delivery too (the ledger scores a
        # source once).
        self._queue.enqueue(
            "league_points",
            {"source_kind": "match", "source_id": message.match_id},
            idempotency_key=f"league-match-{message.match_id}",
        )
        # Every delivery, not only the first recording: a retry after a crash between
        # the two still keeps them (rows on conflict do nothing; the same object).
        self._keep_bests(result)

    # ADR-0048 (Q-WD-28): one judged LLD practice Submit, counted once and kept when it
    # beats the player's best.
    def _practice_stage(self, message: BaseModel, delivery: Delivery) -> None:
        assert isinstance(message, PracticeJudged)
        with self._unit() as services:
            kept = services.store.lld_practice.keep(message)
        log.info(
            "game: practice progress",
            match_id=message.match_id,
            seq=message.seq,
            kept=kept is not None,
        )
        if kept is None or self._events is None:
            return
        # After the commit, so a Submit counted is said once: a redelivery finds it
        # counted and says nothing.
        events = Emitter(self._events)
        events.emit(
            "lld_practice_submitted",
            {
                "problem_slug": message.problem_slug,
                "points": message.points,
                "hidden_passed": message.hidden_passed,
                "hidden_total": message.hidden_total,
                "extension_revealed": message.extension_revealed,
                "improved": kept.improved,
            },
            EventContext(kept.user_id, kept.is_guest, kept.beta_group, None),
        )
        events.flush()

    # P5-W35 (Q-P5-22): each battle player's best submission into the private bucket,
    # for the AI code review; the object first, then its row, so pruning finds it.
    def _keep_bests(self, result: MatchResult) -> None:
        bests = [(p.played_as, p.best) for p in result.players if p.best is not None]
        if not bests:
            return
        if self._files is None:
            log.warn("game: bests not kept", reason="no PRIVATE_CONTENT_BUCKET")
            return
        match_id = str(result.match_id)
        with self._unit() as services:
            users = services.store.match_results.players_of(match_id)
        for played_as, best in bests:
            user = users.get(played_as)
            if user is None:
                continue
            key = f"battle-best/{match_id}/{user}.json"
            self._files.put(
                key,
                json.dumps({"language": best.language, "code": best.code}).encode(),
                "application/json",
            )
            with self._unit() as services:
                services.store.match_results.save_best(
                    match_id, user, best.language, key
                )

    # P2-W11-S02: an uploaded PDF read into chapters and sessions.
    def _book_stage(self, message: BaseModel, delivery: Delivery) -> None:
        assert isinstance(message, BookProcess)
        if self._files is None:
            raise RuntimeError("file storage isn't configured (PRIVATE_CONTENT_BUCKET)")
        with self._unit() as services:
            scanned = process_book(services.store, self._files, message.book_id)
        # After the commit, so each page job finds the book waiting for it.
        self._enqueue(
            [
                (
                    "ocr_page",
                    {"book_id": message.book_id, "page_no": page_no},
                    f"ocr-{message.book_id}-{page_no}",
                )
                for page_no in scanned
            ]
        )

    # P2-W11-S03 (ADR-0022): a scanned page read by the OCR service. On the last
    # attempt nothing leaves the book waiting for ever: an OCR error records the page
    # empty (read_page); anything else (OCR or files not configured, storage, the
    # database) fails the book with a reason. Both are logged and counted.
    def _ocr_stage(self, message: BaseModel, delivery: Delivery) -> None:
        assert isinstance(message, OcrPage)
        last_attempt = delivery.attempt >= ATTEMPTS

        @contextmanager
        def stores() -> Generator[Store]:
            with self._unit() as services:
                yield services.store

        try:
            if self._files is None or self._ocr is None:
                raise RuntimeError(
                    "OCR isn't configured (PRIVATE_CONTENT_BUCKET, OCR_URL)"
                )
            read_page(
                stores,
                self._files,
                self._ocr,
                message.book_id,
                message.page_no,
                last_attempt,
            )
        except Exception as error:
            if not last_attempt:
                raise
            log.error(
                "books: ocr gave up",
                book_id=message.book_id,
                page_no=message.page_no,
                error=type(error).__name__,
            )
            give_up(stores, message.book_id, GAVE_UP)

    # P2-W11-S06 (Q-P2-35): a chapter's checkpoint, made when the user reaches its end.
    # A model error is retried by the queue; on the last attempt the checkpoint fails
    # with a reason rather than preparing for ever, logged and offered again.
    def _book_checkpoint_stage(self, message: BaseModel, delivery: Delivery) -> None:
        assert isinstance(message, BookCheckpoint)

        @contextmanager
        def stores() -> Generator[Store]:
            with self._unit() as services:
                yield services.store

        models = self._checkpoint_models()
        if models is None:
            # Configuration, not a passing fault: no retry would help.
            log.error(
                "books: checkpoints need TAGGING_MODEL (decisions:), EMBEDDING_MODEL "
                "and QUESTIONS_MODEL",
                chapter_id=message.chapter_id,
            )
            with stores() as store:
                store.books.fail_checkpoint(message.chapter_id, NOT_CONFIGURED)
            return
        try:
            make_checkpoint(stores, models, message.chapter_id)
        except Exception as error:
            if delivery.attempt < ATTEMPTS:
                raise
            log.error(
                "books: checkpoint gave up",
                chapter_id=message.chapter_id,
                error=type(error).__name__,
            )
            with stores() as store:
                store.books.fail_checkpoint(message.chapter_id, CHECKPOINT_GAVE_UP)

    def _checkpoint_models(self) -> CheckpointModels | None:
        tagging, embedding, questions = self._tagging, self._embedding, self._questions
        if (
            tagging is None
            or embedding is None
            or questions is None
            or not tagging.model.startswith(DECISIONS_PREFIX)
        ):
            return None
        return CheckpointModels(
            tagger=tagging.model.removeprefix(DECISIONS_PREFIX),
            embedding=embedding.model,
            # On demand: the batch tier's results come too late (Q-P2-13).
            questions=questions.model.removeprefix(BATCH_PREFIX),
            gateway=questions.gateway,
        )

    # P2-W12-S02 (§5H, ADR-0024): a connected user's repositories read. A rate limit
    # or GitHub failing raises for the queue to retry; a missing App is configuration.
    def _github_stage(self, message: BaseModel, delivery: Delivery) -> None:
        assert isinstance(message, GithubSync)
        if self._github is None:
            log.error(
                "github: sync skipped; the App isn't configured",
                user_id=message.user_id,
            )
            return

        @contextmanager
        def stores() -> Generator[Store]:
            with self._unit() as services:
                yield services.store

        # P2-W12-S04: the feed's project picks follow what was read, after the commit.
        if sync_user(stores, self._github, message.user_id) is not None:
            self._queue.enqueue(
                "recompute_feed",
                {"user_id": message.user_id},
                idempotency_key=f"recompute-{delivery.idempotency_key}",
            )

    # P2-W11-S01 (LOAD-5): a deleted book's file, removed with the queue's retries.
    # Only under books/: the message names a key, and nothing else is the user's to
    # delete.
    def _remove_file_stage(self, message: BaseModel, delivery: Delivery) -> None:
        assert isinstance(message, RemoveFile)
        if not message.key.startswith("books/") or ".." in message.key:
            log.error("files: removal refused", key=message.key)
            return
        if self._files is None:
            raise RuntimeError("file storage isn't configured (PRIVATE_CONTENT_BUCKET)")
        self._files.remove(message.key)

    def _stage(
        self, work: Callable[[StageServices, BaseModel], list[Next]]
    ) -> QueueHandler:
        def handle(message: BaseModel, delivery: Delivery) -> None:
            with self._unit() as services:
                follow_ups = work(services, message)
            self._enqueue(follow_ups)

        return handle

    def _enqueue(self, follow_ups: list[Next]) -> None:
        # After the commit: the next stage must see this stage's rows.
        for name, payload, key in follow_ups:
            self._queue.enqueue(name, payload, idempotency_key=key)

    def _recompute_stage(self, message: BaseModel, delivery: Delivery) -> None:
        assert isinstance(message, RecomputeFeed)
        # Similarity candidates need the embedding model in use; none while it is off.
        model = self._embedding.model if self._embedding else None
        with self._unit() as services:
            done = recompute_user_feed(
                services.store, message.user_id, model, self._clock()
            )
        # After the commit, so the stage sees the feed. Nothing while notes are off
        # (ADR-0025: the model writes project lines only), nor when they ride the
        # question batches (Q-P2-46).
        if self._notes is not None and not self._notes_batched():
            queue_project_notes(self._queue, message.user_id, done.project_notes)

    def _notes_batched(self) -> bool:
        return notes_batched(
            self._notes.model if self._notes else None,
            self._questions.model if self._questions else None,
        )

    # P2-W12-S05 (§5B, OPS-4): the user's line on why an item matters to their
    # project. Read, call with no transaction open, then store.
    def _project_note_stage(self, message: BaseModel, delivery: Delivery) -> None:
        assert isinstance(message, ProjectNote)
        if self._notes is None:
            log.info("pipeline: notes are off (no model)", user_id=message.user_id)
            return
        if self._notes_batched():
            # Q-P2-46: a job queued before the switch; the batches write it now.
            log.info("pipeline: project notes are batched", user_id=message.user_id)
            return
        user_id, item_id = message.user_id, message.content_item_id
        with self._unit() as services:
            if not services.store.github.project_notes_missing(user_id, [item_id], 1):
                return  # written already, or the item no longer matches
            note = services.store.github.project_note_input(user_id, item_id)
        if note is None:
            return
        # Direct calls take the bare model: "batch:" means nothing to the gateway.
        model = self._notes.model.removeprefix(BATCH_PREFIX)
        with self._notes.gateway() as gateway:
            text = write_project_note(gateway, model, user_id, note)
        if isinstance(text, OverBudget):
            # OPS-4, LOAD-5: the line is left out, observably; a later recompute that
            # shows the item asks again.
            log.warn("project notes: over budget", user_id=user_id, scope=text.scope)
            return
        # A refused reply (None) is recorded too: not paid for again for this set.
        with self._unit() as services:
            services.store.github.save_project_note(user_id, item_id, note, text, model)

    def _discover_stage(self, message: BaseModel, delivery: Delivery) -> None:
        with self._unit() as services:
            follow_ups, answered = self._discover(services, message)
        self._enqueue(follow_ups)
        if answered is not None:
            with self._unit() as services:
                services.store.validators.put(*answered)

    def _discover(
        self, services: StageServices, message: BaseModel
    ) -> tuple[list[Next], Answered]:
        assert isinstance(message, DiscoverSource)
        store = services.store
        source = store.sources.get(message.source_id)
        if source is None or not source.active:
            log.info("pipeline: source skipped", source_id=message.source_id)
            return [], None
        store.items.hold_duplicate_lock()
        follow_ups, answered, new_items = self._poll(services, source)
        # ING-3: a poll that raised keeps the turn poll-due claimed, one interval on.
        # Adapt once per turn: a retry, a duplicate delivery or a manual
        # enqueue-discover soon after would otherwise find nothing new and back off.
        now = self._clock()
        if source.polled_at is None or now - source.polled_at >= MIN_INTERVAL:
            interval = next_interval(source.poll_interval, new_items)
            store.sources.record_poll(source.id, interval, now)
        return follow_ups, answered

    def _poll(
        self, services: StageServices, source: SourceRecord
    ) -> tuple[list[Next], Answered, int]:
        """The follow-ups, the validators to keep, and how many entries were new."""
        store = services.store
        known = store.validators.get(source.feed_url)
        try:
            feed = services.fetcher.fetch_if_changed(source.feed_url, "feed", known)
        except RobotsDisallowed:
            log.info("pipeline: robots.txt disallows the feed", source_id=source.id)
            return [], None, 0
        if feed is None:
            return [], None, 0  # 304: nothing new since the last poll
        answered: Answered = (source.feed_url, feed.validators)
        try:
            entries = valid_entries(feed.body, feed.url)
        except NoValidEntryError:
            # Permanent until the publisher fixes it: retrying (and filling the
            # failed store on every poll) wouldn't help.
            log.warn("pipeline: feed has no valid entry", source_id=source.id)
            return [], answered, 0
        if self._max_entries is not None:
            entries = sorted(
                entries,
                key=lambda e: (
                    e.published_at or e.updated_at or datetime.min.replace(tzinfo=UTC)
                ),
                reverse=True,
            )[: self._max_entries]
        seen = store.items.known_guids(source.id, [e.guid for e in entries])
        new_items = sum(1 for e in entries if e.guid not in seen)
        profile = source.rights_profile
        keep_excerpt = allowed(profile, "store_excerpt")
        follow_ups: list[Next] = []
        for entry in entries:
            item_id = store.items.upsert_from_feed(source.id, entry, keep_excerpt)
            store.items.link_duplicates(item_id)
            if not allowed(profile, "fetch_body"):
                follow_ups.extend(self._tag_if_needed(store, item_id))
                continue
            # Fetch once: not again when what the profile keeps is already stored.
            if not store.items.has_body(item_id):
                follow_ups.append(
                    ("fetch_item", {"content_item_id": item_id}, f"fetch-{item_id}")
                )
            # Tagging or embedding that failed or was over budget is retried on the
            # next poll.
            else:
                follow_ups.extend(self._tag_if_needed(store, item_id))
                follow_ups.extend(self._embed_if_needed(store, item_id))
        return follow_ups, answered, new_items

    def _check_link(self, services: StageServices, message: BaseModel) -> list[Next]:
        assert isinstance(message, CheckLink)
        check_link(
            services.store, services.fetcher, message.content_item_id, self._clock()
        )
        return []

    def _fetch(self, services: StageServices, message: BaseModel) -> list[Next]:
        assert isinstance(message, FetchItem)
        store, item_id = services.store, message.content_item_id
        item = store.items.for_fetch(item_id)
        if item is None or not allowed(item.rights_profile, "fetch_body"):
            log.info("pipeline: fetch skipped by rights", content_item_id=item_id)
            return []
        store.items.hold_duplicate_lock()
        # The page stays in memory: only what the profile allows is stored (ING-2).
        try:
            article = services.fetcher.fetch(item.canonical_url, "article")
        except RobotsDisallowed:
            # The publisher's choice, not a failure: no retry, nothing stored.
            log.info(
                "pipeline: robots.txt disallows the article", content_item_id=item_id
            )
            return []
        text = services.extractor.text(article.body, article.encoding)
        canonical = page_canonical(article.body, article.encoding, article.url)
        store.items.set_canonical(item_id, canonical)
        # ADR-0018: known from this fetch's headers, before any weekly check, for the
        # address the reader will frame.
        if article.frameable is not None:
            store.items.set_frameable(
                item_id, framed_at(canonical, headers_allow=article.frameable)
            )
        follow_ups: list[Next] = []
        if allowed(item.rights_profile, "store_full_text"):
            store.items.store_full_text(item_id, text)
            store.items.replace_sections(
                item_id,
                services.extractor.sections(article.body, article.encoding, item.title),
            )
            fingerprint = simhash(text)
            if fingerprint is not None:
                store.items.set_simhash(item_id, fingerprint)
            # Embedded, then tagged; it reaches users' feeds at each user's next
            # recompute (hourly, or after feedback, Q-P1-17).
            follow_ups.extend(
                self._embed_if_needed(store, item_id)
                or self._tag_if_needed(store, item_id)
            )
        elif allowed(item.rights_profile, "store_excerpt"):
            store.items.set_excerpt(item_id, text[:EXCERPT_MAX_CHARS])
            follow_ups.extend(self._tag_if_needed(store, item_id))
        store.items.link_duplicates(item_id)
        return follow_ups

    def _embed_if_needed(self, store: Store, item_id: int) -> list[Next]:
        job = self._embedding
        if job is None or not store.embeddings.missing(item_id, job.model):
            return []
        return [("embed_item", {"content_item_id": item_id}, f"embed-{item_id}")]

    def _embed_stage(self, message: BaseModel, delivery: Delivery) -> None:
        """Like tagging: read, call the model outside any transaction, then save only
        if the article's text didn't change meanwhile."""
        assert isinstance(message, EmbedItem)
        item_id, job = message.content_item_id, self._embedding
        if job is None:
            log.info("pipeline: embeddings are off (no model)", content_item_id=item_id)
            return
        with self._unit() as services:
            item = services.store.tags.input(item_id)
            missing = services.store.embeddings.missing(item_id, job.model)
            then = self._tag_if_needed(services.store, item_id)
        # Once per item and model (AI-4); duplicates aren't shown, so not embedded.
        if item is None or not missing:
            self._enqueue(then)
            return
        with job.gateway() as gateway:
            embedded = embed_item(gateway, job.model, item)
        if embedded.refused is not None:
            # LOAD-5: degrade, observably; the next poll embeds it.
            log.warn(
                "pipeline: embedding over budget",
                content_item_id=item_id,
                scope=embedded.refused.scope,
            )
        elif embedded.vector is not None:
            with self._unit() as services:
                now = services.store.tags.input(item_id)
                if now is None or now.full_text != item.full_text:
                    log.info(
                        "pipeline: text changed; vector dropped",
                        content_item_id=item_id,
                    )
                    return
                services.store.embeddings.save(item_id, embedded.vector, job.model)
        self._enqueue(then)

    def _questions_for(self, store: Store, item_id: int) -> list[Next]:
        """Q-P2-09: a tagged full-text article's questions, once tagging saved its
        tags; drafting skips an article whose text and prompt are unchanged (AI-4). In
        batch mode (Q-P2-13) the batch commands draft instead."""
        if self._questions is None or self._questions.model.startswith(BATCH_PREFIX):
            return []
        return [questions_job(target) for target in store.questions.targets(item_id)]

    def _questions_stage(self, message: BaseModel, delivery: Delivery) -> None:
        """Q-1: draft a tagged article's questions (P2-W8-S01). Read, call the model
        with no transaction open, then save, as tagging does."""
        assert isinstance(message, GenerateQuestions)
        item_id, job = message.content_item_id, self._questions
        if job is None or job.model.startswith(BATCH_PREFIX):
            log.info("pipeline: sync questions are off", content_item_id=item_id)
            return
        now = self._clock()
        with self._unit() as services:
            questions = services.store.questions
            # targets() leaves out an article whose questions came from its moments
            # (ADR-0058, from_moments): a stray job never retires them.
            target = questions.target(item_id) if questions.targets(item_id) else None
            drafted = questions.drafted_hash(item_id)
            pending_ids = questions.pending_ids(item_id)
            retry = questions.retry_state(item_id)
            text = question_passage(services.store, target)
        # One retry chain per article: a re-tag or a second backfill while a retry
        # waits starts another, which is dropped here.
        if (
            retry is not None
            and message.attempt < retry[0]
            and now < retry[1] + QUESTION_RETRY_LOST
        ):
            log.info("questions: a newer retry is waiting", content_item_id=item_id)
            return
        if target is None or not text:
            log.info("questions: not a target now", content_item_id=item_id)
            return
        count = question_count(target.sections)
        slugs = [slug for slug, _ in target.concepts]
        digest = content_hash(text, slugs)
        if digest == drafted:
            # AI-4: drafted once per text, concepts and prompt. A backfill still
            # re-queues the validation of any draft left pending (a validator that
            # gave up, rights that came back, a crash before the enqueue).
            self._validate_later(pending_ids)
            return
        broken = message.broken
        try:
            with job.gateway() as gateway:
                answered = gateway.complete(
                    feature="questions",
                    user_id=None,
                    model=job.model,
                    messages=prompt(text, [name for _, name in target.concepts], count),
                )
            if isinstance(answered, OverBudget):
                raise ModelError(f"the {answered.scope} AI budget is spent")
            drafts = parse_reply(answered.text, text, count)
        except (ModelError, QuestionReplyError) as error:
            attempt = message.attempt + 1
            # The retry state first: the retry it describes may run as soon as it's
            # queued.
            with self._unit() as services:
                services.store.questions.record_retry(
                    item_id, attempt, now + timedelta(seconds=QUESTION_RETRY_SECONDS)
                )
            if not self._retry_question_call(
                "generate_questions",
                {"content_item_id": item_id},
                questions_job(item_id)[2],
                attempt,
                broken,
                error,
            ):
                with self._unit() as services:
                    services.store.questions.clear_retry(item_id)
            return
        with self._unit() as services:
            # The article changed or lost its target while the model ran: the next
            # tagging pass queues it again.
            current = services.store.questions.target(item_id)
            if current is None or question_passage(services.store, current) != text:
                log.info(
                    "questions: article changed; drafts dropped",
                    content_item_id=item_id,
                )
                return
            saved = services.store.questions.save(
                item_id,
                [shuffled(draft) for draft in drafts],
                [slug for slug, _ in current.concepts],
                job.model,
                QUESTIONS_PROMPT_VERSION,
                content_hash(text, [slug for slug, _ in current.concepts]),
                current.difficulty,
            )
        # Q-1: each draft goes to the blind validator (P2-W8-S02), after the commit.
        self._validate_later(saved)

    def _validate_later(self, question_ids: list[int]) -> None:
        for question_id in question_ids:
            self._queue.enqueue(
                "validate_question",
                {"question_id": question_id, "attempt": 0, "broken": 0},
                idempotency_key=f"validate-{question_id}",
            )

    def _retry_question_call(
        self,
        name: Literal["generate_questions", "validate_question"],
        ids: dict[str, object],
        key: str,
        attempt: int,
        broken: int,
        error: Exception,
    ) -> bool:
        """Q-P2-10: a rate limit or model error tries again in 5 minutes without end;
        a reply that breaks a rule does too, until QUESTION_BROKEN_REPLIES of them.
        False when it gave up."""
        if isinstance(error, QuestionReplyError):
            broken += 1
        if broken >= QUESTION_BROKEN_REPLIES:
            log.warn(
                "questions: giving up after broken replies",
                stage=name,
                broken=broken,
                error=str(error),
                **ids,
            )
            return False
        log.warn(
            "questions: retrying in 5 minutes",
            stage=name,
            attempt=attempt,
            broken=broken,
            error=str(error),
            **ids,
        )
        self._queue.enqueue(
            name,
            {**ids, "attempt": attempt, "broken": broken},
            idempotency_key=f"{key}-try{attempt}",
            delay_seconds=QUESTION_RETRY_SECONDS,
        )
        return True

    def _validate_stage(self, message: BaseModel, delivery: Delivery) -> None:
        """Q-1: answer a pending question blind; live if it matches the key, else
        rejected (P2-W8-S02). A decided or retired question is skipped, so a
        repeated delivery changes nothing."""
        assert isinstance(message, ValidateQuestion)
        question_id, job = message.question_id, self._questions
        if job is None or job.model.startswith(BATCH_PREFIX):
            log.info("pipeline: sync questions are off", question_id=question_id)
            return
        with self._unit() as services:
            pending = services.store.questions.pending(question_id)
            text = (
                ""
                if pending is None
                else cited_passage(
                    services.store,
                    services.store.questions.target(pending[0]),
                    pending[1].citation,
                )
            )
        if pending is None:
            return  # decided, retired or gone: a repeat delivery
        if not text:
            # Its article lost its rights or tags meanwhile (ING-2): left pending, and
            # a later backfill re-queues it if they come back.
            log.warn(
                "questions: pending, but its article isn't a target",
                question_id=question_id,
            )
            return
        try:
            with job.gateway() as gateway:
                answered = gateway.complete(
                    feature="questions",
                    user_id=None,
                    model=job.model,
                    messages=validation_prompt(text, pending[1]),
                )
            if isinstance(answered, OverBudget):
                raise ModelError(f"the {answered.scope} AI budget is spent")
            answer = parse_answer(answered.text)
        except (ModelError, QuestionReplyError) as error:
            self._retry_question_call(
                "validate_question",
                {"question_id": question_id},
                f"validate-{question_id}",
                message.attempt + 1,
                message.broken,
                error,
            )
            return
        with self._unit() as services:
            decided = services.store.questions.record_verdict(
                question_id, job.model, answer
            )
        if decided:
            log.info(
                "questions: validated",
                question_id=question_id,
                agreed=answer == pending[1].correct,
            )
        else:
            log.info("questions: decided or retired meanwhile", question_id=question_id)

    def _tag_if_needed(self, store: Store, item_id: int) -> list[Next]:
        if self._tagging is None or not store.tags.needs_tagging(
            item_id, PROMPT_VERSION
        ):
            return []
        key = f"tag-{item_id}-v{PROMPT_VERSION}"
        return [("tag_item", {"content_item_id": item_id}, key)]

    def _tag_by_decisions(
        self, item_id: int, item: TagInput, graph: ConceptGraph
    ) -> None:
        """Tagging v3 (2026-10-27): ask the decision model about the article (a
        shortlist of concepts) when its content changed, keep the raw answers, roll
        them up (ADR-0058: the article is asked about whole)."""
        assert self._tagging is not None
        if self._embedding is None:
            log.warn(
                "pipeline: decision tagging needs EMBEDDING_MODEL for its shortlist",
                content_item_id=item_id,
            )
            return
        decider = self._tagging.model.removeprefix(DECISIONS_PREFIX)
        active = {c.slug for c in graph.concepts if not c.retired}
        with self._unit() as services:
            stored = services.store.concepts.vectors(self._embedding.model)
            known_item = services.store.decisions.item_hash(item_id, decider)
            # Re-fetched since the tag stage read it: the next pass tags the new one.
            if services.store.tags.input(item_id) != item:
                log.info(
                    "pipeline: item changed; tagging left to the next pass",
                    content_item_id=item_id,
                )
                return
        by_slug = {c.slug: c for c in graph.concepts}
        vectors = {slug: v for slug, (_, v) in stored.items() if slug in active}
        fresh = [
            slug
            for slug, (digest, _) in stored.items()
            if slug in active
            and digest
            == text_hash(concept_text(by_slug[slug].name, by_slug[slug].description))
        ]
        if len(fresh) < len(active):
            # Missing or stale vectors make the shortlist worse, quietly: say so; the
            # fix is embed-concepts.
            log.warn(
                "pipeline: concept vectors missing or stale; run embed-concepts",
                missing_or_stale=len(active) - len(fresh),
            )
        with self._tagging.gateway() as gateway:
            asked = decide(
                gateway,
                decider,
                self._embedding.model,
                item,
                graph,
                vectors,
                known_item,
            )
        questions: list[Next] = []
        with self._unit() as services:
            if not _same_text(services.store.tags.input(item_id), item):
                log.info(
                    "pipeline: text changed; answers dropped", content_item_id=item_id
                )
                return
            decisions = services.store.decisions
            if asked.item is not None:
                decisions.save_item(
                    item_id,
                    decider,
                    asked.item.content_hash,
                    asked.item.difficulty,
                    asked.item.probabilities,
                    from_full_text=bool(item.full_text),
                )
            # Answers paid for are kept even when the pass stopped part way: the hash
            # skip resumes from them next time.
            if asked.refused is None and asked.stopped is None:
                services.store.tags.save(
                    item_id,
                    rollup(decisions.read(item_id, decider), active),
                    self._tagging.model,
                    PROMPT_VERSION,
                )
                questions = self._questions_for(services.store, item_id)
        self._enqueue(questions)
        if asked.refused is not None:
            # LOAD-5: degrade, observably; the next poll queues it again.
            log.warn(
                "pipeline: tagging over budget",
                content_item_id=item_id,
                scope=asked.refused.scope,
            )
        elif asked.stopped is not None:
            raise TaggingError(asked.stopped)  # the queue retries; answers are kept

    def _tag_stage(self, message: BaseModel, delivery: Delivery) -> None:
        """Read, then call the model with no transaction open, then save in a second
        unit of work only if the item's text didn't change meanwhile."""
        assert isinstance(message, TagItem)
        item_id = message.content_item_id
        if self._tagging is None:
            log.info("pipeline: tagging is off (no model)", content_item_id=item_id)
            return
        with self._unit() as services:
            item = services.store.tags.input(item_id)
            graph = services.store.concepts.state()
        # Once per item (AI-4): not again at this prompt version, not for duplicates.
        if item is None or item.duplicate or item.tagged_version == PROMPT_VERSION:
            return
        if graph is None or not active_concepts(graph):
            log.warn(
                "pipeline: no concept graph loaded; not tagged", content_item_id=item_id
            )
            return
        if self._tagging.model.startswith(DECISIONS_PREFIX):
            self._tag_by_decisions(item_id, item, graph)
            return
        with self._tagging.gateway() as gateway:
            tagged = tag_item(gateway, self._tagging.model, item, graph)
        if isinstance(tagged, OverBudget):
            # LOAD-5: degrade, observably; the next poll queues it again.
            log.warn(
                "pipeline: tagging over budget",
                content_item_id=item_id,
                scope=tagged.scope,
            )
            return
        with self._unit() as services:
            if not _same_text(services.store.tags.input(item_id), item):
                log.info(
                    "pipeline: text changed; tags dropped", content_item_id=item_id
                )
                return
            services.store.tags.save(
                item_id, tagged.result, self._tagging.model, PROMPT_VERSION
            )
            questions = self._questions_for(services.store, item_id)
        self._enqueue(questions)


def _same_text(now: TagInput | None, then: TagInput) -> bool:
    """Whether the item still reads as it did when the model was asked."""
    return now is not None and (now.full_text, now.excerpt) == (
        then.full_text,
        then.excerpt,
    )


def questions_job(item_id: int) -> Next:
    """The job drafting an article's questions (Q-1, ADR-0058). Its own key: a job
    queued before ADR-0058, for a moment of the same id, is another job."""
    return (
        "generate_questions",
        {"content_item_id": item_id, "attempt": 0, "broken": 0},
        f"article-questions-{item_id}-v{QUESTIONS_PROMPT_VERSION}",
    )
