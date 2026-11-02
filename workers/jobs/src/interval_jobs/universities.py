"""The university list a player picks from (P3-W14-S03, ADR-0032): name and ISO
country code only, from Hipo's university-domains-list (MIT; the notice is beside the
seed). No domains: universities are picked, never verified by email."""

import json
import re
import unicodedata
from dataclasses import dataclass
from typing import cast

_COUNTRY = re.compile(r"^[A-Z]{2}$")


class UniversitySeedError(ValueError):
    pass


@dataclass(frozen=True)
class UniversitySeed:
    name: str
    country: str


def parse_universities(text: str, where: str) -> list[UniversitySeed]:
    """The seed's universities; UniversitySeedError names what's wrong."""
    try:
        data: object = json.loads(text)
    except json.JSONDecodeError as error:
        raise UniversitySeedError(f"{where}: not JSON ({error.msg})") from error
    entries = (
        cast(dict[str, object], data).get("universities")
        if isinstance(data, dict)
        else None
    )
    if not isinstance(entries, list):
        raise UniversitySeedError(f"{where}: needs a `universities` list")
    out: list[UniversitySeed] = []
    seen: set[UniversitySeed] = set()
    for raw in cast(list[object], entries):
        if not isinstance(raw, dict):
            raise UniversitySeedError(f"{where}: each university must be a mapping")
        entry = cast(dict[str, object], raw)
        name, country = entry.get("name"), entry.get("country")
        if not isinstance(name, str) or not 2 <= len(name) <= 120:
            raise UniversitySeedError(f"{where}: bad name {name!r}")
        if name != " ".join(name.split()):
            raise UniversitySeedError(f"{where}: untidy spaces in {name!r}")
        # As the web checks a typed name: nothing hidden on a public board.
        if any(unicodedata.category(c) in ("Cc", "Cf") for c in name):
            raise UniversitySeedError(f"{where}: a hidden character in {name!r}")
        if not isinstance(country, str) or not _COUNTRY.match(country):
            raise UniversitySeedError(f"{where}: {name} has a bad country {country!r}")
        seed = UniversitySeed(name, country)
        if seed in seen:
            raise UniversitySeedError(f"{where}: {name} ({country}) appears twice")
        seen.add(seed)
        out.append(seed)
    return out
