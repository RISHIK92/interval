""" "Shown for" reasons (ADR-0026): why the ranking showed a card, in words, rendered
from the entry's own breakdown at recompute, with no model. Every reason that counted
(a weighted part of at least REASON_THRESHOLD whose facts hold) becomes a phrase from a
grammar (workers/jobs/seeds/reasons.yaml): a lead, a frame per reason with nested
synonym symbols, and a joining style. Choices are least-used first across one feed,
so neighbouring cards don't share wording (RosaeNLG's "once"), with ties broken by a
seed of (user, item, recompute hour): each recompute reads fresh (owner's choice) and
any one is reproducible.
"""

import hashlib
import random
import re
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from functools import cache
from pathlib import Path
from typing import cast

import yaml

from interval_db.generated import Difficulty, LearningGoal, Topic
from interval_jobs.ports import ConceptGraph, ProjectConcepts
from interval_jobs.ranking.scoring import Scored

# Each reason's facts: every frame must use exactly these (the loader checks), so
# whichever wording is drawn, it says the same thing.
REASON_FACTS: dict[str, frozenset[str]] = {
    "explore": frozenset({"arm"}),
    "topic_match": frozenset({"topics"}),
    "goal_match": frozenset({"goal", "concept"}),
    "project_match": frozenset({"technology", "repositories", "concept"}),
    "level_fit": frozenset({"level"}),
    "time_fit": frozenset({"minutes"}),
    "quality": frozenset({"source"}),
    "freshness": frozenset({"source"}),
}
REASON_THRESHOLD = 0.1  # a weighted part below this didn't really count
LINE_MAX = 600  # the reasons columns' own limit
REPOSITORIES_SHOWN = 2  # then "and N more", so a big account can't overflow the line
# The concept behind goal and project reasons comes from the model tagger (AI-3): their
# frames must say "tagged".
TAGGED = frozenset({"goal_match", "project_match"})
# A starter feed is scored for one break and shown under every chip, and has no user:
# only its topic and level are true of it (ADR-0026).
STARTER_KINDS = frozenset({"topic_match", "level_fit"})
MIN_FRAMES = 3
TRUSTED_QUALITY = 4  # "most trusted": a source rated 4 or 5 (ING-6)
FRESH = timedelta(days=7)
GRAMMAR_FILE = Path("workers/jobs/seeds/reasons.yaml")  # from the repo root, as seeds

# How a goal reads (ADR-0015, owner 2026-10-26).
GOAL_WORDS: dict[LearningGoal, str] = {
    "system-design-interviews": "pass system design interviews",
    "stack-i-use": "get better at the stack you use",
}

type GoalSets = tuple[tuple[LearningGoal, frozenset[str]], ...]

_FACT = re.compile(r"\{([a-z]+)(\.a)?\}")
_SYMBOL = re.compile(r"#([a-z]+)#")


class GrammarError(ValueError):
    pass


@dataclass(frozen=True)
class Join:
    sep: str
    last: str


@dataclass(frozen=True)
class Grammar:
    leads: tuple[str, ...]
    joins: tuple[Join, ...]
    frames: dict[str, tuple[str, ...]]
    symbols: dict[str, tuple[str, ...]]


def _strings(raw: object, what: str, minimum: int) -> tuple[str, ...]:
    if not isinstance(raw, list):
        raise GrammarError(f"{what} must be a list")
    items = cast(list[object], raw)
    if len(items) < minimum or not all(
        isinstance(i, str) and 1 <= len(i) <= 120 for i in items
    ):
        raise GrammarError(f"{what} needs at least {minimum} strings of 1-120 chars")
    return tuple(cast(list[str], items))


