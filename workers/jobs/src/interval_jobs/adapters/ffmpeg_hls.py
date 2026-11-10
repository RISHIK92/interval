"""HLS by ffmpeg (Q-P4-09, P4-W22-S04): a system binary in the worker image, not a
Python dependency. AAC at 64 kb/s in 6-second MPEG-TS segments, under a VOD playlist."""

import subprocess
import tempfile
from pathlib import Path

PLAYLIST = "index.m3u8"
SEGMENT_SECONDS = 6


class HlsError(RuntimeError):
    """ffmpeg failed; nothing is stored."""


class FfmpegHls:
    def __init__(self, binary: str = "ffmpeg") -> None:
        self._binary = binary

    def package(self, mp3: bytes) -> dict[str, bytes]:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            source = out / "in.mp3"
            source.write_bytes(mp3)
            done = subprocess.run(
                [
                    self._binary,
                    "-nostdin",
                    "-loglevel",
                    "error",
                    "-i",
                    str(source),
                    "-vn",
                    "-c:a",
                    "aac",
                    "-b:a",
                    "64k",
                    "-f",
                    "hls",
                    "-hls_time",
                    str(SEGMENT_SECONDS),
                    "-hls_playlist_type",
                    "vod",
                    "-hls_segment_filename",
                    str(out / "seg_%03d.ts"),
                    str(out / PLAYLIST),
                ],
                capture_output=True,
                check=False,
                timeout=300,
            )
            if done.returncode != 0:
                raise HlsError(f"ffmpeg: {done.stderr.decode(errors='replace')[:500]}")
            return {
                p.name: p.read_bytes()
                for p in sorted(out.iterdir())
                if p.name == PLAYLIST or p.suffix == ".ts"
            }
