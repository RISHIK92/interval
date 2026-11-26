from __future__ import annotations

FIELDS = 3
MAX_AGE = 150
MAX_SECONDS = 10**9
MS_PER_SECOND = 1000
EVENT_TYPES = ("click", "view", "buy")


def whole(text: str, most: int) -> int | None:
    """A whole number written without leading zeros, at most `most`; None otherwise."""
    if not text.isdigit() or (len(text) > 1 and text[0] == "0") or int(text) > most:
        return None
    return int(text)


class Importer:
    """The template method: `run` fixes the skeleton (extract, validate, transform,
    optionally dedupe, load) and each kind fills in only the steps that differ."""

    def __init__(self) -> None:
        self.loaded: list[str] = []
        self.rejects: list[str] = []
        self.keys: set[str] = set()
        self.runs = 0

    def validate(self, fields: list[str]) -> str | None:
        raise NotImplementedError

    def transform(self, fields: list[str]) -> str:
        raise NotImplementedError

    def key(self, fields: list[str]) -> str:
        raise NotImplementedError

    def run(self, lines: list[str], dedupe: bool) -> dict[str, int]:
        if "" in lines:
            raise ValueError("an empty line")
        self.runs += 1
        counts = {"read": len(lines), "loaded": 0, "rejected": 0}
        if dedupe:
            counts["duplicates"] = 0
        for number, line in enumerate(lines, 1):
            fields = line.split(",")
            reason = "fields" if len(fields) != FIELDS else self.validate(fields)
            if reason is not None:
                self.rejects.append(f"{self.runs}:{number} {reason}")
                counts["rejected"] += 1
                continue
            key = self.key(fields)
            if dedupe and key in self.keys:
                counts["duplicates"] += 1
                continue
            self.keys.add(key)
            self.loaded.append(self.transform(fields))
            counts["loaded"] += 1
        return counts


class UserImporter(Importer):
    """email,name,age"""

    def validate(self, fields: list[str]) -> str | None:
        email, name, age = fields
        local, at, domain = email.partition("@")
        if local == "" or domain == "" or "@" in domain:
            return "email"
        if name == "":
            return "name"
        if whole(age, MAX_AGE) is None:
            return "age"
        return None

    def transform(self, fields: list[str]) -> str:
        email, name, age = fields
        return f"user:{email.lower()}:{name}:{age}"

    def key(self, fields: list[str]) -> str:
        return fields[0].lower()


class EventImporter(Importer):
    """ts,type,user, with ts in seconds"""

    def validate(self, fields: list[str]) -> str | None:
        ts, kind, user = fields
        if whole(ts, MAX_SECONDS) is None:
            return "ts"
        if kind not in EVENT_TYPES:
            return "type"
        if user == "":
            return "user"
        return None

    def transform(self, fields: list[str]) -> str:
        ts, kind, user = fields
        return f"event:{int(ts) * MS_PER_SECOND}:{kind}:{user}"

    def key(self, fields: list[str]) -> str:
        return self.transform(fields)


KINDS = {"users": UserImporter, "events": EventImporter}


class ImportJob:
    def __init__(self, kind: str) -> None:
        if kind not in KINDS:
            raise ValueError("unknown kind")
        self._importer = KINDS[kind]()
        self._dedupe = False

    def runImport(self, lines: list[str]) -> dict[str, int]:
        return self._importer.run(lines, self._dedupe)

    def loaded(self) -> list[str]:
        return list(self._importer.loaded)

    def rejects(self) -> list[str]:
        return list(self._importer.rejects)

    # The extension round: the skeleton's optional step, switched on or off.
    def dedupe(self, on: bool) -> None:
        self._dedupe = on