def parse_grammar(text: str, where: str) -> Grammar:
    """The grammar; GrammarError names what's wrong."""
    data: object = yaml.safe_load(text)
    if not isinstance(data, dict):
        raise GrammarError(f"{where}: must be a mapping")
    doc = cast(dict[str, object], data)
    leads = _strings(doc.get("leads"), f"{where}: leads", 3)
    raw_joins = doc.get("joins")
    if not isinstance(raw_joins, list) or len(cast(list[object], raw_joins)) < 2:
        raise GrammarError(f"{where}: joins needs at least 2 styles")
    joins: list[Join] = []
    for raw in cast(list[object], raw_joins):
        entry = cast(dict[str, object], raw) if isinstance(raw, dict) else {}
        sep, last = entry.get("sep"), entry.get("last")
        if not isinstance(sep, str) or not isinstance(last, str):
            raise GrammarError(f"{where}: each join needs sep and last")
        joins.append(Join(sep, last))
    raw_symbols = doc.get("symbols")
    if not isinstance(raw_symbols, dict):
        raise GrammarError(f"{where}: needs symbols")
    symbols = {
        str(name): _strings(options, f"{where}: symbol {name}", 2)
        for name, options in cast(dict[object, object], raw_symbols).items()
    }
    raw_frames = doc.get("reasons")
    if not isinstance(raw_frames, dict):
        raise GrammarError(f"{where}: needs reasons")
    frames = {
        str(kind): _strings(options, f"{where}: reason {kind}", MIN_FRAMES)
        for kind, options in cast(dict[object, object], raw_frames).items()
    }
    if set(frames) != set(REASON_FACTS):
        raise GrammarError(f"{where}: reasons must be exactly {sorted(REASON_FACTS)}")
    for kind, options in frames.items():
        for frame in options:
            used = {m.group(1) for m in _FACT.finditer(frame)}
            if frozenset(used) != REASON_FACTS[kind]:
                raise GrammarError(
                    f"{where}: {kind} frame {frame!r} must use exactly "
                    f"{sorted(REASON_FACTS[kind])}"
                )
    for kind in TAGGED:
        for frame in frames[kind]:
            if "tagged" not in frame:
                raise GrammarError(f"{where}: {kind} frame {frame!r} must say tagged")
    for lead in leads:
        if _FACT.search(lead):
            raise GrammarError(f"{where}: a lead can't use a fact: {lead!r}")
    for text_ in (*leads, *(f for o in frames.values() for f in o)):
        for name in _SYMBOL.findall(text_):
            if name not in symbols:
                raise GrammarError(f"{where}: unknown symbol #{name}# in {text_!r}")
        rest = _SYMBOL.sub("", _FACT.sub("", text_))
        if any(c in rest for c in "{}#"):
            raise GrammarError(f"{where}: stray brace or # in {text_!r}")
    for name, options in symbols.items():
        if any("#" in o or "{" in o for o in options):
            raise GrammarError(f"{where}: symbol {name} options must be plain words")
    return Grammar(leads, tuple(joins), frames, symbols)


@cache
def grammar() -> Grammar:
    return parse_grammar(GRAMMAR_FILE.read_text("utf-8"), str(GRAMMAR_FILE))


@dataclass(frozen=True)
class ConceptMap:
    """Live concepts' names, by slug."""

    names: dict[str, str]


def concept_map(graph: ConceptGraph | None) -> ConceptMap:
    if graph is None:
        return ConceptMap({})
    return ConceptMap({c.slug: c.name for c in graph.concepts if not c.retired})


@dataclass(frozen=True)
class Reason:
    kind: str
    facts: dict[str, str]


def _words(slug: str) -> str:
    return slug.replace("-", " ")


def natural_list(items: Sequence[str]) -> str:
    if len(items) <= 1:
        return "".join(items)
    return f"{', '.join(items[:-1])} and {items[-1]}"


# Sounds that take "an": vowels, and numbers read eight, eleven, eighteen, eighty...
_AN_NUMBER = re.compile(r"^(8|11|18)(\d{3})*$|^8\d*$")


def with_article(word: str) -> str:
    first = word.split()[0] if word.split() else word
    if first[:1].isdigit():
        an = bool(_AN_NUMBER.match(first.replace(",", "")))
    else:
        an = first[:1].lower() in "aeiou"
    return f"{'an' if an else 'a'} {word}"


def reasons_for(
    scored: Scored,
    topics: Sequence[Topic],
    level: Difficulty,
    now: datetime,
    goals: GoalSets,
    projects: ProjectConcepts,
    repositories: dict[str, tuple[str, ...]],
    concepts: ConceptMap,
) -> list[Reason]:
    """Every reason that counted for this entry, the exploration pick first and then
    largest weighted part first; only reasons whose facts hold."""
    facts, weighted = scored.facts, scored.breakdown.weighted
    named = sorted(c for c in facts.concepts if c in concepts.names)
    found: list[tuple[float, Reason]] = []

    def add(kind: str, values: dict[str, str]) -> None:
        found.append((weighted.get(kind, 0.0), Reason(kind, values)))

    for kind in sorted(weighted, key=lambda k: -weighted[k]):
        if weighted[kind] < REASON_THRESHOLD:
            continue
        if kind == "topic_match":
            mine = [_words(t) for t in topics if t in facts.topics]
            if mine:
                add(kind, {"topics": natural_list(mine)})
        elif kind == "goal_match":
            for goal, goal_concepts in goals:
                hit = next((c for c in named if c in goal_concepts), None)
                if hit is not None and goal in GOAL_WORDS:
                    add(
                        kind, {"goal": GOAL_WORDS[goal], "concept": concepts.names[hit]}
                    )
                    break
        elif kind == "project_match":
            concept = next((c for c in named if projects.get(c)), None)
            if concept is not None:
                slug, name = projects[concept][0]
                repos = repositories.get(slug, ())
                if repos:
                    add(
                        kind,
                        {
                            "technology": name,
                            "repositories": _repositories(repos),
                            "concept": concepts.names[concept],
                        },
                    )
        elif kind == "level_fit":
            if facts.difficulty == level:
                add(kind, {"level": level})
        elif kind == "time_fit":
            # Only when it fits the break outright: a partial fit isn't "short".
            if facts.minutes is not None and scored.breakdown.values.get(kind) == 1.0:
                add(kind, {"minutes": str(facts.minutes)})
        elif kind == "quality":
            if facts.quality is not None and facts.quality >= TRUSTED_QUALITY:
                add(kind, {"source": facts.source_name})
        elif kind == "freshness":
            if facts.published_at is not None and now - facts.published_at <= FRESH:
                add(kind, {"source": facts.source_name})
    out = [reason for _, reason in found]
    if scored.arm is not None:
        arm = (
            _words(scored.arm.key) if scored.arm.kind == "topic" else facts.source_name
        )
        out.insert(0, Reason("explore", {"arm": arm}))
    return out


