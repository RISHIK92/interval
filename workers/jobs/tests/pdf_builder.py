"""Small PDFs written by hand for the book tests (P2-W11): pages of text lines in
Helvetica at given sizes, an optional outline (bookmarks), a title in the document info,
and an /Encrypt entry for a protected one. No PDF library writes them."""

from dataclasses import dataclass, field

PAGE_HEIGHT = 792


@dataclass
class TextLine:
    text: str
    size: float = 10.0


@dataclass
class Spec:
    pages: list[list[TextLine]]
    outline: list[tuple[str, int]] = field(default_factory=list[tuple[str, int]])
    title: str | None = None
    encrypted: bool = False
    # 1-based pages given a filled box: ink without text, as a scanned page reads.
    inked: list[int] = field(default_factory=list[int])


def _escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _content(lines: list[TextLine], inked: bool) -> bytes:
    parts: list[str] = ["0 g 72 500 400 120 re f"] if inked else []
    y = PAGE_HEIGHT - 72.0
    for line in lines:
        y -= line.size * 1.4
        parts.append(
            f"BT /F1 {line.size} Tf 72 {y:.1f} Td ({_escape(line.text)}) Tj ET"
        )
    return "\n".join(parts).encode("latin-1")


def build(spec: Spec) -> bytes:
    objects: dict[int, bytes] = {}
    n_pages = len(spec.pages)
    page_ids = [4 + 2 * i for i in range(n_pages)]
    next_id = 4 + 2 * n_pages
    objects[3] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
    for i, lines in enumerate(spec.pages):
        page_id, content_id = page_ids[i], page_ids[i] + 1
        stream = _content(lines, i + 1 in spec.inked)
        objects[content_id] = (
            f"<< /Length {len(stream)} >>\nstream\n".encode() + stream + b"\nendstream"
        )
        objects[page_id] = (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 {PAGE_HEIGHT}] "
            f"/Resources << /Font << /F1 3 0 R >> >> /Contents {content_id} 0 R >>"
        ).encode()
    kids = " ".join(f"{p} 0 R" for p in page_ids)
    objects[2] = f"<< /Type /Pages /Kids [{kids}] /Count {n_pages} >>".encode()
    catalog = "<< /Type /Catalog /Pages 2 0 R"
    if spec.outline:
        outlines_id = next_id
        item_ids = [outlines_id + 1 + i for i in range(len(spec.outline))]
        next_id = item_ids[-1] + 1
        for i, (title, page_no) in enumerate(spec.outline):
            links = ""
            if i > 0:
                links += f" /Prev {item_ids[i - 1]} 0 R"
            if i + 1 < len(item_ids):
                links += f" /Next {item_ids[i + 1]} 0 R"
            objects[item_ids[i]] = (
                f"<< /Title ({_escape(title)}) /Parent {outlines_id} 0 R{links} "
                f"/Dest [{page_ids[page_no - 1]} 0 R /Fit] >>"
            ).encode()
        objects[outlines_id] = (
            f"<< /Type /Outlines /First {item_ids[0]} 0 R /Last {item_ids[-1]} 0 R "
            f"/Count {len(item_ids)} >>"
        ).encode()
        catalog += f" /Outlines {outlines_id} 0 R"
    objects[1] = (catalog + " >>").encode()
    trailer_extra = ""
    if spec.title is not None:
        info_id = next_id
        next_id += 1
        objects[info_id] = f"<< /Title ({_escape(spec.title)}) >>".encode()
        trailer_extra += f" /Info {info_id} 0 R"
    if spec.encrypted:
        encrypt_id = next_id
        next_id += 1
        # A standard security handler whose (made-up) keys match no password: what a
        # reader meets on a protected file.
        objects[encrypt_id] = (
            f"<< /Filter /Standard /V 1 /R 2 /O <{'11' * 32}> /U <{'22' * 32}> "
            "/P -44 >>"
        ).encode()
        trailer_extra += f" /Encrypt {encrypt_id} 0 R /ID [<{'ab' * 16}> <{'ab' * 16}>]"
    out = bytearray(b"%PDF-1.4\n")
    offsets: dict[int, int] = {}
    for obj_id in sorted(objects):
        offsets[obj_id] = len(out)
        out += f"{obj_id} 0 obj\n".encode() + objects[obj_id] + b"\nendobj\n"
    size = max(objects) + 1
    xref = len(out)
    out += f"xref\n0 {size}\n0000000000 65535 f \n".encode()
    for obj_id in range(1, size):
        out += f"{offsets.get(obj_id, 0):010d} 00000 n \n".encode()
    out += (
        f"trailer\n<< /Size {size} /Root 1 0 R{trailer_extra} >>\n"
        f"startxref\n{xref}\n%%EOF\n"
    ).encode()
    return bytes(out)
