"""Voicing explainers (TTS-3, TTS-4, CACHE-4, Q-P4-08, Q-P4-09, P4-W22-S04): each
approved script said once by the chosen provider, through the pronunciation dictionary,
cut into HLS and put in the public media bucket, with each word's time stored beside
it. Every call goes through the gateway against the shared daily budget (OPS-4)."""

import re
import uuid
from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass, field
from typing import Protocol

from interval_jobs import log
from interval_jobs.ai.gateway import AiGateway, OverBudget
from interval_jobs.captions import captions
from interval_jobs.ports import Explainers, Files, Hls, Pronunciations, TtsProvider
from interval_jobs.pronunciations import rewrite

TYPES = {".m3u8": "application/vnd.apple.mpegurl", ".ts": "video/mp2t"}
PLAYLIST = "index.m3u8"


def playlist_seconds(playlist: bytes) -> float:
    """The audio's length: its segments' durations (#EXTINF), trailing silence too."""
    return round(
        sum(float(m.group(1)) for m in re.finditer(rb"#EXTINF:([0-9.]+)", playlist)),
        2,
    )


class VoicingError(RuntimeError):
    """The job can't go on (a provider without word times): nothing more is said."""


class HasVoicing(Protocol):
    @property
    def explainers(self) -> Explainers: ...

    @property
    def pronunciations(self) -> Pronunciations: ...


type Unit = Callable[[], AbstractContextManager[HasVoicing]]


@dataclass
class Voiced:
    voiced: list[int] = field(default_factory=list[int])
    over_budget: bool = False


def voice(
    unit: Unit,
    gateway: AiGateway,
    tts: TtsProvider,
    media: Files,
    hls: Hls,
    limit: int,
) -> Voiced:
    out = Voiced()
    with unit() as store:
        todo = store.explainers.unvoiced(limit)
        dictionary = store.pronunciations.all()
    for explainer in todo:
        said = rewrite(explainer.script, dictionary)
        got = gateway.speak(feature="tts", tts=tts, text=said.text)
        if isinstance(got, OverBudget):
            out.over_budget = True
            log.warn("voicing: over budget", scope=got.scope)
            break
        words = got.speech.words
        if not words:
            # TTS-3: captions need each word's time; Q-P4-08 leaves alignment for later.
            raise VoicingError(
                f"{tts.provider} gives no word timestamps; forced alignment is a "
                "later decision (Q-P4-08)"
            )
        # Made before anything is stored: a failure here mustn't leave paid-for audio
        # uploaded and the explainer unvoiced, to be said (and billed) again.
        timed = captions(explainer.script, said, words)
        # Keys are the public path (CloudFront and Caddy serve /media/* as is), one
        # folder a run: a playlist only ever points at its own segments, even if two
        # runs overlap or one dies before saving.
        prefix = (
            f"media/explainers/{explainer.concept_id}/{explainer.explainer_id}/"
            f"{uuid.uuid4().hex[:12]}"
        )
        files = hls.package(got.speech.audio)
        if PLAYLIST not in files:
            raise VoicingError("the HLS packaging gave no playlist")
        for name, data in files.items():
            suffix = name[name.rfind(".") :]
            media.put(
                f"{prefix}/{name}", data, TYPES.get(suffix, "application/octet-stream")
            )
        with unit() as store:
            if store.explainers.save_audio(
                explainer.explainer_id,
                tts.provider,
                tts.voice,
                f"{prefix}/{PLAYLIST}",
                playlist_seconds(files[PLAYLIST]) or max(w.end for w in words),
                words,
                timed,
            ):
                out.voiced.append(explainer.explainer_id)
    return out
