"""Candidate generation (REC-1, Q-P1-13, Q-P1-14, P1-W4-S02): topic match and
embedding similarity, never a hidden source or a Not interested item."""

from datetime import UTC, datetime

from interval_jobs.adapters.memory import InMemoryStore
from interval_jobs.concepts.graph import parse_concepts
from interval_jobs.concepts.sync import sync_concepts
from interval_jobs.ports import FeedEntry, TagResult, Tags, UserPreferences
from interval_jobs.ranking.candidates import Candidate, candidates, candidates_for
from interval_jobs.ranking.rank import rank_for_user

MODEL = "voyage-3.5"


def vector(*first: float) -> list[float]:
    return [*first, *([0.0] * (1024 - len(first)))]


class World:
    def __init__(self) -> None:
        self.store = InMemoryStore()
        sync_concepts(
            self.store,
            parse_concepts(
                "version: 1\nconcepts:\n"
                "  - {slug: raft, name: Raft, topic: distributed-systems}\n"
                "  - {slug: indexes, name: Indexes, topic: databases}\n",
                "c.yaml",
            ),
        )
        self.store.ranking.preferences_by_user["u1"] = UserPreferences(
            topics=["databases"], level="intermediate"
        )

    def source(self, name: str, topics: tuple[str, ...] = ()) -> int:
        sid = self.store.sources.upsert(
            name=name,
            feed_url=f"https://{name}.test/f",
            rights_profile="full_text_internal",
            homepage=None,
        )
        self.store.sources.rows[sid].topics = topics
        return sid

    def item(self, sid: int, guid: str, day: int = 1) -> int:
        entry = FeedEntry(
            guid=guid,
            link=f"https://x.test/{guid}",
            title=guid,
            author=None,
            published_at=datetime(2026, 10, day, tzinfo=UTC),
            updated_at=None,
            summary=None,
        )
        return self.store.items.upsert_from_feed(sid, entry, keep_excerpt=False)


def ids(found: list[Candidate]) -> set[int]:
    return {c.item_id for c in found}


def test_topic_match_uses_the_items_tags_or_else_its_sources_topics() -> None:
    w = World()
    db_source = w.source("dbblog", topics=("databases",))
    other = w.source("misc", topics=("backend",))
    by_source = w.item(db_source, "pg-internals")
    by_tag = w.item(other, "btree-notes")
    w.store.tags.save(
        by_tag, TagResult(Tags("beginner", frozenset({"indexes"})), {}), "m", 1
    )
    unrelated = w.item(other, "deploys")
    found = candidates(w.store, "u1", None)
    assert ids(found) == {by_source, by_tag}
    assert all("topic" in c.generators for c in found)
    assert unrelated not in ids(found)


def test_articles_near_an_anchors_vector_are_candidates() -> None:
    w = World()
    other = w.source("misc", topics=("backend",))
    liked = w.item(other, "liked")
    near = w.item(other, "near")
    far = w.item(other, "far")
    for item, v in (
        (liked, vector(1, 0)),
        (near, vector(0.9, 0.1)),
        (far, vector(0, 1)),
    ):
        w.store.embeddings.save(item, v, MODEL)
    w.store.ranking.feedback.append(("u1", liked, "more_like_this"))
    found = {c.item_id: c for c in candidates(w.store, "u1", MODEL)}
    assert near in found and "similar" in found[near].generators
    similarity = found[near].similarity
    assert similarity is not None and similarity > 0.9
    assert liked not in found  # the anchor itself isn't suggested back
    assert found[far].similarity is not None  # within the 20 per anchor, ranked low


def test_an_anchor_without_a_vector_finds_nothing_similar() -> None:
    w = World()
    other = w.source("misc", topics=("backend",))
    liked = w.item(other, "liked")
    near = w.item(other, "near")
    w.store.embeddings.save(near, vector(1, 0), MODEL)
    w.store.ranking.feedback.append(("u1", liked, "more_like_this"))
    assert candidates(w.store, "u1", MODEL) == []


