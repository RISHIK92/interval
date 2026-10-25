"""The seed list file (Q-P1-02, ING-6): the owner's sources, parsed strictly.

Errors name the file line, so a bad edit is easy to find. The YAML is read as nodes
(the loader's node tree), not plain data, because only nodes keep their line marks.
"""

import re
from dataclasses import dataclass
from typing import cast, get_args

import yaml
from yaml.reader import ReaderError

from interval_db.generated import RightsProfile
from interval_jobs import log
from interval_jobs.ports import Sources, SourceSettings, SyncResult

PROFILES: tuple[str, ...] = get_args(RightsProfile.__value__)
# ING-2 (Q-P1-01 matrix): moments need the body, which only the full-text levels keep.
MOMENT_PROFILES = frozenset({"full_text_internal", "full_text_display"})
TOPIC = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
KEYS = frozenset(
    {
        "name",
        "homepage",
        "feed_url",
        "rights_profile",
        "moments_enabled",
        "paywalled",
        "quality_score",
        "topics",
    }
)


@dataclass(frozen=True)
class SeedSource:
    """One source as written in the seed file, with its line for error messages."""

    name: str
    homepage: str | None
    feed_url: str | None  # None: feedless, skipped in Phase 1
    rights_profile: RightsProfile
    moments_enabled: bool
    paywalled: bool
    quality_score: int | None
    topics: tuple[str, ...]
    line: int


class SeedError(Exception):
    def __init__(self, path: str, line: int, message: str) -> None:
        super().__init__(f"{path}:{line}: {message}")
        self.path = path
        self.line = line
        self.message = message


def _line(node: yaml.Node) -> int:
    return node.start_mark.line + 1


class _Entry:
    """One source's fields, read with their lines."""

    def __init__(self, path: str, node: yaml.MappingNode) -> None:
        self.path = path
        self.node = node
        self.fields: dict[str, yaml.Node] = {}
        for key, value in node.value:
            if not isinstance(key, yaml.ScalarNode) or key.value not in KEYS:
                raise self.fail(key, f"unknown field {key.value!r}")
            if key.value in self.fields:
                raise self.fail(key, f"{key.value} twice in one source")
            self.fields[key.value] = value

    def fail(self, node: yaml.Node, message: str) -> SeedError:
        return SeedError(self.path, _line(node), message)

    def at(self, field: str) -> yaml.Node:
        return self.fields.get(field, self.node)

    def scalar(self, field: str, tag: str) -> str | None:
        node = self.fields.get(field)
        if node is None:
            return None
        if not isinstance(node, yaml.ScalarNode) or node.tag != tag:
            raise self.fail(node, f"{field} must be a {tag.rsplit(':', 1)[1]}")
        return node.value

    def text(self, field: str) -> str | None:
        value = self.scalar(field, "tag:yaml.org,2002:str")
        if value is not None and not value.strip():
            raise self.fail(self.at(field), f"{field} must not be empty")
        return value

    def flag(self, field: str) -> bool:
        # YAML 1.1 also reads yes/no/on/off as booleans; only true/false are clear.
        value = self.scalar(field, "tag:yaml.org,2002:bool")
        if value is None:
            return False
        if value.lower() not in ("true", "false"):
            raise self.fail(self.at(field), f"{field} must be true or false")
        return value.lower() == "true"

    def score(self) -> int | None:
        value = self.scalar("quality_score", "tag:yaml.org,2002:int")
        if value is None:
            return None
        # Plain digits only: YAML 1.1 ints also include 0x3, 0b11 and 1:30.
        if not re.fullmatch(r"[1-5]", value):
            raise self.fail(self.at("quality_score"), "quality_score must be 1 to 5")
        return int(value)

    def topics(self) -> tuple[str, ...]:
        node = self.fields.get("topics")
        if node is None:
            return ()
        if not isinstance(node, yaml.SequenceNode):
            raise self.fail(node, "topics must be a list")
        topics: list[str] = []
        for topic in node.value:
            if (
                not isinstance(topic, yaml.ScalarNode)
                or topic.tag != "tag:yaml.org,2002:str"
                or not TOPIC.match(topic.value)
            ):
                raise self.fail(topic, "topics must be kebab-case, like system-design")
            if topic.value in topics:
                raise self.fail(topic, f"topics lists {topic.value!r} twice")
            topics.append(topic.value)
        return tuple(topics)

    def seed(self) -> SeedSource:
        name = self.text("name")
        if name is None:
            raise self.fail(self.node, "name is required")
        profile = self.text("rights_profile")
        if profile is None:
            raise self.fail(self.node, f"{name}: rights_profile is required")
        if profile not in PROFILES:
            raise self.fail(
                self.at("rights_profile"),
                f"rights_profile {profile!r} is not one of {', '.join(PROFILES)}",
            )
        moments = self.flag("moments_enabled")
        if moments and profile not in MOMENT_PROFILES:
            raise self.fail(
                self.at("moments_enabled"),
                f"moments need a full-text profile, not {profile} (ING-2)",
            )
        return SeedSource(
            name=name,
            homepage=self.text("homepage"),
            feed_url=self.text("feed_url"),
            rights_profile=cast(RightsProfile, profile),
            moments_enabled=moments,
            paywalled=self.flag("paywalled"),
            quality_score=self.score(),
            topics=self.topics(),
            line=_line(self.node),
        )


