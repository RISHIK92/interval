"""Turns a fetched seed-source page into a test fixture that keeps no publisher prose.

The markup and heading text stay, so extraction sees the page's real structure. Every
other text node, and every descriptive attribute (alt, title, aria-*, placeholder,
data-*), is scrambled letter by letter: same word and character counts, so trafilatura's
text-density checks behave the same. Digits and punctuation are kept. Scripts, styles,
comments and meta tags are dropped: some carry the full article as JSON. When the
fixtures were made, each reduced page was checked by hand to extract exactly like its
original (sections, levels, ids and word counts).

    cd workers/jobs/tests/fixtures/real && uv run python reduce.py page.html > name.html
"""

import sys
from html import escape
from html.parser import HTMLParser
from pathlib import Path

_FILLER = "loremipsumdolorsitametconsecteturadipiscingelit"
_HEADINGS = frozenset({"h1", "h2", "h3", "h4", "h5", "h6", "title"})
_DROPPED = frozenset({"script", "style", "noscript", "template"})
# Formatting inside a heading; any other tag means the heading was left unclosed.
_INLINE = frozenset({"a", "span", "code", "em", "strong", "b", "i", "small", "sup"})
_SCRAMBLED_ATTRS = frozenset(
    {"alt", "title", "aria-label", "aria-description", "placeholder"}
)
_VOID = frozenset(
    {
        "area",
        "base",
        "br",
        "col",
        "embed",
        "hr",
        "img",
        "input",
        "link",
        "source",
        "wbr",
    }
)


def scramble(text: str) -> str:
    out: list[str] = []
    index = 0
    for ch in text:
        if ch.isalpha():
            filler = _FILLER[index % len(_FILLER)]
            out.append(filler.upper() if ch.isupper() else filler)
            index += 1
        else:
            out.append(ch)
    return "".join(out)


class _Reducer(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self._open: list[str] = []
        self._dropping = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _DROPPED:
            self._dropping += 1
            return
        if self._dropping or (
            tag == "meta" and not any(k == "charset" for k, _ in attrs)
        ):
            return
        self.out.append(f"<{tag}{''.join(_attr(k, v) for k, v in attrs)}>")
        if tag not in _VOID and tag != "meta":
            self._open.append(tag)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        if tag not in _VOID and tag != "meta" and self._open[-1:] == [tag]:
            self._open.pop()
            self.out.append(f"</{tag}>")

    def handle_endtag(self, tag: str) -> None:
        if tag in _DROPPED:
            self._dropping = max(0, self._dropping - 1)
            return
        if self._dropping:
            return
        if tag in self._open:
            while self._open and self._open.pop() != tag:
                pass
        self.out.append(f"</{tag}>")

    def handle_data(self, data: str) -> None:
        if self._dropping:
            return
        innermost = next((t for t in reversed(self._open) if t not in _INLINE), None)
        keep = innermost in _HEADINGS
        self.out.append(escape(data if keep else scramble(data), quote=False))

    def handle_decl(self, decl: str) -> None:
        self.out.append(f"<!{decl}>")


def _attr(name: str, value: str | None) -> str:
    if value is None:
        return f" {name}"
    if name in _SCRAMBLED_ATTRS or name.startswith("data-"):
        value = scramble(value)
    return f' {name}="{escape(value)}"'


def reduce_page(html: str) -> str:
    reducer = _Reducer()
    reducer.feed(html)
    reducer.close()
    return "".join(reducer.out)


if __name__ == "__main__":
    page = Path(sys.argv[1]).read_bytes().decode("utf-8", "replace")
    sys.stdout.write(reduce_page(page))
