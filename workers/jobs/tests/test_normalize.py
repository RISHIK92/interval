"""Normalize (ING-1, Q-P1-08): canonical URLs and the near-duplicate fingerprint."""

import pytest

from interval_jobs.normalize import clean_url, near_duplicates, page_canonical, simhash

POST = "https://blog.example.test/posts/wal"
PROSE = " ".join(
    f"Paragraph {i} explains how the write-ahead log is replayed after a crash."
    for i in range(40)
)


@pytest.mark.parametrize(
    ("url", "clean"),
    [
        (POST + "?utm_source=rss&utm_medium=feed", POST),
        (POST + "?id=7&fbclid=x&gclid=y&mc_cid=z", POST + "?id=7"),
        ("HTTPS://Blog.Example.TEST:443/posts/wal#comments", POST),
        ("http://blog.example.test:80", "http://blog.example.test/"),
        (POST + "?b=2&a=1", POST + "?b=2&a=1"),  # the publisher's order is kept
        (POST + "?q=a%20b&utm_campaign=x", POST + "?q=a%20b"),  # and its encoding
        ("http://[2001:db8::1]:8080/a", "http://[2001:db8::1]:8080/a"),
    ],
)
def test_tracking_params_fragments_and_default_ports_are_stripped(
    url: str, clean: str
) -> None:
    assert clean_url(url) == clean


def page(head: str) -> bytes:
    return f"<html><head>{head}</head><body><p>x</p></body></html>".encode()


def test_a_same_site_canonical_link_wins() -> None:
    html = page('<link rel="canonical" href="/posts/wal?utm_source=x">')
    assert page_canonical(html, "utf-8", POST + "?page=1") == POST


def test_www_and_bare_host_are_the_same_site() -> None:
    html = page('<link rel="canonical" href="https://www.blog.example.test/posts/wal">')
    assert (
        page_canonical(html, "utf-8", POST) == "https://www.blog.example.test/posts/wal"
    )


def test_a_cross_site_canonical_is_ignored() -> None:
    html = page('<link rel="canonical" href="https://medium.example.test/@x/wal-123">')
    assert page_canonical(html, "utf-8", POST + "?utm_source=rss") == POST


def test_without_a_canonical_link_the_final_url_is_used() -> None:
    assert page_canonical(page(""), "utf-8", POST + "#top") == POST


def test_a_lightly_edited_copy_is_a_near_duplicate() -> None:
    edited = PROSE.replace("Paragraph 3 explains", "Paragraph 3 shows")
    a, b = simhash(PROSE), simhash(edited)
    assert a is not None and b is not None and near_duplicates(a, b)


def test_a_different_article_is_not_a_near_duplicate() -> None:
    other = " ".join(
        f"Section {i} covers consistent hashing and how shards move between nodes."
        for i in range(40)
    )
    a, b = simhash(PROSE), simhash(other)
    assert a is not None and b is not None and not near_duplicates(a, b)


def test_the_fingerprint_fits_a_signed_64_bit_column() -> None:
    value = simhash(PROSE)
    assert value is not None and -(2**63) <= value < 2**63


def test_a_malformed_port_is_an_error_the_caller_can_catch() -> None:
    with pytest.raises(ValueError):
        clean_url("https://blog.example.test:99999/p")


def test_a_malformed_or_homepage_canonical_is_ignored() -> None:
    bad = page('<link rel="canonical" href="https://blog.example.test:abc/x">')
    assert page_canonical(bad, "utf-8", POST) == POST
    home = page('<link rel="canonical" href="https://blog.example.test/">')
    assert page_canonical(home, "utf-8", POST) == POST


def test_text_too_short_to_fingerprint_gets_no_simhash() -> None:
    # Stubs ("Subscribe to read") would otherwise all look like one article.
    assert simhash("Subscribe to read") is None
    assert simhash("") is None