def parse_seeds(text: str, path: str) -> list[SeedSource]:
    try:
        # The reader checks characters as soon as the loader is built.
        loader = yaml.SafeLoader(text)
        try:
            root = loader.get_single_node()
        finally:
            loader.dispose()
    except yaml.MarkedYAMLError as error:
        mark = error.problem_mark
        line = 1 if mark is None else mark.line + 1
        raise SeedError(path, line, f"invalid YAML: {error.problem}") from error
    except ReaderError as error:
        line = text.count("\n", 0, error.position) + 1
        raise SeedError(path, line, f"invalid character: {error.reason}") from error
    # An empty list would deactivate every source; that is never a valid edit.
    if root is None or (isinstance(root, yaml.SequenceNode) and not root.value):
        raise SeedError(path, 1, "no sources in the file")
    if not isinstance(root, yaml.SequenceNode):
        raise SeedError(path, _line(root), "the file must be a list of sources")

    seeds: list[SeedSource] = []
    names: set[str] = set()
    feeds: set[str] = set()
    for node in root.value:
        if not isinstance(node, yaml.MappingNode):
            raise SeedError(
                path, _line(node), "each source must be a mapping of fields"
            )
        entry = _Entry(path, node)
        seed = entry.seed()
        if seed.name in names:
            raise entry.fail(entry.at("name"), f"duplicate name {seed.name!r}")
        if seed.feed_url is not None and seed.feed_url in feeds:
            raise entry.fail(
                entry.at("feed_url"), f"duplicate feed_url {seed.feed_url!r}"
            )
        names.add(seed.name)
        if seed.feed_url is not None:
            feeds.add(seed.feed_url)
        seeds.append(seed)
    return seeds


def load_seeds(sources: Sources, text: str, path: str) -> tuple[SyncResult, int]:
    """Syncs the seed file into the sources table; returns the result and how many
    feedless sources were skipped (Phase 1 polls feeds only, Q-P1-02).

    A feedless source isn't listed, so an existing row with its name is deactivated
    (owner choice, 2026-10-26): it can't be polled without a feed.
    """
    seeds = parse_seeds(text, path)
    settings: list[SourceSettings] = []
    for seed in seeds:
        if seed.feed_url is None:
            log.info(
                "seeds: feedless source skipped; deactivated if it exists",
                name=seed.name,
                line=seed.line,
            )
            continue
        settings.append(
            SourceSettings(
                name=seed.name,
                homepage=seed.homepage,
                feed_url=seed.feed_url,
                rights_profile=seed.rights_profile,
                moments_enabled=seed.moments_enabled,
                paywalled=seed.paywalled,
                quality_score=seed.quality_score,
                topics=seed.topics,
            )
        )
    return sources.sync(settings), len(seeds) - len(settings)
