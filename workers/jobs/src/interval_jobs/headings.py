"""Heading text, cleaned the same way wherever it is compared: the extractor matching
publisher ids, and tagging finding a moment's heading line in the stored text."""

import unicodedata

# Permalink glyphs that publishing tools append to headings (Sphinx, MkDocs, Hugo).
PERMALINK_GLYPHS = "¶#§🔗"
HEADING_MAX_CHARS = 300


def _strip_format_chars(text: str) -> str:
    # Zero-width spaces and similar (Unicode category Cf) differ between parsers.
    return "".join(ch for ch in text if unicodedata.category(ch) != "Cf")


def clean_heading(text: str) -> str:
    cleaned = (
        " ".join(_strip_format_chars(text).split()).rstrip(PERMALINK_GLYPHS).strip()
    )
    return cleaned[:HEADING_MAX_CHARS]


def heading_key(text: str) -> str:
    """For comparing: whitespace collapsed, format characters gone, case folded."""
    return " ".join(_strip_format_chars(text).split()).casefold()
