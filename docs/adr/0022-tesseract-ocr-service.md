# 0022. OCR for scanned book pages: a Tesseract container, not Textract

- Status: ACCEPTED (owner, 2026-10-28)
- Date: 2026-10-28
- Supersedes: none (amends ING-5's OCR engine)
- Superseded by: none

## Context

ING-5: "User PDFs use a private pipeline: text extraction, Textract OCR for scanned pages, bookmarks, then heading detection." The AWS mapping in docs/decisions.md lists "OCR | Textract". Phase 2 Week 11 builds PDF books (§5F: "Scanned pages go through OCR").

Two other decisions bear on it:
- ADR-0011: the app must run in two modes, full AWS and a single VM, "from the same code", with "every backing service from env".
- ADR-0013: "build and verify everything locally; no deployment until all phases are built".

Textract has no local or VM equivalent. It could only be verified by calling AWS from a developer machine, and the VM mode would always depend on an AWS API.

The owner's choice (2026-10-28, Q-P2-32), after weighing digital text extraction against OCR ("whole book in seconds" against "roughly 1–3 seconds per page"):
- digital pages keep their text, extracted from the PDF;
- only scanned pages go to Tesseract;
- Tesseract runs in its own Docker container with a 512 MB memory cap;
- OCR jobs queue on the existing Valkey (BullMQ, ADR-0014), so many uploads simply wait their turn.

## Options

### A. A Tesseract OCR service container (owner's choice)

**What it is:**
- A small `ocr` image: Debian, `tesseract-ocr` with English data, and a stdlib Python HTTP server taking one page image and returning its text.
- It runs as one more service in docker-compose and in the VM stack, with `mem_limit: 512m`.
- In AWS mode it runs as a small Fargate service.
- The worker renders each scanned page to an image (pdfplumber / pypdfium2) and calls the service through `OCR_URL` from env.
- An `ocr_page` BullMQ stage takes one page at a time, with retries.

- **Pros:**
  - The same engine in local, VM and AWS modes (ADR-0011).
  - It can be verified locally (ADR-0013).
  - No per-page cost: Textract is about $1.50 per 1,000 pages.
  - Book text never leaves our own infrastructure, which suits "private pipeline" (ING-5).
  - A memory cap and a queue keep one large book from starving the worker.
- **Cons:**
  - Tesseract is less accurate than Textract on poor scans, tables and handwriting.
  - About 1–3 seconds per page on CPU, so a 300-page scanned book takes 5–15 minutes.
  - One more container to build, run and patch.
- **Cost to reverse:** low. OCR sits behind a port (ADR-0012), so swapping in Textract changes only the adapter and the env.

### B. Textract, as ING-5 says

- **Pros:**
  - Better accuracy on hard scans.
  - Nothing to run ourselves in AWS.
- **Cons:**
  - No local or VM equivalent, so it breaks ADR-0011's "same code, every backing service from env" for the VM mode.
  - It can't be verified locally without AWS calls (ADR-0013).
  - It costs money per page.
  - Book text leaves for an AWS API.
- **Cost to reverse:** low, for the same port reason.

### C. Tesseract inside the worker image

- **Pros:**
  - No extra container.
- **Cons:**
  - The 512 MB cap is hard to enforce per process.
  - The worker image grows.
  - An OCR spike shares memory with ingestion.
- **Cost to reverse:** low.

## Recommendation (not a decision)

Option A, as the owner chose. It is the only option that keeps ADR-0011's single code path and ADR-0013's local verification while still OCRing scanned pages, and the OCR port keeps Textract one adapter away if accuracy disappoints.

## Consequences

- **If accepted:** ING-5's engine is Tesseract. The AWS mapping's "OCR | Textract" row is read as "OCR | Tesseract service (Fargate)" until docs/decisions.md is revised by the owner.
- **New:**
  - `deploy/ocr/` (Dockerfile and server);
  - an `ocr` service in `docker-compose.yml` and `deploy/compose.prod.yml` (`mem_limit: 512m`);
  - an `OCR_URL` env var;
  - an `Ocr` port with a Tesseract HTTP adapter and an in-memory fake;
  - an `ocr_page` BullMQ stage;
  - a Fargate service in the AWS stack (synth only, never deployed).
- **Unblocks:** P2-W11-S03 (scanned pages).

## Open questions

- Languages: English only to start? Each extra traineddata adds about 10–20 MB.
