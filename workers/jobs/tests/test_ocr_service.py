"""The OCR service (ADR-0022, P2-W11-S03): the HTTP adapter on a stub, and the real
Tesseract container (deploy/ocr) when it runs (docker compose up ocr; CI starts it)."""

import os

import httpx
import pytest

from interval_jobs.adapters.http_ocr import HttpOcr
from interval_jobs.books.ocr import MAX_PIXELS
from interval_jobs.books.pdf import open_pdf, render

from .pdf_builder import Spec, TextLine, build


def test_the_adapter_posts_the_png_and_returns_the_text() -> None:
    seen: list[httpx.Request] = []

    def answer(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, text="page text")

    client = httpx.Client(transport=httpx.MockTransport(answer))
    assert HttpOcr("http://ocr:8080/", client).read(b"\x89PNG") == "page text"
    assert str(seen[0].url) == "http://ocr:8080/ocr"
    assert seen[0].content == b"\x89PNG"


def test_a_failing_service_raises_so_the_queue_retries() -> None:
    client = httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(504)))
    with pytest.raises(httpx.HTTPStatusError):
        HttpOcr("http://ocr:8080", client).read(b"\x89PNG")


def _service() -> str | None:
    url = os.environ.get("OCR_URL")
    if not url:
        return None
    try:
        httpx.get(url.rstrip("/") + "/health", timeout=2).raise_for_status()
    except httpx.HTTPError:
        # In CI the container is started for this test: down there is a failure.
        if os.environ.get("CI"):
            raise
        return None
    return url


@pytest.mark.skipif(_service() is None, reason="the OCR container isn't running")
def test_the_real_service_reads_a_rendered_page() -> None:
    url = _service()
    assert url is not None
    data = build(
        Spec(pages=[[TextLine("Replication keeps copies of the same data", 14)]])
    )
    with open_pdf(data) as pdf:
        page = render(pdf, 1, MAX_PIXELS)
    assert "Replication keeps copies" in HttpOcr(url).read(page.png)


@pytest.mark.skipif(_service() is None, reason="the OCR container isn't running")
def test_the_real_service_refuses_what_is_not_an_image() -> None:
    url = _service()
    assert url is not None
    with pytest.raises(httpx.HTTPStatusError) as raised:
        HttpOcr(url).read(b"not an image")
    assert raised.value.response.status_code == 422
