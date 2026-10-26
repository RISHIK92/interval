"""The seed list file (Q-P1-02, ING-2, ING-6): every error names its line."""

from pathlib import Path

import pytest

from interval_jobs.ingest.seeds import SeedError, parse_seeds

REPO_SEEDS = Path(__file__).resolve().parents[1] / "seeds" / "sources.yaml"

GOOD = """\
- name: Example Engineering
  homepage: https://example.test/
  feed_url: https://example.test/feed.xml
  rights_profile: full_text_internal
  moments_enabled: true
  paywalled: false
  quality_score: 4
  topics: [backend, system-design]
"""


def test_the_repo_seed_file_parses_into_the_owners_sources() -> None:
    # The accepted 10 (2026-10-25), the owner's 27 additions (2026-10-26) and the 30
    # vetted ones the owner approved (2026-10-27).
    seeds = parse_seeds(REPO_SEEDS.read_text(encoding="utf-8"), str(REPO_SEEDS))
    assert len(seeds) == 67
    assert all(s.rights_profile == "full_text_internal" for s in seeds)
    assert all(s.feed_url is not None for s in seeds)


def test_a_full_entry_parses_with_its_line() -> None:
    [seed] = parse_seeds(GOOD, "s.yaml")
    assert seed.name == "Example Engineering"
    assert seed.quality_score == 4
    assert seed.topics == ("backend", "system-design")
    assert seed.line == 1


def test_defaults_are_conservative() -> None:
    [seed] = parse_seeds(
        "- name: Bare\n  feed_url: https://bare.test/f\n  rights_profile: excerpt\n",
        "s.yaml",
    )
    assert (seed.moments_enabled, seed.paywalled, seed.quality_score, seed.topics) == (
        False,
        False,
        None,
        (),
    )


def error(text: str) -> SeedError:
    with pytest.raises(SeedError) as info:
        parse_seeds(text, "s.yaml")
    return info.value


@pytest.mark.parametrize(
    ("text", "line", "fragment"),
    [
        (
            GOOD.replace("full_text_internal", "full_text_everything"),
            4,
            "rights_profile",
        ),
        (GOOD + "  colour: blue\n", 9, "colour"),
        (GOOD.replace("- name: Example Engineering\n  ", "- "), 1, "name"),
        (GOOD.replace("full_text_internal", "excerpt"), 5, "moments"),
        (GOOD.replace("quality_score: 4", "quality_score: 0"), 7, "quality_score"),
        (GOOD.replace("quality_score: 4", "quality_score: 6"), 7, "quality_score"),
        (GOOD.replace("quality_score: 4", "quality_score: four"), 7, "quality_score"),
        (GOOD.replace("paywalled: false", "paywalled: maybe"), 6, "paywalled"),
        (GOOD.replace("[backend, system-design]", "[Backend Systems]"), 8, "topics"),
        (
            GOOD
            + GOOD.replace("https://example.test/feed.xml", "https://other.test/f"),
            9,
            "duplicate name",
        ),
        (GOOD + GOOD.replace("Example Engineering", "Other"), 11, "duplicate feed_url"),
        (GOOD.replace("paywalled: false", "paywalled: yes"), 6, "true or false"),
        (GOOD.replace("paywalled: false", "paywalled: on"), 6, "true or false"),
        (GOOD.replace("quality_score: 4", "quality_score: 0x3"), 7, "quality_score"),
        (
            GOOD.replace("quality_score: 4", "quality_score: !!int x"),
            7,
            "quality_score",
        ),
        (GOOD + "  rights_profile: metadata_only\n", 9, "rights_profile twice"),
        (GOOD.replace("[backend, system-design]", "[backend, backend]"), 8, "topics"),
        (GOOD.replace("[backend, system-design]", "[1, backend]"), 8, "topics"),
        ("[]\n", 1, "no sources"),
        ("# only a comment\n", 1, "no sources"),
        ("name: not a list\n", 1, "list"),
        ("- just a string\n", 1, "mapping"),
    ],
)
def test_each_problem_names_its_line(text: str, line: int, fragment: str) -> None:
    problem = error(text)
    assert problem.line == line
    assert fragment in problem.message
    assert str(problem).startswith(f"s.yaml:{line}: ")


def test_invalid_yaml_reports_its_line() -> None:
    assert error("- name: [unclosed\n").line >= 1


def test_a_feedless_source_is_kept_but_marked() -> None:
    [seed] = parse_seeds(
        "- name: A Newsletter\n  rights_profile: metadata_only\n", "s.yaml"
    )
    assert seed.feed_url is None


def test_true_and_false_are_read_in_any_case() -> None:
    [seed] = parse_seeds(GOOD.replace("paywalled: false", "paywalled: True"), "s.yaml")
    assert seed.paywalled is True


def test_a_control_character_reports_its_line() -> None:
    problem = error(
        GOOD.replace("https://example.test/\n", "https://ex\x07ample.test/\n")
    )
    assert problem.line == 2
