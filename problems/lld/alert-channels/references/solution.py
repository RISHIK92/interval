from __future__ import annotations

from abc import ABC, abstractmethod


class Channel(ABC):
    """One way out. Each kind formats a message its own way and has its own price."""

    price: int  # each kind sets its own

    def __init__(self) -> None:
        self.spent = 0

    @abstractmethod
    def format(self, message: str) -> str: ...

    def deliver(self, message: str) -> str:
        self.spent += self.price
        return self.format(message)


class EmailChannel(Channel):
    price = 1

    def format(self, message: str) -> str:
        return "Subject: " + message


class SmsChannel(Channel):
    price = 5

    def format(self, message: str) -> str:
        if len(message) <= 20:
            return message
        return message[:17] + "..."


class PagerChannel(Channel):
    price = 25

    def format(self, message: str) -> str:
        return message.upper() + "!"


class WebhookChannel(Channel):
    price = 2

    def __init__(self, url: str) -> None:
        super().__init__()
        self.url = url

    def format(self, message: str) -> str:
        return "POST " + self.url + " " + message


KINDS: dict[str, type[Channel]] = {"email": EmailChannel, "sms": SmsChannel, "pager": PagerChannel}


class AlertDispatcher:
    def __init__(self) -> None:
        self._channels: dict[str, Channel] = {}

    def _add(self, name: str, channel: Channel) -> None:
        if name == "" or name in self._channels:
            raise ValueError("a channel needs a new, non-empty name")
        self._channels[name] = channel

    def _channel(self, name: str) -> Channel:
        if name not in self._channels:
            raise KeyError("no such channel")
        return self._channels[name]

    def addChannel(self, name: str, kind: str) -> None:
        if kind not in KINDS:
            raise ValueError("unknown kind")
        self._add(name, KINDS[kind]())

    def send(self, channel: str, message: str) -> str:
        return self._channel(channel).deliver(message)

    def cost(self, channel: str) -> int:
        return self._channel(channel).spent

    # The extension round: a new kind, added without touching the others.
    def addWebhook(self, name: str, url: str) -> None:
        if not url.startswith("https://") or len(url) <= len("https://"):
            raise ValueError("a webhook needs an https:// url")
        self._add(name, WebhookChannel(url))
