"""TTS (TTS-1, TTS-3, OPS-4, Q-P4-07, P4-W22-S03): three providers behind one port, each
on only with its key; every call through the gateway against the shared daily budget;
the blind test's samples stored unnamed. Fakes only: no provider is called."""

import base64
import io
import json
import random
from collections.abc import Callable, Generator
from contextlib import contextmanager
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Any, cast

import httpx
import pytest

from interval_db.generated import AiProvider
from interval_jobs import compose
from interval_jobs.adapters.memory import (
    InMemoryAi,
    InMemoryFiles,
    InMemoryPronunciations,
    InMemoryStore,
    InMemoryTtsSamples,
)
from interval_jobs.adapters.s3_files import S3Client, S3Files
from interval_jobs.adapters.tts import ElevenLabsTts, InworldTts, PollyTts, TtsError
from interval_jobs.ai.gateway import AiGateway, OverBudget
from interval_jobs.ports import Pronunciation, Speech, TtsProvider, WordTime
from interval_jobs.tts_blind import (
    TtsScriptsError,
    Unit,
    blind_test,
    parse_scripts,
)

from .test_ai_gateway import FakeEmbeddings, spend
from .test_path_proposer import NOW, ScriptedLlm

MP3 = b"ID3fake-mp3"
SEED = Path(__file__).parents[1] / "seeds" / "tts_scripts.yaml"


def client(reply: httpx.Response, seen: list[httpx.Request]) -> httpx.Client:
    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return reply

    return httpx.Client(transport=httpx.MockTransport(handle))


