"""Captions (TTS-3, P4-W23-S03; owner, 2026-11-11): the script's words, timed by what
was said for them, through the dictionary's rewrite."""

from interval_jobs.captions import captions
from interval_jobs.ports import Caption, Pronunciation, WordTime
from interval_jobs.pronunciations import rewrite

DICT = [
    Pronunciation("PostgreSQL", "post gress Q L"),
    Pronunciation("QUIC", "quick"),
    Pronunciation("JSON", "jason"),
]


def timed(*words: str) -> list[WordTime]:
    return [WordTime(w, float(i), i + 0.5) for i, w in enumerate(words)]


def test_a_term_said_as_several_words_is_one_caption_with_its_punctuation() -> None:
    script = "Use PostgreSQL, then rest."
    said = rewrite(script, DICT)
    assert said.text == "Use post gress Q L, then rest."
    # Polly-like marks: bare words, no punctuation.
    got = captions(
        script, said, timed("Use", "post", "gress", "Q", "L", "then", "rest")
    )
    assert got == [
        Caption("Use", 0.0, 0.5),
        Caption("PostgreSQL,", 1.0, 4.5),
        Caption("then", 5.0, 5.5),
        Caption("rest.", 6.0, 6.5),
    ]


def test_an_ordinary_word_stays_itself_even_if_a_term_is_said_the_same() -> None:
    # "quick" in the script is not QUIC: only what the dictionary rewrote is a term.
    script = "A quick QUIC check."
    said = rewrite(script, DICT)
    got = captions(script, said, timed("A", "quick", "quick", "check."))
    assert [c.text for c in got] == ["A", "quick", "QUIC", "check."]
    assert got[2] == Caption("QUIC", 2.0, 2.5)


def test_joined_words_and_a_provider_that_keeps_punctuation() -> None:
    script = "JSON-RPC calls."
    said = rewrite(script, DICT)
    assert said.text == "jason-RPC calls."
    # ElevenLabs-like: one token with its hyphen and punctuation.
    got = captions(script, said, timed("jason-RPC", "calls."))
    assert got == [Caption("JSON-RPC", 0.0, 0.5), Caption("calls.", 1.0, 1.5)]


def test_a_word_the_provider_left_out_keeps_the_last_time() -> None:
    script = "One two three."
    got = captions(
        script,
        rewrite(script, []),
        [WordTime("one", 0, 0.4), WordTime("three", 1, 1.4)],
    )
    assert got == [
        Caption("One", 0, 0.4),
        Caption("two", 0.4, 0.4),
        Caption("three.", 1, 1.4),
    ]


def test_a_word_not_said_as_written_never_matches_inside_a_later_word() -> None:
    # "2" said as "two": not found where a said word starts, so skipped, and "network"
    # isn't taken for it.
    script = "Run 2 servers on a network."
    got = captions(
        script,
        rewrite(script, []),
        timed("Run", "two", "servers", "on", "a", "network"),
    )
    assert [(c.text, c.start) for c in got] == [
        ("Run", 0.0),
        ("2", 0.5),
        ("servers", 2.0),
        ("on", 3.0),
        ("a", 4.0),
        ("network.", 5.0),
    ]


def test_a_letter_that_lowercases_to_two_keeps_the_rest_in_step() -> None:
    script = "Go to İzmir and back now."
    got = captions(
        script, rewrite(script, []), timed("Go", "to", "İzmir", "and", "back", "now.")
    )
    assert [c.start for c in got] == [0.0, 1.0, 2.0, 3.0, 4.0, 5.0]
