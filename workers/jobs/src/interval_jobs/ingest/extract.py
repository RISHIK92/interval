"""Main-text extraction.

Provisional choice (trafilatura); P1-W2-S05 confirms or swaps it.
"""

import trafilatura


class ExtractionError(Exception):
    pass


def extract_text(html: bytes, encoding: str | None) -> str:
    # Decode with the charset the server declared; trafilatura detects one otherwise.
    document: str | bytes = (
        html.decode(encoding, errors="replace") if encoding else html
    )
    text = trafilatura.extract(document, include_comments=False, include_tables=False)
    if not text or not text.strip():
        raise ExtractionError("no main text found in page")
    return text.strip()
