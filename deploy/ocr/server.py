"""OCR for scanned book pages (ADR-0022, P2-W11-S03).

POST /ocr with a PNG body answers the page's text (text/plain, UTF-8); GET /health
answers 200. Tesseract reads one page at a time (a lock), so the 512 MB cap holds for
one page and the worker's queue holds the rest; health checks are answered meanwhile.
Standard library only.
"""

import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAX_BYTES = 40 * 1024 * 1024  # a 200 dpi page is a few MB; anything larger is refused
TIMEOUT_SECONDS = 60
ONE_AT_A_TIME = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    # A client that stalls mid-request is dropped rather than held open.
    timeout = 30

    def do_GET(self) -> None:
        if self.path != "/health":
            self.send_error(404)
            return
        self._send(200, b"ok")

    def do_POST(self) -> None:
        if self.path != "/ocr":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length") or 0)
        if not 0 < length <= MAX_BYTES:
            self.send_error(413 if length else 411)
            return
        image = self.rfile.read(length)
        try:
            with ONE_AT_A_TIME:
                result = subprocess.run(
                    ["tesseract", "stdin", "stdout", "-l", "eng"],
                    input=image,
                    capture_output=True,
                    timeout=TIMEOUT_SECONDS,
                    check=True,
                )
        except subprocess.TimeoutExpired:
            self.send_error(504)
            return
        except subprocess.CalledProcessError:
            # Not an image Tesseract can read. Its message stays out of the response.
            self.send_error(422)
            return
        self._send(200, result.stdout)

    def _send(self, status: int, body: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        # No request lines: they say nothing the worker doesn't log.
        del format, args


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
