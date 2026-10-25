"""robots.txt rules read the RFC 9309 way (ING-1): wildcards, longest match, groups."""

import pytest

from interval_jobs.adapters.robots import parse

SITE = "https://blog.example.test"


@pytest.mark.parametrize(
    ("rules", "path", "allowed"),
    [
        ("Disallow: /*.pdf$", "/papers/a.pdf", False),
        ("Disallow: /*.pdf$", "/papers/a.pdf?x=1", True),
        ("Disallow: /a\nAllow: /a/b", "/a/b/c", True),  # longest match wins
        ("Allow: /a/b\nDisallow: /a", "/a/c", False),
        ("Disallow: /p\nAllow: /p", "/p", True),  # a tie goes to allow
        ("Disallow: /search?q=", "/search?q=x", False),
        ("Disallow:", "/anything", True),
        ("Disallow: /", "/robots.txt", True),
    ],
)
def test_rules_match_the_rfc_way(rules: str, path: str, allowed: bool) -> None:
    robots = parse(f"User-agent: *\n{rules}\n", "Interval")
    assert robots.allows(SITE + path) is allowed


def test_a_group_naming_interval_wins_over_the_wildcard_group() -> None:
    text = """
User-agent: *
Disallow: /

User-agent: Googlebot
User-agent: interval  # case does not matter
Disallow:
Crawl-delay: 0.5
"""
    robots = parse(text, "Interval")
    assert robots.allows(SITE + "/posts/x")
    assert robots.crawl_delay == 0.5


def test_the_wildcard_group_applies_when_no_group_names_interval() -> None:
    robots = parse(
        "User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nDisallow: /x\n", "Interval"
    )
    assert robots.allows(SITE + "/posts")
    assert not robots.allows(SITE + "/x/1")
