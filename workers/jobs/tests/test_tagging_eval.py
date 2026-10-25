"""The tagging eval (AI-5, P1-W3-S02): owner-labelled moments scored against the
model's tags; a prompt or model change must pass before it ships."""

from decimal import Decimal

import pytest

from interval_jobs.adapters.memory import InMemoryAi, InMemoryStore
from interval_jobs.ai.gateway import AiGateway
from interval_jobs.concepts.graph import parse_concepts
from interval_jobs.concepts.sync import sync_concepts
from interval_jobs.ports import FeedEntry, MomentRow, Tags
from interval_jobs.tagging_eval import EvalError, Label, parse_labels, run_eval, score

from .test_tagging import NoEmbeddings, ScriptedLlm

URL = "https://s.test/p"
LABELS = f"""version: 1
moments:
  - {{url: "{URL}", moment: null, difficulty: beginner, concepts: [a, b]}}
  - {{url: "{URL}", moment: "Why  a log", difficulty: advanced, concepts: [c]}}
"""


def test_labels_are_read_and_checked() -> None:
    labels = parse_labels(LABELS, "labels.yaml")
    assert labels[0] == Label(URL, None, "beginner", frozenset({"a", "b"}))
    with pytest.raises(EvalError, match="difficulty"):
        parse_labels(LABELS.replace("advanced", "expert"), "labels.yaml")


def test_scores_are_micro_averaged_over_every_labelled_moment() -> None:
    labels = parse_labels(LABELS, "labels.yaml")
    # The intro: 1 right, 1 wrong, 1 missed. "Why a log": right concept, wrong level.
    predicted: dict[tuple[str, str | None], Tags] = {
        (URL, None): Tags("beginner", frozenset({"a", "x"})),
        (URL, "why a log"): Tags("intermediate", frozenset({"c"})),
    }
    report = score(labels, predicted, min_f1=0.6, min_difficulty=0.5)
    assert (report.precision, report.recall) == (2 / 3, 2 / 3)
    assert report.difficulty_accuracy == 0.5
    assert report.passed


def test_a_moment_the_model_skipped_counts_as_all_missed() -> None:
    labels = parse_labels(LABELS, "labels.yaml")
    report = score(labels, {}, min_f1=0.1, min_difficulty=0.1)
    assert (report.recall, report.f1, report.passed) == (0.0, 0.0, False)


def test_the_eval_tags_through_the_gateway_and_stores_nothing() -> None:
    store = InMemoryStore()
    sync_concepts(
        store,
        parse_concepts(
            "version: 1\nconcepts:\n"
            "  - {slug: a, name: A, topic: backend}\n"
            "  - {slug: c, name: C, topic: backend}\n",
            "c.yaml",
        ),
    )
    sid = store.sources.upsert(
        name="s",
        feed_url="https://s.test/f",
        rights_profile="full_text_internal",
        homepage=None,
    )
    store.sources.set_moments_enabled(sid, True)
    entry = FeedEntry(
        guid="g",
        link="https://s.test/p",
        title="T",
        author=None,
        published_at=None,
        updated_at=None,
        summary=None,
    )
    item = store.items.upsert_from_feed(sid, entry, keep_excerpt=False)
    store.items.store_full_text(item, "intro\nH\nbody")
    store.moments.replace(
        item,
        [
            MomentRow(0, "T", 1, "https://s.test/p", "page_top"),
            MomentRow(1, "H", 1, "https://s.test/p#h", "anchor"),
        ],
    )
    answer = {
        "item": {"difficulty": "beginner", "concepts": ["a"]},
        "moments": [
            {"ordinal": 0, "difficulty": "beginner", "concepts": ["a"]},
            {"ordinal": 1, "difficulty": "advanced", "concepts": ["c"]},
        ],
    }
    gateway = AiGateway(InMemoryAi(store.users), ScriptedLlm(answer), NoEmbeddings())
    labels = [
        Label("https://s.test/p", None, "beginner", frozenset({"a"})),
        Label("https://s.test/p", "H", "advanced", frozenset({"c"})),
    ]
    report = run_eval(gateway, "m", store, labels)
    assert (report.f1, report.difficulty_accuracy, report.passed) == (1.0, 1.0, True)
    assert report.cost_usd == Decimal("0.002")
    assert store.tags.version(item) is None