class Chooser:
    """Across one feed: never one of the last few choices for the same slot (so
    neighbouring cards differ), then the least used; ties go to the card's own seeded
    draw (RosaeNLG's "once", which also avoids replaying the last choice first)."""

    RECENT = 4

    def __init__(self) -> None:
        self._used: Counter[str] = Counter()
        self._recent: dict[str, list[int]] = {}
        self.lines: set[str] = set()  # every line rendered in this feed

    def pick(self, key: str, options: Sequence[str], rng: random.Random) -> str:
        recent = self._recent.setdefault(key, [])
        keep = min(self.RECENT, len(options) - 1)
        fresh = (
            [i for i in range(len(options)) if i not in recent[-keep:]] if keep else []
        )
        pool = fresh or list(range(len(options)))
        fewest = min(self._used[f"{key}:{i}"] for i in pool)
        index = rng.choice([i for i in pool if self._used[f"{key}:{i}"] == fewest])
        self._used[f"{key}:{index}"] += 1
        recent.append(index)
        return options[index]


def seeded(*parts: object) -> random.Random:
    digest = hashlib.sha256(":".join(str(p) for p in parts).encode()).digest()
    return random.Random(int.from_bytes(digest[:8]))


def render(
    reasons: Sequence[Reason],
    chooser: Chooser,
    rng: random.Random,
    rules: Grammar | None = None,
) -> str | None:
    """One line, or None when nothing counted."""
    if not reasons:
        return None
    g = rules or grammar()

    def expand(text: str, facts: dict[str, str]) -> str:
        text = _SYMBOL.sub(
            lambda m: chooser.pick(f"sym:{m.group(1)}", g.symbols[m.group(1)], rng),
            text,
        )
        return _FACT.sub(
            lambda m: (
                with_article(facts[m.group(1)]) if m.group(2) else facts[m.group(1)]
            ),
            text,
        )

    # A line the feed already has is drawn again (a few times): cards with the same
    # facts still read differently.
    lead = expand(chooser.pick("lead", g.leads, rng), {})
    line = ""
    # A redrawn line's discarded picks still count as used: harmless, it only nudges
    # later cards further from them.
    for _ in range(5):
        phrases = [
            expand(chooser.pick(f"frame:{r.kind}", g.frames[r.kind], rng), r.facts)
            for r in reasons
        ]
        join = _pick_join(chooser, g.joins, rng)
        line = _joined(lead, phrases, join)
        # Past the column's limit, the smallest reasons go into "+N more".
        dropped = 0
        while len(line) > LINE_MAX and len(phrases) > 1:
            phrases.pop()
            dropped += 1
            line = _joined(lead, [*phrases, f"+{dropped} more"], join)
        if line not in chooser.lines:
            break
    chooser.lines.add(line)
    return line[:LINE_MAX]


def _joined(lead: str, phrases: list[str], join: Join) -> str:
    body = phrases[0]
    if len(phrases) > 1:
        body = join.sep.join(phrases[:-1]) + join.last + phrases[-1]
    return f"{lead} {body}"


def _repositories(names: Sequence[str]) -> str:
    shown = list(names[:REPOSITORIES_SHOWN])
    rest = len(names) - len(shown)
    return natural_list([*shown, f"{rest} more"] if rest else shown)


def _pick_join(chooser: Chooser, joins: tuple[Join, ...], rng: random.Random) -> Join:
    labels = [f"{j.sep}|{j.last}" for j in joins]
    return joins[labels.index(chooser.pick("join", labels, rng))]
