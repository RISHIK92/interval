"""robots.txt rules as RFC 9309 reads them, for the polite fetcher (ING-1).

The stdlib's urllib.robotparser takes the first matching rule instead of the longest,
ignores `*` and `$`, and drops fractional Crawl-delay values, so a publisher's wildcard
Disallow would be fetched anyway.
"""

import re
from dataclasses import dataclass
from urllib.parse import urlsplit


@dataclass(frozen=True)
class _Rule:
    allow: bool
    pattern: str
    regex: re.Pattern[str]


def _compile(pattern: str) -> re.Pattern[str]:
    anchored = pattern.endswith("$")
    body = pattern[:-1] if anchored else pattern
    regex = ".*".join(re.escape(part) for part in body.split("*"))
    return re.compile(regex + ("$" if anchored else ""))


@dataclass(frozen=True)
class Robots:
    rules: tuple[_Rule, ...] = ()
    crawl_delay: float | None = None

    def allows(self, url: str) -> bool:
        parts = urlsplit(url)
        path = (parts.path or "/") + (f"?{parts.query}" if parts.query else "")
        if path == "/robots.txt":
            return True
        matches = [rule for rule in self.rules if rule.regex.match(path)]
        if not matches:
            return True
        # The longest pattern wins; on a tie, allow does (RFC 9309 section 2.2.2).
        best = max(matches, key=lambda rule: (len(rule.pattern), rule.allow))
        return best.allow


ALLOW_ALL = Robots()


def parse(text: str, agent: str) -> Robots:
    """The rules for `agent` (a product token such as "Interval"), else for `*`.

    Consecutive user-agent lines open one group; every group naming the agent is merged.
    """
    groups: dict[str, list[_Rule]] = {}
    delays: dict[str, float] = {}
    current: list[str] = []
    in_agents = False
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip()
        if ":" not in line:
            continue
        key, value = (part.strip() for part in line.split(":", 1))
        key = key.lower()
        if key == "user-agent":
            if not in_agents:
                current = []
            current.append(value.lower())
            # A group naming the agent applies even with no rules (`Disallow:` alone).
            groups.setdefault(value.lower(), [])
            in_agents = True
            continue
        in_agents = False
        if key in ("allow", "disallow") and value:
            rule = _Rule(key == "allow", value, _compile(value))
            for name in current:
                groups.setdefault(name, []).append(rule)
        elif key == "crawl-delay":
            try:
                delay = float(value)
            except ValueError:
                continue
            for name in current:
                delays[name] = delay
    name = agent.lower() if agent.lower() in groups else "*"
    return Robots(tuple(groups.get(name, [])), delays.get(name))
