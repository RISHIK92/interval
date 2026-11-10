"""The app's placeholder art (P4-W22-S05): the committed PNGs are what the script draws,
1024 square; the iOS icon has no alpha channel (the App Store refuses one)."""

import importlib.util
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "apps" / "mobile" / "scripts" / "make_icons.py"


def _module():  # noqa: ANN202 (a module loaded by path)
    spec = importlib.util.spec_from_file_location("make_icons", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _header(png: bytes) -> tuple[int, int, int]:
    width, height, _, colour = struct.unpack(">IIBB", png[16:26])
    return width, height, colour


def test_the_committed_art_is_what_the_script_draws() -> None:
    icons = _module()
    for name, (background, shrink) in icons.FILES.items():
        drawn = icons.draw(background, shrink)
        assert (ROOT / "apps" / "mobile" / "assets" / name).read_bytes() == drawn, name
        width, height, colour = _header(drawn)
        assert (width, height) == (1024, 1024)
        # RGB for the store icon (no alpha at all); RGBA where the mark sits on a
        # background the platform draws.
        assert colour == (2 if name == "icon.png" else 6), name
        # Decoded, not only compared with itself: rows of a filter byte and pixels, the
        # middle of the stem white, a corner the background.
        channels = 3 if colour == 2 else 4
        idat = drawn[drawn.index(b"IDAT") + 4 : drawn.index(b"IEND") - 8]
        raw = zlib.decompress(idat)
        stride = 1 + channels * 1024
        assert len(raw) == 1024 * stride
        assert all(raw[row * stride] == 0 for row in range(1024))

        middle = 512 * stride + 1 + 512 * channels
        corner = 5 * stride + 1 + 5 * channels
        assert raw[middle : middle + 3] == b"\xff\xff\xff"
        assert raw[corner : corner + 3] == bytes(background[:3])


def test_the_adaptive_mark_sits_inside_androids_safe_circle() -> None:
    # 66dp of 108dp at 1024: radius 312.9 from the centre.
    icons = _module()
    _, shrink = icons.FILES["adaptive-foreground.png"]
    scale = 1024 / 512 * shrink
    offset = 512 * (1 - shrink)
    for x0, y0, x1, y1 in icons.BARS:
        for x, y in ((x0, y0), (x1, y0), (x0, y1), (x1, y1)):
            dx, dy = x * scale + offset - 512, y * scale + offset - 512
            assert (dx * dx + dy * dy) ** 0.5 < 1024 * 33 / 108
