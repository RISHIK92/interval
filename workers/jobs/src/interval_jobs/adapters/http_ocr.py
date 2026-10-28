"""ADR-0022: the Tesseract OCR service over HTTP (deploy/ocr/server.py)."""

import httpx

# A dense page takes Tesseract a few seconds; the service gives up at 60.
TIMEOUT_SECONDS = 90.0


class HttpOcr:
    def __init__(self, base_url: str, client: httpx.Client | None = None) -> None:
        self._url = base_url.rstrip("/") + "/ocr"
        self._client = client or httpx.Client(timeout=TIMEOUT_SECONDS)

    def read(self, png: bytes) -> str:
        response = self._client.post(
            self._url, content=png, headers={"Content-Type": "image/png"}
        )
        response.raise_for_status()  # the queue retries (ADR-0014)
        return response.text
