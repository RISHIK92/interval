"""A book's chapters and sessions from its lines (§5F, ING-4, ING-5, P2-W11-S02)."""

from interval_jobs.books.structure import Bookmark, Line, Page, structure

BODY = 10.0


VOCAB = "leader follower quorum replica write read log commit term vote".split()
_counter = [0]


def words(n: int, word: str = "word") -> str:
    """n words starting with `word`, then varied as real text is: lines that repeat
    on many pages are dropped as running headers."""
    out = [word]
    for _ in range(n - 1):
        _counter[0] += 1
        i = _counter[0]
        out.append(VOCAB[i % 10] + VOCAB[(i // 10) % 10] + VOCAB[(i // 100) % 10])
    return " ".join(out)


def para(n_words: int, top: float, word: str = "word") -> list[Line]:
    """n words from `top` down, in paragraphs of 120 words (12 to a line), with a
    blank line between paragraphs, as a book's text runs."""
    lines: list[Line] = []
    left = n_words
    while left > 0:
        in_para = min(120, left)
        left -= in_para
        while in_para > 0:
            k = min(12, in_para)
            lines.append(Line(words(k, word), BODY, top))
            top += BODY * 1.2
            in_para -= k
        top += BODY * 2.4  # the gap that ends a paragraph
    return lines


def page(no: int, *blocks: list[Line]) -> Page:
    return Page(no, [line for block in blocks for line in block])


def heading(text: str, top: float, size: float) -> list[Line]:
    return [Line(text, size, top)]


def test_headings_by_size_make_chapters_and_sessions() -> None:
    pages = [
        page(
            1,
            heading("Replication", 50, 24),
            heading("Leaders", 100, 16),
            para(600, 130),
        ),
        page(2, heading("Followers", 50, 16), para(700, 80)),
        page(3, heading("Partitioning", 50, 24), para(500, 100)),
    ]
    chapters = structure(pages, [], "Book")
    assert [c.title for c in chapters] == ["Replication", "Partitioning"]
    first = chapters[0]
    assert [s.title for s in first.sessions] == ["Leaders", "Followers"]
    assert [s.first_page for s in first.sessions] == [1, 2]
    # About 600 words at 230 a minute, heading included.
    assert first.sessions[0].minutes == 3
    assert first.sessions[0].text.startswith("Leaders\n\nword ")
    assert chapters[1].sessions[0].title == "Partitioning"


def test_bookmarks_win_over_headings_and_front_matter_opens_the_first() -> None:
    pages = [
        page(1, para(100, 50, "preface")),
        page(2, heading("Big heading", 50, 24), para(600, 80)),
        page(3, para(600, 50)),
    ]
    chapters = structure(pages, [Bookmark("One", 2), Bookmark("Two", 3)], "Book")
    assert [c.title for c in chapters] == ["One", "Two"]
    assert "preface" in chapters[0].sessions[0].text


def test_without_bookmarks_or_headings_the_book_is_one_chapter_cut_at_paragraphs() -> (
    None
):
    pages = [page(n, para(800, 50)) for n in range(1, 5)]
    chapters = structure(pages, [], "My notes")
    assert [c.title for c in chapters] == ["My notes"]
    sessions = chapters[0].sessions
    # 3,200 words: about 5-minute pieces, none past 8.
    assert len(sessions) >= 3
    assert all(2 <= s.minutes <= 8 for s in sessions)
    assert sessions[1].title == "My notes, part 2"
    assert sum(len(s.text.split()) for s in sessions) == 3200


def test_running_headers_and_page_numbers_are_dropped() -> None:
    pages = [
        page(
            n,
            [Line("DESIGNING DATA SYSTEMS", 8, 10)],
            para(300, 50),
            [Line(str(n), 8, 780)],
        )
        for n in range(1, 7)
    ]
    text = " ".join(s.text for c in structure(pages, [], "B") for s in c.sessions)
    assert "DESIGNING" not in text
    assert not any(t.isdigit() for t in text.split())


def test_a_long_section_without_subheadings_is_cut_and_a_short_one_merged() -> None:
    pages = [
        page(1, heading("Chapter", 40, 24), heading("Long", 80, 16), para(3000, 110)),
        page(
            2,
            heading("Tiny", 40, 16),
            para(50, 70),
            heading("Next", 200, 16),
            para(500, 230),
        ),
        page(3, heading("Epilogue", 40, 24), para(300, 70)),
    ]
    sessions = structure(pages, [], "B")[0].sessions
    titles = [s.title for s in sessions]
    assert titles[0] == "Long, part 1"
    assert all(s.minutes <= 8 for s in sessions)
    # "Tiny" (about 50 words) shares a session with a neighbour: none is under 2.
    assert all(s.minutes >= 2 for s in sessions)
    assert any("Tiny" in s.text and "Next" in s.text for s in sessions)


def test_a_hyphenated_line_break_is_joined() -> None:
    pages = [page(1, [Line("a consis-", BODY, 50), Line("tent read", BODY, 62)])]
    assert structure(pages, [], "B")[0].sessions[0].text == "a consistent read"


def test_no_text_no_chapters() -> None:
    assert structure([Page(1, []), Page(2, [])], [], "B") == []


def test_a_line_repeated_in_the_body_is_kept() -> None:
    # A code listing's closing brace on every page is text, not a running header.
    pages = [
        page(n, para(120, 50), [Line("}", BODY, 400)], para(120, 420))
        for n in range(1, 7)
    ]
    text = " ".join(s.text for c in structure(pages, [], "B") for s in c.sessions)
    assert text.count("}") == 6


def test_a_book_without_paragraph_space_is_still_cut_into_sessions() -> None:
    # Paragraphs marked by indent, not space: forty pages read as one paragraph.
    pages = [
        Page(n, [Line(words(12), BODY, 50 + i * BODY * 1.2) for i in range(45)])
        for n in range(1, 41)
    ]
    # About 21,600 words: some 19 sessions near 5 minutes each.
    sessions = structure(pages, [], "Notes")[0].sessions
    assert len(sessions) >= 15
    assert all(s.minutes <= 8 for s in sessions)


def test_a_title_page_in_the_largest_font_is_not_a_chapter_level() -> None:
    pages = [
        page(1, heading("The Big Book", 60, 28)),
        *(
            page(n + 1, heading(f"Chapter {name}", 40, 18), para(500, 80))
            for n, name in enumerate(["One", "Two", "Three", "Four"], start=1)
        ),
    ]
    assert [c.title for c in structure(pages, [], "Big")] == [
        "Chapter One",
        "Chapter Two",
        "Chapter Three",
        "Chapter Four",
    ]


def test_a_heading_wrapped_onto_two_lines_is_one_heading() -> None:
    pages = [
        page(
            1,
            heading("Chapter 1", 40, 24),
            heading("On Systems", 40 + 24 * 1.2, 24),
            para(500, 120),
        ),
        page(2, heading("Chapter 2", 40, 24), para(500, 80)),
    ]
    assert [c.title for c in structure(pages, [], "B")] == [
        "Chapter 1 On Systems",
        "Chapter 2",
    ]


def test_a_session_knows_its_pages_and_neighbours_can_share_one() -> None:
    # The reader shows a session's own PDF pages (owner, Q-P2-31 updated).
    pages = [
        page(1, heading("Leaders", 40, 16), para(300, 70)),
        page(2, para(300, 50)),
        page(3, para(200, 50), heading("Followers", 400, 16), para(300, 430)),
        page(4, para(300, 50)),
    ]
    sessions = [s for c in structure(pages, [], "B") for s in c.sessions]
    assert [(s.title, s.first_page, s.last_page) for s in sessions] == [
        ("Leaders", 1, 3),
        ("Followers", 3, 4),
    ]


def test_a_paragraph_running_over_a_page_break_ends_on_the_later_page() -> None:
    pages = [
        page(1, [Line(words(12), BODY, 700 + i * 12) for i in range(3)]),
        page(2, [Line(words(12), BODY, 40 + i * 12) for i in range(3)]),
    ]
    (session,) = structure(pages, [], "B")[0].sessions
    assert (session.first_page, session.last_page) == (1, 2)


def test_pages_without_text_belong_to_the_session_before_them() -> None:
    # A full-page figure (page 2) and a blank last page (5) still reach the reader.
    pages = [
        page(1, heading("Leaders", 40, 16), para(300, 70)),
        page(2),
        page(3, heading("Followers", 40, 16), para(300, 70)),
        page(4, para(300, 50)),
        page(5),
    ]
    sessions = [s for c in structure(pages, [], "B") for s in c.sessions]
    assert [(s.title, s.first_page, s.last_page) for s in sessions] == [
        ("Leaders", 1, 2),
        ("Followers", 3, 5),
    ]
