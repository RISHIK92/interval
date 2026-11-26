from __future__ import annotations

ROLES = ("qa", "security")


class Train:
    """A colleague: it knows its own changes and sign-offs, never the other trains."""

    def __init__(self, name: str, needs: tuple[str, ...]) -> None:
        self.name = name
        self.needs = needs
        self.changes: dict[str, str] = {}  # change -> team, in boarding order
        self.signed: set[str] = set()
        self.departed = False

    def ready(self) -> bool:
        return all(role in self.signed for role in self.needs)

    def take(self, change: str, team: str) -> None:
        self.changes[change] = team
        self.signed.clear()

    def drop(self, change: str) -> str:
        self.signed.clear()
        return self.changes.pop(change)


class ReleaseTrain:
    """The mediator: teams, reviewers and trains only talk to it, and it keeps the
    rule that any change to a train's contents voids its sign-offs."""

    def __init__(self) -> None:
        self._trains: list[Train] = []
        self._aboard: dict[str, Train] = {}
        self._departed: set[str] = set()

    def board(self, team: str, change: str) -> str:
        if team == "" or change == "":
            raise ValueError("empty name")
        if change in self._aboard or change in self._departed:
            raise ValueError("the change has boarded")
        train = next((t for t in self._trains if self._boarding(t)), None)
        if train is None:
            train = self._new(ROLES)
        train.take(change, team)
        self._aboard[change] = train
        return train.name

    def signOff(self, role: str, train: str) -> bool:
        if role not in ROLES:
            raise ValueError("unknown role")
        t = self._train(train)
        if t.departed or not t.changes or role not in t.needs or role in t.signed:
            return False
        t.signed.add(role)
        return True

    def pull(self, change: str) -> bool:
        if change == "":
            raise ValueError("empty change")
        train = self._aboard.pop(change, None)
        if train is None:
            return False
        train.drop(change)
        return True

    def depart(self, train: str) -> list[str]:
        t = self._train(train)
        if t.departed or not t.ready():
            return []
        t.departed = True
        for change in t.changes:
            del self._aboard[change]
            self._departed.add(change)
        return [f"{team}:{change}" for change, team in t.changes.items()]

    # The extension round: a hotfix leaves its train and departs alone.
    def hotfix(self, change: str) -> str:
        train = self._aboard.get(change)
        if train is None or train.needs != ROLES:
            raise ValueError("not aboard a regular train")
        alone = self._new(("security",))
        alone.take(change, train.drop(change))
        self._aboard[change] = alone
        return alone.name

    def _boarding(self, t: Train) -> bool:
        return not t.departed and t.needs == ROLES and not t.ready()

    def _new(self, needs: tuple[str, ...]) -> Train:
        train = Train(f"T{len(self._trains) + 1}", needs)
        self._trains.append(train)
        return train

    def _train(self, name: str) -> Train:
        found = next((t for t in self._trains if t.name == name), None)
        if found is None:
            raise ValueError("unknown train")
        return found
