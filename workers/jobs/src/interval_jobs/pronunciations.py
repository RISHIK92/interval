"""The pronunciation dictionary (TTS-2, Q-P4-10, P4-W22-S02): technical terms and how to
say them, from the repo's YAML seed and the admin page, applied to a script before TTS
as plain words every provider reads."""

import re
from collections.abc import Hashable, Iterable
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


def spoken(script: str, entries: Iterable[Pronunciation]) -> str:
    """The script with each term said as the dictionary says it: whole words only, in
    any case, longest term first (so "PostgreSQL" is never read as "Postgre" "SQL")."""
    terms = sorted(entries, key=lambda e: len(e.term), reverse=True)
    if not terms:
        return script
    # One group a term, in order: which matched is its group's number, never a lookup by
    # the matched text (case folding can change a string's length).
    pattern = re.compile(
        "|".join(rf"(?<!\w)({re.escape(e.term)})(?!\w)" for e in terms),
        re.IGNORECASE,
    )

    def say(match: re.Match[str]) -> str:
        assert match.lastindex is not None
        return terms[match.lastindex - 1].say

    return pattern.sub(say, script)