def test_hidden_sources_and_not_interested_items_never_appear() -> None:
    w = World()
    hidden = w.source("hidden", topics=("databases",))
    shown = w.source("shown", topics=("databases",))
    from_hidden = w.item(hidden, "h1")
    dropped = w.item(shown, "dropped")
    kept = w.item(shown, "kept")
    w.store.ranking.hidden.add(("u1", hidden))
    w.store.ranking.feedback.append(("u1", dropped, "not_interested"))
    found = ids(candidates(w.store, "u1", None))
    assert found == {kept}
    assert from_hidden not in found and dropped not in found


def test_a_user_who_has_not_onboarded_gets_no_candidates() -> None:
    w = World()
    w.item(w.source("dbblog", topics=("databases",)), "p")
    assert candidates(w.store, "nobody", None) == []


def test_similar_articles_from_hidden_sources_or_dropped_items_never_appear() -> None:
    w = World()
    mine = w.source("mine", topics=("backend",))
    hidden = w.source("hidden-near", topics=("backend",))
    liked = w.item(mine, "liked")
    from_hidden = w.item(hidden, "h")
    dropped = w.item(mine, "dropped")
    kept = w.item(mine, "kept")
    for item in (liked, from_hidden, dropped, kept):
        w.store.embeddings.save(item, vector(1, 0), MODEL)
    w.store.ranking.feedback.append(("u1", liked, "more_like_this"))
    w.store.ranking.feedback.append(("u1", dropped, "not_interested"))
    w.store.ranking.hidden.add(("u1", hidden))
    found = ids(candidates(w.store, "u1", MODEL))
    assert kept in found
    assert from_hidden not in found and dropped not in found


def test_a_users_feed_is_one_ranked_list_capped_per_source() -> None:
    w = World()
    w.store.ranking.config_rows["cap.per_source"] = 2
    busy = w.source("busy", topics=("databases",))
    quiet = w.source("quiet", topics=("databases",))
    for day in range(1, 5):
        w.item(busy, f"busy-{day}", day=day)
    quiet_item = w.item(quiet, "quiet-1", day=1)
    now = datetime(2026, 10, 26, tzinfo=UTC)
    ranked = rank_for_user(w.store, "u1", None, now, 10)
    sources = [r.source_id for r in ranked]
    assert sources.count(busy) == 2 and quiet_item in [r.item_id for r in ranked]
    assert rank_for_user(w.store, "nobody", None, now, 10) == []


# P1-W5-S03 (carried over from W4-S02): what the user finished isn't offered again.
def test_finished_articles_are_not_candidates() -> None:
    w = World()
    db = w.source("dbblog", topics=("databases",))
    open_item = w.item(db, "half-read")
    whole = w.item(db, "all-read", day=2)
    w.store.ranking.finished_items.add(("u1", whole))
    found = ids(candidates(w.store, "u1", None))
    assert whole not in found
    assert open_item in found


# P2-W12-S04 (REC-1 "projects", §5H): articles on the concepts the user's connected
# projects map to, with the same exclusions as topic matches.
def test_articles_on_the_users_project_concepts_are_candidates() -> None:
    w = World()
    other = w.source("misc", topics=("backend",))  # not a chosen topic
    on_raft = w.item(other, "raft-in-practice")
    hidden = w.source("hidden", topics=("backend",))
    from_hidden = w.item(hidden, "raft-hidden")
    dropped = w.item(other, "raft-dropped")
    done = w.item(other, "raft-done")
    for item in (on_raft, from_hidden, dropped, done):
        w.store.tags.save(
            item, TagResult(Tags("beginner", frozenset({"raft"})), {}), "m", 1
        )
    w.store.ranking.hidden.add(("u1", hidden))
    w.store.ranking.feedback.append(("u1", dropped, "not_interested"))
    w.store.ranking.finished_items.add(("u1", done))
    assert on_raft not in ids(candidates(w.store, "u1", None))  # no projects yet
    w.store.ranking.projects["u1"] = {"raft": (("etcd", "etcd"),)}
    found = {c.item_id: c for c in candidates(w.store, "u1", None)}
    assert on_raft in found and "project" in found[on_raft].generators
    # PER-1: hidden sources, Not interested and finished stay out.
    assert not {from_hidden, dropped, done} & set(found)
    # A starter feed has no user, so no projects.
    preferences = w.store.ranking.preferences("u1")
    assert preferences is not None
    assert on_raft not in ids(candidates_for(w.store, preferences, None, None))
