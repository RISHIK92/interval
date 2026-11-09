"""TTS providers (TTS-1, TTS-3, Q-P4-07, P4-W22-S03): ElevenLabs and Inworld over HTTP,
Amazon Polly through boto3. Each gives MP3 and each word's time. Request and response
shapes are as each provider's API reference gave them on 2026-11-09.

Costs are list prices per 1,000 characters, an estimate the shared daily budget counts
(OPS-4); the account's own plan may differ, so they are kept here, named."""

import base64
import json
from decimal import Decimal
from typing import Any, Protocol

import httpx
from pydantic import BaseModel

from interval_db.generated import AiProvider
from interval_jobs.ports import Speech, WordTime


class TtsError(RuntimeError):
    """The provider refused or answered with something unusable; nothing is stored.
    A network failure (httpx, botocore) is raised as itself."""


def _cost(characters: int, per_thousand: str) -> Decimal:
    return (Decimal(characters) * Decimal(per_thousand) / 1000).quantize(
        Decimal("0.000001")
    )


def _words_from_characters(
    characters: list[str], starts: list[float], ends: list[float]
) -> list[WordTime]:
    """Characters' times grouped into words (runs of non-space characters)."""
    words: list[WordTime] = []
    current: list[str] = []
    start = 0.0
    end = 0.0
    for char, s, e in zip(characters, starts, ends, strict=True):
        if char.isspace():
            if current:
                words.append(WordTime("".join(current), start, end))
                current = []
            continue
        if not current:
            start = s
        current.append(char)
        end = e
    if current:
        words.append(WordTime("".join(current), start, end))
    return words


class _ElevenLabsAlignment(BaseModel):
    characters: list[str]
    character_start_times_seconds: list[float]
    character_end_times_seconds: list[float]


class _ElevenLabsReply(BaseModel):
    audio_base64: str
    alignment: _ElevenLabsAlignment | None = None


class ElevenLabsTts:
    URL = "https://api.elevenlabs.io/v1/text-to-speech/{voice}/with-timestamps"
    MODEL = "eleven_multilingual_v2"
    PER_THOUSAND = "0.30"  # list price, an estimate

    def __init__(self, client: httpx.Client, key: str, voice: str) -> None:
        self._client = client
        self._key = key
        self._voice = voice

    @property
    def provider(self) -> AiProvider:
        return "elevenlabs"

    @property
    def voice(self) -> str:
        return self._voice

    def speak(self, text: str) -> Speech:
        response = self._client.post(
            self.URL.format(voice=self._voice),
            headers={"xi-api-key": self._key},
            params={"output_format": "mp3_44100_128"},
            json={"text": text, "model_id": self.MODEL},
            timeout=120,
        )
        if response.status_code != 200:
            raise TtsError(f"elevenlabs: {response.status_code}")
        try:
            return self._speech(text, _ElevenLabsReply.model_validate(response.json()))
        except (ValueError, KeyError) as error:  # pydantic's too, and zip's lengths
            raise TtsError(f"elevenlabs: an answer not understood: {error}") from error

    def _speech(self, text: str, reply: "_ElevenLabsReply") -> Speech:
        a = reply.alignment
        return Speech(
            base64.b64decode(reply.audio_base64),
            None
            if a is None
            else _words_from_characters(
                a.characters,
                a.character_start_times_seconds,
                a.character_end_times_seconds,
            ),
            len(text),
            _cost(len(text), self.PER_THOUSAND),
        )


class _InworldWords(BaseModel):
    words: list[str]
    wordStartTimeSeconds: list[float]
    wordEndTimeSeconds: list[float]


class _InworldTimestamps(BaseModel):
    wordAlignment: _InworldWords | None = None


class _InworldReply(BaseModel):
    audioContent: str
    timestampInfo: _InworldTimestamps | None = None


class InworldTts:
    URL = "https://api.inworld.ai/tts/v1/voice"
    MODEL = "inworld-tts-1.5-max"
    PER_THOUSAND = "0.05"  # list price, an estimate

    def __init__(self, client: httpx.Client, key: str, voice: str) -> None:
        self._client = client
        self._key = key  # the Base64 credentials from Inworld's portal, as given
        self._voice = voice

    @property
    def provider(self) -> AiProvider:
        return "inworld"

    @property
    def voice(self) -> str:
        return self._voice

    def speak(self, text: str) -> Speech:
        response = self._client.post(
            self.URL,
            headers={"Authorization": f"Basic {self._key}"},
            json={
                "text": text,
                "voiceId": self._voice,
                "modelId": self.MODEL,
                "audioConfig": {"audioEncoding": "MP3"},
                "timestampType": "WORD",
            },
            timeout=120,
        )
        if response.status_code != 200:
            raise TtsError(f"inworld: {response.status_code}")
        try:
            return self._speech(text, _InworldReply.model_validate(response.json()))
        except (ValueError, KeyError) as error:
            raise TtsError(f"inworld: an answer not understood: {error}") from error

    def _speech(self, text: str, reply: "_InworldReply") -> Speech:
        info = reply.timestampInfo
        w = None if info is None else info.wordAlignment
        return Speech(
            base64.b64decode(reply.audioContent),
            None
            if w is None
            else [
                WordTime(word, start, end)
                for word, start, end in zip(
                    w.words, w.wordStartTimeSeconds, w.wordEndTimeSeconds, strict=True
                )
            ],
            len(text),
            _cost(len(text), self.PER_THOUSAND),
        )


class PollyClient(Protocol):
    """The boto3 Polly call this adapter makes (boto3 ships no type stubs)."""

    def synthesize_speech(self, **kwargs: object) -> dict[str, Any]: ...


class PollyTts:
    PER_THOUSAND = "0.016"  # neural, list price, an estimate
    # Polly's word marks give each word's start only; a word ends where the next
    # starts (a word before a pause keeps it), the last this long after its start.
    LAST_WORD_SECONDS = 0.5

    def __init__(self, client: PollyClient, voice: str) -> None:
        self._client = client
        self._voice = voice

    @property
    def provider(self) -> AiProvider:
        return "polly"

    @property
    def voice(self) -> str:
        return self._voice

    def _call(self, text: str, output: str, marks: list[str] | None = None) -> bytes:
        response = self._client.synthesize_speech(
            Text=text,
            VoiceId=self._voice,
            Engine="neural",
            OutputFormat=output,
            **({} if marks is None else {"SpeechMarkTypes": marks}),
        )
        stream: Any = response["AudioStream"]
        data: bytes = stream.read()
        return data

    def speak(self, text: str) -> Speech:
        audio = self._call(text, "mp3")
        marks = self._call(text, "json", ["word"])
        starts: list[tuple[str, float]] = []
        try:
            for line in marks.decode().splitlines():
                if line.strip():
                    mark = json.loads(line)
                    starts.append((str(mark["value"]), int(mark["time"]) / 1000))
        except (ValueError, KeyError) as error:
            raise TtsError(f"polly: word marks not understood: {error}") from error
        words = [
            WordTime(
                word,
                start,
                starts[i + 1][1]
                if i + 1 < len(starts)
                else start + self.LAST_WORD_SECONDS,
            )
            for i, (word, start) in enumerate(starts)
        ]
        # Both calls are billed by their characters.
        return Speech(
            audio, words, 2 * len(text), _cost(2 * len(text), self.PER_THOUSAND)
        )
