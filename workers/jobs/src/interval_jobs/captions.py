"""Captions (TTS-3, P4-W23-S03; owner, 2026-11-11): the script's own words, each timed
by the words the provider said for it. The dictionary rewrote terms before TTS
(pronunciations.rewrite), so a term said as several words is one caption again, and the
script's punctuation stays (some providers' word marks carry none). A script word the
provider gave no time for keeps the time where the last one ended."""

import re

from interval_jobs.ports import Caption, WordTime
from interval_jobs.pronunciations import Rewritten


# One character in, one out ("İ" lowercases to two): the stream keeps step with places.
def _low(ch: str) -> str:
    return ch.lower()[:1]


def _bare(text: str) -> str:
    return "".join(_low(ch) for ch in text if ch.isalnum())


# How many said words ahead a provider's word may be found: past that, it isn't there
# (a number said as a word, a provider's own normalising) and is skipped.
_AHEAD = 6


def captions(script: str, said: Rewritten, words: list[WordTime]) -> list[Caption]:
    # The said text's letters and digits, each with its place: a provider's word is
    # found there in order, whatever spacing or punctuation it kept.
    places = [i for i, ch in enumerate(said.text) if ch.isalnum()]
    stream = "".join(_low(said.text[i]) for i in places)
    # Where each said word starts in the stream: a provider's word only matches there,
    # never inside a later word ("two" in "network").
    starts_at = [
        k for k, i in enumerate(places) if i == 0 or not said.text[i - 1].isalnum()
    ]
    tokens = [(m.start(), m.end(), m.group()) for m in re.finditer(r"\S+", script)]
    starts: list[float | None] = [None] * len(tokens)
    ends: list[float | None] = [None] * len(tokens)
    cursor = 0
    for word in words:
        bare = _bare(word.word)
        ahead = [k for k in starts_at if k >= cursor][:_AHEAD]
        found = next((k for k in ahead if bare and stream.startswith(bare, k)), -1)
        if found == -1:
            continue
        cursor = found + len(bare)
        start, end = said.script_span(places[found], places[cursor - 1] + 1)
        for k, (t_start, t_end, _) in enumerate(tokens):
            if t_start < end and start < t_end:
                first, last = starts[k], ends[k]
                starts[k] = word.start if first is None else min(first, word.start)
                ends[k] = word.end if last is None else max(last, word.end)
    out: list[Caption] = []
    previous = 0.0
    for (_, _, text), start, end in zip(tokens, starts, ends, strict=True):
        begin = previous if start is None else start
        finish = begin if end is None else end
        out.append(Caption(text, begin, finish))
        previous = finish
    return out
