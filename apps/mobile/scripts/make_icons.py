"""The app's placeholder art (P4-W22-S05; owner, 2026-11-10): the PWA's mark, a white
"I" on #1f2933 (apps/web/public/icons/icon-512.png), drawn crisply at 1024 for the
store icons and the splash. Real art later replaces these files; this script then goes.

Run from the repo root: `python3 apps/mobile/scripts/make_icons.py`. Standard library
only (PNG by zlib), so it needs no image dependency."""

import struct
import sys
import zlib
from pathlib import Path

ASSETS = Path(__file__).resolve().parents[1] / "assets"
SIZE = 1024
BACKGROUND = (0x1F, 0x29, 0x33, 0xFF)
MARK = (0xFF, 0xFF, 0xFF, 0xFF)
CLEAR = (0, 0, 0, 0)
# The PWA mark's rectangles on its 512 grid: top bar, stem, bottom bar.
BARS = [(164, 128, 348, 168), (226, 168, 286, 343), (164, 343, 348, 384)]


def _png(pixels: list[list[tuple[int, int, int, int]]], alpha: bool) -> bytes:
    height, width = len(pixels), len(pixels[0])
    channels = 4 if alpha else 3
    raw = b"".join(
        b"\x00" + b"".join(bytes(p[:channels]) for p in row) for row in pixels
    )

    def chunk(kind: bytes, data: bytes) -> bytes:
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    # 8-bit RGBA (6), or RGB (2): App Store icons may have no alpha channel at all.
    header = struct.pack(">IIBBBBB", width, height, 8, 6 if alpha else 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def draw(background: tuple[int, int, int, int], shrink: float = 1.0) -> bytes:
    """The mark on `background`, scaled about the centre by `shrink`."""
    scale = SIZE / 512 * shrink
    offset = SIZE / 2 * (1 - shrink)
    rows = [[background] * SIZE for _ in range(SIZE)]
    for x0, y0, x1, y1 in BARS:
        for y in range(round(y0 * scale + offset), round(y1 * scale + offset)):
            row = rows[y]
            for x in range(round(x0 * scale + offset), round(x1 * scale + offset)):
                row[x] = MARK
    return _png(rows, alpha=background[3] != 0xFF)


# iOS wants an opaque icon; Android's adaptive icon and the splash draw the mark over
# their own background (#1f2933 in app.json).
# Android masks the adaptive icon to its central 66dp of 108dp (a circle of radius 313
# at 1024); the mark's corners would sit at 315, so it is drawn 5% smaller there.
FILES: dict[str, tuple[tuple[int, int, int, int], float]] = {
    "icon.png": (BACKGROUND, 1.0),
    "adaptive-foreground.png": (CLEAR, 0.95),
    "splash-icon.png": (CLEAR, 1.0),
}


def main() -> None:
    ASSETS.mkdir(exist_ok=True)
    for name, (background, shrink) in FILES.items():
        (ASSETS / name).write_bytes(draw(background, shrink))
        print(f"wrote {ASSETS / name}", file=sys.stderr)


if __name__ == "__main__":
    main()
