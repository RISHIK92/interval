"""The TTS blind test (TTS-1, Q-P4-07, P4-W22-S03): the same five scripts said by each
configured provider, stored as MP3s and labeled A, B, C in an order shuffled per script,
for the owner to pick a voice on /admin/tts without knowing whose it is. Every call goes
through the gateway against the shared daily budget (OPS-4, owner 2026-11-09)."""

import random
import uuid
from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass, field
from typing import Protocol

import yaml
from pydantic import BaseModel, ValidationError

from interval_jobs import log
from interval_jobs.ai.gateway import AiGateway, OverBudget
from interval_jobs.ports import Files, Pronunciations, TtsProvider, TtsSamples
from interval_jobs.pronunciations import spoken

SCRIPTS = 5
LABELS = ("A", "B", "C")


class TtsScriptsError(ValueError):
    """The scripts file breaks a rule; nothing is said."""


class _Scripts(BaseModel):
    scripts: list[str]


def parse_scripts(text: str) -> list[str]:
    try:
        seed = _Scripts.model_validate(yaml.safe_load(text))
    except (yaml.YAMLError, ValidationError) as error:
        raise TtsScriptsError(f"expected `scripts:` with {SCRIPTS} texts") from error
    out = [s.strip() for s in seed.scripts]
    if len(out) != SCRIPTS or not all(out):
        raise TtsScriptsError(f"expected {SCRIPTS} scripts, none empty")
    return out


class HasSamples(Protocol):
    @property
    def tts_samples(self) -> TtsSamples: ...

    @property
    def pronunciations(self) -> Pronunciations: ...


type Unit = Callable[[], AbstractContextManager[HasSamples]]


@dataclass
class BlindRun:
    run: str
    made: int = 0
    over_budget: bool = False
    providers: list[str] = field(default_factory=list[str])


def blind_test(
    unit: Unit,
    gateway: AiGateway,
    files: Files,
    providers: list[TtsProvider],
    scripts: list[str],
    rng: random.Random | None = None,
) -> BlindRun:
    if not 2 <= len(providers) <= len(LABELS):
        raise TtsScriptsError(
            f"needs 2-{len(LABELS)} providers with keys, has {len(providers)}"
        )
    shuffle = rng or random.Random()
    out = BlindRun(str(uuid.uuid4()), providers=[p.provider for p in providers])
    with unit() as store:
        dictionary = store.pronunciations.all()
    for number, script in enumerate(scripts, 1):
        # The providers' order is shuffled, the labels' isn't: rows (and their ids, in
        # the page) follow A, B, C, which never say whose voice it is.
        order = list(providers)
        shuffle.shuffle(order)
        for provider, label in zip(order, LABELS, strict=False):
            got = gateway.speak(
                feature="tts", tts=provider, text=spoken(script, dictionary)
            )
            if isinstance(got, OverBudget):
                out.over_budget = True
                log.warn("tts blind test: over budget", scope=got.scope)
                return out
            key = f"tts-blind/{out.run}/{number}-{label}.mp3"
            files.put(key, got.speech.audio, "audio/mpeg")
            with unit() as store:
                store.tts_samples.save(out.run, number, provider.provider, label, key)
            out.made += 1
    return out