def test_elevenlabs_gives_audio_and_each_words_time() -> None:
    seen: list[httpx.Request] = []
    reply = httpx.Response(
        200,
        json={
            "audio_base64": base64.b64encode(MP3).decode(),
            "alignment": {
                "characters": list("Hi you"),
                "character_start_times_seconds": [0.0, 0.1, 0.2, 0.3, 0.4, 0.5],
                "character_end_times_seconds": [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
            },
        },
    )
    got = ElevenLabsTts(client(reply, seen), "k", "v1").speak("Hi you")
    assert got.audio == MP3
    assert got.words == [WordTime("Hi", 0.0, 0.2), WordTime("you", 0.3, 0.6)]
    assert got.characters == 6 and got.cost_usd == Decimal("0.0018")
    (request,) = seen
    assert request.url.path == "/v1/text-to-speech/v1/with-timestamps"
    assert request.headers["xi-api-key"] == "k"
    assert json.loads(request.content) == {
        "text": "Hi you",
        "model_id": ElevenLabsTts.MODEL,
    }


def test_inworld_asks_for_word_times_with_its_portal_key() -> None:
    seen: list[httpx.Request] = []
    reply = httpx.Response(
        200,
        json={
            "audioContent": base64.b64encode(MP3).decode(),
            "timestampInfo": {
                "wordAlignment": {
                    "words": ["Hi", "you"],
                    "wordStartTimeSeconds": [0.0, 0.3],
                    "wordEndTimeSeconds": [0.2, 0.6],
                }
            },
        },
    )
    got = InworldTts(client(reply, seen), "BASE64KEY", "Ashley").speak("Hi you")
    assert got.audio == MP3
    assert got.words == [WordTime("Hi", 0.0, 0.2), WordTime("you", 0.3, 0.6)]
    (request,) = seen
    assert str(request.url) == InworldTts.URL
    assert request.headers["authorization"] == "Basic BASE64KEY"
    body = json.loads(request.content)
    assert body["timestampType"] == "WORD" and body["voiceId"] == "Ashley"
    assert body["audioConfig"] == {"audioEncoding": "MP3"}


def _eleven(c: httpx.Client) -> TtsProvider:
    return ElevenLabsTts(c, "k", "v")


def _inworld(c: httpx.Client) -> TtsProvider:
    return InworldTts(c, "k", "v")


def test_an_answer_not_understood_is_an_error_not_audio() -> None:
    seen: list[httpx.Request] = []
    garbled = httpx.Response(200, json={"audio_base64": 3})
    with pytest.raises(TtsError, match="not understood"):
        ElevenLabsTts(client(garbled, seen), "k", "v").speak("Hi")


@pytest.mark.parametrize("make", [_eleven, _inworld])
def test_a_refusal_is_an_error_not_audio(
    make: Callable[[httpx.Client], TtsProvider],
) -> None:
    seen: list[httpx.Request] = []
    tts = make(client(httpx.Response(401), seen))
    with pytest.raises(TtsError):
        tts.speak("Hi")


@dataclass
class FakePolly:
    calls: list[dict[str, object]]

    def synthesize_speech(self, **kwargs: object) -> dict[str, Any]:
        self.calls.append(kwargs)
        if kwargs["OutputFormat"] == "json":
            marks = [
                {"time": 0, "type": "word", "value": "Hi"},
                {"time": 300, "type": "word", "value": "you"},
            ]
            data = "\n".join(json.dumps(m) for m in marks).encode()
        else:
            data = MP3
        return {"AudioStream": io.BytesIO(data)}


def test_polly_says_it_then_asks_for_word_marks() -> None:
    fake = FakePolly([])
    got = PollyTts(fake, "Joanna").speak("Hi you")
    assert got.audio == MP3
    assert got.words == [WordTime("Hi", 0.0, 0.3), WordTime("you", 0.3, 0.8)]
    # Both calls are billed.
    assert got.characters == 12
    assert [c["OutputFormat"] for c in fake.calls] == ["mp3", "json"]
    assert fake.calls[1]["SpeechMarkTypes"] == ["word"]
    assert all(c["Engine"] == "neural" and c["VoiceId"] == "Joanna" for c in fake.calls)


@dataclass
class FakeTts:
    name: AiProvider
    said: list[str]

    @property
    def provider(self) -> AiProvider:
        return self.name

    @property
    def voice(self) -> str:
        return "v"

    def speak(self, text: str) -> Speech:
        self.said.append(text)
        return Speech(MP3, None, len(text), Decimal("0.01"))


def gateway(spent: str | None = None) -> tuple[AiGateway, InMemoryAi]:
    ledger = InMemoryAi(InMemoryStore().users)
    if spent is not None:
        spend(ledger, None, spent, NOW)
    return AiGateway(
        ledger, ScriptedLlm([]), FakeEmbeddings(), clock=lambda: NOW
    ), ledger


def test_speech_is_recorded_against_the_shared_budget_and_stops_over_it() -> None:
    gw, ledger = gateway()
    tts = FakeTts("polly", [])
    got = gw.speak(feature="tts", tts=tts, text="Hello")
    assert not isinstance(got, OverBudget) and got.speech.audio == MP3
    assert got.usage.provider == "polly" and got.usage.feature == "tts"
    assert got.usage.cost_usd == Decimal("0.01")
    recorded = [u for u in ledger.rows if u.feature == "tts"]
    assert [(u.provider, u.model, u.input_tokens, u.cost_usd) for u in recorded] == [
        ("polly", "v", 5, Decimal("0.01"))
    ]
    over, _ = gateway(spent="100")
    assert isinstance(over.speak(feature="tts", tts=tts, text="Hi"), OverBudget)
    assert tts.said == ["Hello"]


def test_each_provider_is_on_only_with_its_key_and_voice(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for name in (
        "ELEVENLABS_API_KEY",
        "ELEVENLABS_VOICE",
        "INWORLD_API_KEY",
        "INWORLD_VOICE",
        "POLLY_VOICE",
        "TTS_PROVIDER",
    ):
        monkeypatch.delenv(name, raising=False)
    with httpx.Client() as http:
        assert compose.tts_providers(http) == []
        monkeypatch.setenv("ELEVENLABS_API_KEY", "k")
        assert compose.tts_providers(http) == []  # no voice yet
        monkeypatch.setenv("ELEVENLABS_VOICE", "v")
        monkeypatch.setenv("INWORLD_API_KEY", "k")
        monkeypatch.setenv("INWORLD_VOICE", "Ashley")
        assert [p.provider for p in compose.tts_providers(http)] == [
            "elevenlabs",
            "inworld",
        ]
        assert compose.tts_provider(http) is None
        monkeypatch.setenv("TTS_PROVIDER", "inworld")
        chosen = compose.tts_provider(http)
        assert chosen is not None and chosen.provider == "inworld"


def test_the_repos_scripts_parse_and_a_wrong_file_is_refused() -> None:
    assert len(parse_scripts(SEED.read_text(encoding="utf-8"))) == 5
    with pytest.raises(TtsScriptsError):
        parse_scripts("scripts:\n  - one\n")
    with pytest.raises(TtsScriptsError):
        parse_scripts("- not\n- a map\n")


@dataclass
class StubStore:
    tts_samples: InMemoryTtsSamples
    pronunciations: InMemoryPronunciations


def blind_setup(
    spent: str | None = None,
) -> tuple[StubStore, InMemoryFiles, AiGateway, Unit]:
    store = StubStore(InMemoryTtsSamples(), InMemoryPronunciations())
    store.pronunciations.load([Pronunciation("nginx", "engine x")])
    gw, _ = gateway(spent)

    @contextmanager
    def unit() -> Generator[StubStore]:
        yield store

    return store, InMemoryFiles(), gw, cast(Unit, unit)


SCRIPTS = [f"Script {n} behind nginx." for n in range(1, 6)]


def test_the_blind_test_stores_each_providers_audio_unnamed_and_shuffled() -> None:
    store, files, gw, unit = blind_setup()
    eleven, inworld = FakeTts("elevenlabs", []), FakeTts("inworld", [])
    got = blind_test(unit, gw, files, [eleven, inworld], SCRIPTS, random.Random(3))
    assert got.made == 10 and not got.over_budget
    # The dictionary applies first.
    assert eleven.said[0] == "Script 1 behind engine x."
    by_script: dict[int, set[str]] = {}
    for run, number, provider, label, key in store.tts_samples.saved:
        assert run == got.run
        assert key == f"tts-blind/{run}/{number}-{label}.mp3"
        assert files.stored[key] == MP3 and files.types[key] == "audio/mpeg"
        # The label never names the provider; providers are shuffled per script.
        by_script.setdefault(number, set()).add(label)
        assert provider in ("elevenlabs", "inworld")
    assert all(labels == {"A", "B"} for labels in by_script.values())
    # Saved (so numbered) in label order: an id never hints at whose voice it is.
    for number in range(1, 6):
        assert [
            label for _, n, _, label, _ in store.tts_samples.saved if n == number
        ] == ["A", "B"]
    firsts = {
        number: provider
        for _, number, provider, label, _ in store.tts_samples.saved
        if label == "A"
    }
    assert len(set(firsts.values())) == 2  # A isn't always the same provider


def test_the_blind_test_stops_at_the_budget_and_needs_two_providers() -> None:
    store, files, gw, unit = blind_setup(spent="100")
    got = blind_test(
        unit, gw, files, [FakeTts("polly", []), FakeTts("inworld", [])], SCRIPTS
    )
    assert got.over_budget and got.made == 0 and files.stored == {}
    with pytest.raises(TtsScriptsError, match="2-3 providers"):
        blind_test(unit, gw, files, [FakeTts("polly", [])], SCRIPTS)
    assert store.tts_samples.saved == []


@dataclass
class FakeS3:
    put: list[dict[str, object]]

    def get_object(self, *, Bucket: str, Key: str) -> dict[str, Any]:
        raise NotImplementedError

    def delete_object(self, *, Bucket: str, Key: str) -> dict[str, Any]:
        return {}

    def put_object(
        self, *, Bucket: str, Key: str, Body: bytes, ContentType: str
    ) -> dict[str, Any]:
        self.put.append(
            {"Bucket": Bucket, "Key": Key, "Body": Body, "ContentType": ContentType}
        )
        return {}


def test_files_are_put_with_their_type() -> None:
    fake = FakeS3([])
    S3Files(cast(S3Client, fake), "private").put("a/b.mp3", MP3, "audio/mpeg")
    assert fake.put == [
        {
            "Bucket": "private",
            "Key": "a/b.mp3",
            "Body": MP3,
            "ContentType": "audio/mpeg",
        }
    ]
