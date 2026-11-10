"""Voicing explainers (TTS-3, TTS-4, Q-P4-08, Q-P4-09, P4-W22-S04): an approved script
said once, through the dictionary, cut into HLS in the media bucket with each word's
time beside it; a provider without word times stops the job. Fakes, and the real ffmpeg
where it is installed."""

import re
import shutil
import subprocess
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass
from decimal import Decimal
from typing import cast

import psycopg
import pytest

from interval_db.generated import AiProvider
from interval_jobs.adapters.ffmpeg_hls import FfmpegHls
from interval_jobs.adapters.memory import (
    InMemoryExplainers,
    InMemoryFiles,
    InMemoryPronunciations,
)
from interval_jobs.adapters.postgres import PostgresExplainers
from interval_jobs.ports import (
    ExplainerToVoice,
    Pronunciation,
    Speech,
    WordTime,
)
from interval_jobs.voicing import Unit, VoicingError, voice

from .test_tts import gateway

WORDS = [WordTime("engine", 0.0, 0.4), WordTime("x", 0.4, 0.9)]


@dataclass
class FakeTts:
    words: list[WordTime] | None
    said: list[str]

    @property
    def provider(self) -> AiProvider:
        return "elevenlabs"

    @property
    def voice(self) -> str:
        return "v1"

    def speak(self, text: str) -> Speech:
        self.said.append(text)
        return Speech(b"mp3", self.words, len(text), Decimal("0.01"))


class FakeHls:
    def package(self, mp3: bytes) -> dict[str, bytes]:
        assert mp3 == b"mp3"
        return {
            "index.m3u8": b"#EXTM3U\n#EXTINF:6.0,\nseg_000.ts\n"
            b"#EXTINF:1.25,\nseg_001.ts\n",
            "seg_000.ts": b"ts0",
            "seg_001.ts": b"ts1",
        }


@dataclass
class StubStore:
    explainers: InMemoryExplainers
    pronunciations: InMemoryPronunciations


def setup() -> tuple[StubStore, InMemoryFiles, Unit]:
    store = StubStore(InMemoryExplainers(), InMemoryPronunciations())
    store.explainers.approved = [ExplainerToVoice(7, 3, "Behind nginx.")]
    store.pronunciations.load([Pronunciation("nginx", "engine x")])

    @contextmanager
    def unit() -> Generator[StubStore]:
        yield store

    return store, InMemoryFiles(), cast(Unit, unit)


def test_an_approved_script_is_said_once_as_hls_with_its_words() -> None:
    store, media, unit = setup()
    gw, _ = gateway()
    tts = FakeTts(WORDS, [])
    got = voice(unit, gw, tts, media, FakeHls(), limit=5)
    assert got.voiced == [7]
    assert tts.said == ["Behind engine x."]
    (playlist,) = [k for k in media.stored if k.endswith("index.m3u8")]
    # One folder a run: media/explainers/<concept>/<explainer>/<run>/.
    folder = playlist.removesuffix("index.m3u8")
    assert re.fullmatch(r"media/explainers/3/7/[0-9a-f]{12}/", folder)
    assert sorted(media.stored) == [
        f"{folder}index.m3u8",
        f"{folder}seg_000.ts",
        f"{folder}seg_001.ts",
    ]
    assert media.types[playlist] == "application/vnd.apple.mpegurl"
    assert media.types[f"{folder}seg_000.ts"] == "video/mp2t"
    # The audio's length is the playlist's (trailing silence too), not the last word's.
    assert store.explainers.voiced[7] == (
        "elevenlabs",
        "v1",
        playlist,
        7.25,
        WORDS,
    )
    # Voiced once (TTS-4): a second run says nothing.
    assert voice(unit, gw, tts, media, FakeHls(), limit=5).voiced == []
    assert len(tts.said) == 1


def test_a_provider_without_word_times_stops_with_a_clear_error() -> None:
    store, media, unit = setup()
    gw, _ = gateway()
    with pytest.raises(VoicingError, match=r"no word timestamps.*Q-P4-08"):
        voice(unit, gw, FakeTts(None, []), media, FakeHls(), limit=5)
    assert media.stored == {} and store.explainers.voiced == {}


def test_over_the_budget_nothing_is_said() -> None:
    _, media, unit = setup()
    gw, _ = gateway(spent="100")
    tts = FakeTts(WORDS, [])
    got = voice(unit, gw, tts, media, FakeHls(), limit=5)
    assert got.over_budget and got.voiced == [] and tts.said == []


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg isn't installed")
def test_ffmpeg_cuts_an_mp3_into_a_vod_playlist_and_segments() -> None:
    tone = subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=13",
            "-f",
            "mp3",
            "-",
        ],
        capture_output=True,
        check=True,
    ).stdout
    files = FfmpegHls().package(tone)
    playlist = files["index.m3u8"].decode()
    assert "#EXT-X-PLAYLIST-TYPE:VOD" in playlist
    assert "#EXT-X-ENDLIST" in playlist
    segments = sorted(n for n in files if n.endswith(".ts"))
    # 13 seconds in 6-second segments.
    assert segments == ["seg_000.ts", "seg_001.ts", "seg_002.ts"]
    assert all(name in playlist for name in segments)
    # Relative names: the segments sit beside the playlist wherever it is served.
    assert not any(
        line.startswith(("/", "http"))
        for line in playlist.splitlines()
        if not line.startswith("#")
    )


def test_postgres_voices_approved_scripts_once(conn: psycopg.Connection) -> None:
    concept = conn.execute(
        "insert into concept (slug, name, topic) values "
        "('voicing-test', 'Voicing', 'backend') returning id"
    ).fetchone()
    assert concept is not None
    explainer = conn.execute(
        "insert into concept_explainer (concept_id, script, citations, "
        "generator_model, prompt_version) values (%s, 'A script.', '[]', 'm', 1) "
        "returning id",
        (concept[0],),
    ).fetchone()
    assert explainer is not None
    store = PostgresExplainers(conn)
    mine = int(explainer[0])
    # Pending: not voiced.
    assert mine not in {x.explainer_id for x in store.unvoiced(1000)}
    conn.execute(
        "update concept_explainer set status = 'approved', decided_at = now() "
        "where id = %s",
        (mine,),
    )
    assert mine in {x.explainer_id for x in store.unvoiced(1000)}
    assert store.save_audio(mine, "polly", "Joanna", "explainers/k.m3u8", 0.9, WORDS)
    assert not store.save_audio(mine, "polly", "Joanna", "x", 1.0, WORDS)
    assert mine not in {x.explainer_id for x in store.unvoiced(1000)}
    words = conn.execute(
        "select words from explainer_audio where explainer_id = %s", (mine,)
    ).fetchone()
    assert words is not None
    assert words[0] == [
        {"word": "engine", "start": 0.0, "end": 0.4},
        {"word": "x", "start": 0.4, "end": 0.9},
    ]
