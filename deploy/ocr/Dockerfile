# OCR for scanned book pages (ADR-0022, P2-W11-S03): Tesseract with English, behind a
# tiny standard-library HTTP server. One page at a time; memory capped by compose (512m).
FROM debian:trixie-slim@sha256:89c1ea91e897f0fe0a3731595330bc45b8bdef4047464a07116f891a94054b31
RUN apt-get update \
  && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng python3 \
  && rm -rf /var/lib/apt/lists/*
RUN useradd --system --no-create-home ocr
COPY server.py /srv/server.py
USER ocr
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=6 \
  CMD python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=2)"
CMD ["python3", "/srv/server.py"]
