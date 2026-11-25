from __future__ import annotations

from typing import Protocol


class Ability(Protocol):
    """One thing a bot can do. A bot is the abilities it holds, not a subclass."""

    takes_argument: bool

    def answer(self, bot: str, argument: str) -> str: ...


class Acts:
    """An ability that does something to its argument and says so."""

    def __init__(self, done: str) -> None:
        self._done = done

    takes_argument = True

    def answer(self, bot: str, argument: str) -> str:
        return f"{self._done} {argument}"


class Status:
    takes_argument = False

    def answer(self, bot: str, argument: str) -> str:
        return f"{bot} ok"


class Audited:
    """Wraps any ability and logs each command it answers; the answer is unchanged."""

    def __init__(self, verb: str, inner: Ability, log: list[str]) -> None:
        self._verb = verb
        self._inner = inner
        self._log = log
        self.takes_argument = inner.takes_argument

    def answer(self, bot: str, argument: str) -> str:
        reply = self._inner.answer(bot, argument)
        command = f"{self._verb} {argument}" if self.takes_argument else self._verb
        self._log.append(f"{command} -> {reply}")
        return reply


KNOWN: dict[str, Ability] = {
    "deploy": Acts("deployed"),
    "page": Acts("paged"),
    "query": Acts("queried"),
    "status": Status(),
}
REFUSAL = "refused"


def _ability(name: str) -> Ability:
    found = KNOWN.get(name)
    if found is None:
        raise ValueError("unknown ability")
    return found


class _Bot:
    def __init__(self) -> None:
        self.held: dict[str, Ability] = {}
        self.log: list[str] | None = None

    def equip(self, name: str) -> None:
        base = _ability(name)
        self.held[name] = base if self.log is None else Audited(name, base, self.log)


class BotFleet:
    def __init__(self) -> None:
        self._bots: dict[str, _Bot] = {}

    def _bot(self, bot: str) -> _Bot:
        found = self._bots.get(bot)
        if found is None:
            raise ValueError("unknown bot")
        return found

    def create(self, bot: str, abilities: list[str]) -> None:
        if bot == "" or bot in self._bots:
            raise ValueError("a bot needs a new, non-empty name")
        for name in abilities:
            _ability(name)
        if len(set(abilities)) != len(abilities):
            raise ValueError("an ability is listed twice")
        made = _Bot()
        for name in abilities:
            made.equip(name)
        self._bots[bot] = made

    def grant(self, bot: str, ability: str) -> bool:
        found = self._bot(bot)
        _ability(ability)
        if ability in found.held:
            return False
        found.equip(ability)
        return True

    def revoke(self, bot: str, ability: str) -> bool:
        found = self._bot(bot)
        _ability(ability)
        return found.held.pop(ability, None) is not None

    def handle(self, bot: str, command: str) -> str:
        found = self._bot(bot)
        verb, space, argument = command.partition(" ")
        shape = _ability(verb)
        fits = argument != "" if shape.takes_argument else space == ""
        if not fits:
            raise ValueError("the command doesn't fit its ability")
        held = found.held.get(verb)
        if held is None:
            return REFUSAL
        return held.answer(bot, argument)

    def abilities(self, bot: str) -> list[str]:
        return sorted(self._bot(bot).held)

    # The extension round: auditing wraps each ability the bot holds, now and later.
    def audit(self, bot: str) -> None:
        found = self._bot(bot)
        if found.log is not None:
            return
        found.log = []
        for name in list(found.held):
            found.equip(name)

    def auditLog(self, bot: str) -> list[str]:
        log = self._bot(bot).log
        return [] if log is None else list(log)
