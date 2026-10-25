import pytest

from interval_jobs.ingest.extract import ExtractionError, extract_text

from .conftest import fixture_bytes


def test_keeps_article_text_and_drops_navigation_and_footer() -> None:
    text = extract_text(fixture_bytes("article.html"), "utf-8")
    assert "recovery replays the log from the last checkpoint" in text
    assert "NAVIGATION LINKS" not in text
    assert "FOOTER COPYRIGHT TEXT" not in text


def test_decodes_with_the_declared_charset() -> None:
    html = fixture_bytes("article.html").replace(
        b"Recovery starts", "Café starts".encode("cp1252")
    )
    assert "Café starts" in extract_text(html, "cp1252")


def test_page_without_content_raises() -> None:
    with pytest.raises(ExtractionError):
        extract_text(b"<html><body></body></html>", "utf-8")
