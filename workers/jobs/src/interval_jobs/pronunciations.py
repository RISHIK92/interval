"""The pronunciation dictionary (TTS-2, Q-P4-10, P4-W22-S02): technical terms and how to
say them, from the repo's YAML seed and the admin page, applied to a script before TTS
as plain words every provider reads."""

import re
from collections.abc import Hashable, Iterable
from dataclasses import dataclass
from typing import Any

import yaml

from interval_jobs.ports import Pronunciation

TERM_CHARS = 80
SAY_CHARS = 200


class PronunciationSeedError(ValueError):
    """The seed file breaks a rule; nothing is loaded."""


class _UniqueKeys(yaml.SafeLoader):
    """YAML keeps only the last of two equal keys; a seed listing a term twice is
    refused instead of half-loaded."""

    def construct_mapping(
        self, node: yaml.MappingNode, deep: bool = False
    ) -> dict[Hashable, Any]:
        seen: set[str] = set()
        for key, _ in node.value:
            text = str(key.value).strip().lower()
            if text in seen:
                raise PronunciationSeedError(f"{key.value!r} is listed twice")
            seen.add(text)
        return super().construct_mapping(node, deep)


def parse_seed(text: str, path: str = "pronunciations.yaml") -> list[Pronunciation]:
    try:
        loaded: object = yaml.load(text, Loader=_UniqueKeys)
    except PronunciationSeedError as error:
        raise PronunciationSeedError(f"{path}: {error}") from error
    except yaml.YAMLError as error:
        raise PronunciationSeedError(f"{path}: not YAML: {error}") from error
    if not isinstance(loaded, dict):
        raise PronunciationSeedError(f"{path}: expected `term: how to say it` lines")
    entries: list[Pronunciation] = []
    seen: set[str] = set()
    for term, say in loaded.items():  # pyright: ignore[reportUnknownVariableType]
        if not isinstance(term, str) or not isinstance(say, str):
            raise PronunciationSeedError(f"{path}: {term!r}: both must be text")
        term, say = term.strip(), say.strip()
        if not 1 <= len(term) <= TERM_CHARS or not 1 <= len(say) <= SAY_CHARS:
            raise PronunciationSeedError(
                f"{path}: {term!r}: a term 1-{TERM_CHARS} characters, said in "
                f"1-{SAY_CHARS}"
            )
        if term.lower() in seen:
            raise PronunciationSeedError(f"{path}: {term!r} is listed twice")
        seen.add(term.lower())
        entries.append(Pronunciation(term, say))
    return entries


@dataclass(frozen=True)
class Piece:
    """A stretch of the said text and the script it came from: the same text, or a
    dictionary term (the whole term for the whole phrase that says it)."""

    said_start: int
    said_end: int
    script_start: int
    script_end: int
    replaced: bool


@dataclass(frozen=True)
class Rewritten:
    text: str
    pieces: list[Piece]  # in order, covering the said text

    def script_span(self, start: int, end: int) -> tuple[int, int]:
        """Where said characters [start, end) came from in the script: a replaced term
        whole, the rest character for character (P4-W23-S03 captions)."""

        if not self.pieces:
            return (0, 0)

        def at(i: int) -> Piece:
            return next(
                (p for p in self.pieces if p.said_start <= i < p.said_end),
                self.pieces[-1],
            )

        first, last = at(start), at(end - 1)
        return (
            first.script_start
            if first.replaced
            else first.script_start + start - first.said_start,
            last.script_end
            if last.replaced
            else last.script_start + end - last.said_start,
        )


def rewrite(script: str, entries: Iterable[Pronunciation]) -> Rewritten:
    """The script with each term said as the dictionary says it: whole words only, in
    any case, longest term first (so "PostgreSQL" is never read as "Postgre" "SQL").
    Keeps where each part of the said text came from, for captions."""
    terms = sorted(entries, key=lambda e: len(e.term), reverse=True)
    if not terms:
        return Rewritten(script, [Piece(0, len(script), 0, len(script), False)])
    # One group a term, in order: which matched is its group's number, never a lookup by
    # the matched text (case folding can change a string's length).
    pattern = re.compile(
        "|".join(rf"(?<!\w)({re.escape(e.term)})(?!\w)" for e in terms),
        re.IGNORECASE,
    )
    said: list[str] = []
    pieces: list[Piece] = []
    at, length = 0, 0

    def keep(start: int, end: int, text: str, replaced: bool) -> None:
        nonlocal length
        if text:
            pieces.append(Piece(length, length + len(text), start, end, replaced))
            said.append(text)
            length += len(text)

    for match in pattern.finditer(script):
        keep(at, match.start(), script[at : match.start()], False)
        assert match.lastindex is not None
        keep(match.start(), match.end(), terms[match.lastindex - 1].say, True)
        at = match.end()
    keep(at, len(script), script[at:], False)
    return Rewritten("".join(said), pieces)


def spoken(script: str, entries: Iterable[Pronunciation]) -> str:
    return rewrite(script, entries).text
