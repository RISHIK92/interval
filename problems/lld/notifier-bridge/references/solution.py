from __future__ import annotations

from abc import ABC, abstractmethod

MIN_LIMIT = 10
MAX_LIMIT = 10_000


class Channel(ABC):
    """The implementor side of the bridge: how a channel marks a heading, breaks a
    line, and how long a message it carries. Channels know nothing about kinds."""

    def __init__(self, limit: int) -> None:
        self.limit = limit
        self.sent = 0

    @abstractmethod
    def heading(self, text: str) -> str: ...

    @abstractmethod
    def lineBreak(self) -> str: ...


class Email(Channel):
    def heading(self, text: str) -> str:
        return f"Subject: {text}"

    def lineBreak(self) -> str:
        return "\n"


class Chat(Channel):
    def heading(self, text: str) -> str:
        return f"*{text}*"

    def lineBreak(self) -> str:
        return "\n"


class Sms(Channel):
    def heading(self, text: str) -> str:
        return text

    def lineBreak(self) -> str:
        return " | "


class Push(Channel):
    """The extension's channel."""

    def heading(self, text: str) -> str:
        return text

    def lineBreak(self) -> str:
        return " - "


class Message(ABC):
    """The abstraction side: a kind lays its message out using only what a channel
    offers, so any kind works with any channel, and a new channel works with every
    kind it never heard of."""

    def __init__(self, channel: Channel) -> None:
        self.channel = channel

    @abstractmethod
    def layout(self, subject: str, body: str) -> str: ...

    def fit(self, text: str) -> str:
        """Over the channel's limit, the text is cut and ends in "..."."""
        limit = self.channel.limit
        return text if len(text) <= limit else text[: limit - 3] + "..."

    def render(self, subject: str, body: str) -> str:
        return self.fit(self.layout(subject, body))


class Alert(Message):
    def layout(self, subject: str, body: str) -> str:
        c = self.channel
        return c.heading(f"ALERT: {subject}") + c.lineBreak() + body


class Digest(Message):
    def layout(self, subject: str, body: str) -> str:
        c = self.channel
        items = [item.strip(" ") for item in body.split(";")]
        lines = [f"- {item}" for item in items if item != ""]
        return c.heading(f"Digest: {subject}") + "".join(
            c.lineBreak() + line for line in lines
        )


class Receipt(Message):
    def layout(self, subject: str, body: str) -> str:
        c = self.channel
        return (
            c.heading(f"Receipt: {subject}")
            + c.lineBreak()
            + body
            + c.lineBreak()
            + "Keep this for your records."
        )

    def fit(self, text: str) -> str:
        # A receipt is a record: cutting it short would lose what it is for.
        if len(text) > self.channel.limit:
            raise ValueError("a receipt never gets cut short")
        return text


KINDS: dict[str, type[Message]] = {"alert": Alert, "digest": Digest, "receipt": Receipt}


class Notifier:
    def __init__(self) -> None:
        self._channels: dict[str, Channel] = {
            "email": Email(2000),
            "chat": Chat(500),
            "sms": Sms(160),
        }

    def send(self, kind: str, channel: str, subject: str, body: str) -> str:
        found = KINDS.get(kind)
        if found is None:
            raise ValueError("unknown kind")
        through = self._channel(channel)
        if subject == "" or body == "":
            raise ValueError("empty")
        text = found(through).render(subject, body)
        through.sent += 1
        return text

    def sent(self, channel: str) -> int:
        return self._channel(channel).sent

    def channelLimit(self, channel: str, maxChars: int) -> None:
        through = self._channel(channel)
        if not MIN_LIMIT <= maxChars <= MAX_LIMIT:
            raise ValueError("a limit is 10 to 10000")
        through.limit = maxChars

    # The extension round: a fourth channel, and no kind changes.
    def addPush(self) -> bool:
        if "push" in self._channels:
            return False
        self._channels["push"] = Push(100)
        return True

    def _channel(self, name: str) -> Channel:
        found = self._channels.get(name)
        if found is None:
            raise ValueError("unknown channel")
        return found
