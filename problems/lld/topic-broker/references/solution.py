from __future__ import annotations

import heapq

MAX_POLL = 100
MAX_NACKS = 3
IN_FLIGHT = "in-flight"
DONE = "done"
DEAD = "dead"


def _named(*names: str) -> None:
    if "" in names:
        raise ValueError("an empty name or payload")


def _offset(offset: int) -> None:
    if offset < 0:
        raise ValueError("an offset is at least 0")


class Group:
    """A consumer group: its members share one position in the topic. It covers the
    offsets from `start`; each one below `next` is in `state` or waiting in `again`."""

    def __init__(self, topic: str, start: int) -> None:
        self.topic = topic
        self.consumers: set[str] = set()
        self.start = start
        self.next = start
        self.again: list[int] = []  # a min-heap of offsets to deliver again
        self.state: dict[int, str] = {}
        self.nacks: dict[int, int] = {}
        self.dead: list[int] = []

    def take(self, most: int, end: int) -> list[int]:
        taken = [heapq.heappop(self.again) for _ in range(min(most, len(self.again)))]
        # Redeliveries are always below `next`, so this keeps offset order.
        fresh = min(most - len(taken), end - self.next)
        taken += range(self.next, self.next + fresh)
        self.next += fresh
        for offset in taken:
            self.state[offset] = IN_FLIGHT
        return taken

    def settle(self, offset: int, acked: bool) -> bool:
        if self.state.get(offset) != IN_FLIGHT:
            return False
        if acked:
            self.state[offset] = DONE
            return True
        self.nacks[offset] = self.nacks.get(offset, 0) + 1
        if self.nacks[offset] == MAX_NACKS:
            self.state[offset] = DEAD
            self.dead.append(offset)
        else:
            self._again(offset)
        return True

    def rewind(self, offset: int) -> int:
        made = 0
        for o in range(offset, self.next):
            if o < self.start or self.state.get(o) in (IN_FLIGHT, DONE):
                self.nacks.pop(o, None)
                self._again(o)
                made += 1
        self.start = min(self.start, offset)
        return made

    def _again(self, offset: int) -> None:
        self.state.pop(offset, None)
        heapq.heappush(self.again, offset)


class Broker:
    """The mediator: publishers and consumer groups only ever talk to it, never to
    each other."""

    def __init__(self) -> None:
        self._topics: dict[str, list[str]] = {}
        self._groups: dict[str, Group] = {}

    def publishMsg(self, topic: str, payload: str) -> int:
        _named(topic, payload)
        messages = self._topics.setdefault(topic, [])
        messages.append(payload)
        return len(messages) - 1

    def subscribeGroup(self, group: str, topic: str, consumer: str) -> None:
        _named(group, topic, consumer)
        found = self._groups.get(group)
        if found is None:
            found = Group(topic, len(self._topics.get(topic, [])))
            self._groups[group] = found
        elif found.topic != topic:
            raise ValueError("a group reads one topic")
        found.consumers.add(consumer)

    def poll(self, group: str, consumer: str, max: int) -> list[str]:
        found = self._group(group)
        if consumer not in found.consumers or max < 1 or max > MAX_POLL:
            raise ValueError("not a member, or max outside 1 to 100")
        messages = self._topics.get(found.topic, [])
        return [self._shown(found, o) for o in found.take(max, len(messages))]

    def ack(self, group: str, offset: int) -> bool:
        found = self._group(group)
        _offset(offset)
        return found.settle(offset, True)

    def nack(self, group: str, offset: int) -> bool:
        found = self._group(group)
        _offset(offset)
        return found.settle(offset, False)

    def deadLetters(self, group: str) -> list[str]:
        found = self._group(group)
        return [self._shown(found, o) for o in found.dead]

    # The extension round: rewind a group to an earlier offset.
    def replayFrom(self, group: str, offset: int) -> int:
        found = self._group(group)
        _offset(offset)
        return found.rewind(offset)

    def _shown(self, group: Group, offset: int) -> str:
        return f"{offset}:{self._topics[group.topic][offset]}"

    def _group(self, group: str) -> Group:
        found = self._groups.get(group)
        if found is None:
            raise KeyError("no such group")
        return found
