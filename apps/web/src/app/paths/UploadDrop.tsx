"use client";

import { useRef, useState } from "react";

// The first visit's upload (wireframe "Paths, first visit"): drop a PDF on the area or
// choose one, and it goes to the existing book upload (§5F, P2-W11-S01) at once. The
// form works without script too: the file input and the submit button stay usable.
export function UploadDrop({ maxMb }: { maxMb: number | null }) {
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  // One upload at a time: a second drop while the first is sending would add a copy.
  const [sending, setSending] = useState(false);
  const send = () => {
    if (sending) return;
    setSending(true);
    form.current?.requestSubmit();
  };
  return (
    <form
      ref={form}
      action="/api/books"
      method="post"
      encType="multipart/form-data"
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        const files = event.dataTransfer.files;
        // One PDF: the input takes a single file.
        if (sending || input.current === null || files.length !== 1) return;
        input.current.files = files;
        send();
      }}
      className="flex flex-col gap-4 rounded-2xl border border-dashed border-hairline bg-well p-5 sm:flex-row sm:items-center"
    >
      <span
        aria-hidden="true"
        className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-page"
      >
        <svg
          viewBox="0 0 24 24"
          className="size-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
        </svg>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold" aria-live="polite">
          {sending ? "Uploading…" : "Drop a PDF here"}
        </span>
        <span className="block text-sm text-ink-muted">
          A PDF you&apos;re allowed to use
          {maxMb === null ? "" : `, up to ${String(maxMb)} MB`}; protected (DRM)
          PDFs can&apos;t be read. It stays private to you. Checkpoints send a
          chapter&apos;s text to our AI providers to write questions.
        </span>
      </span>
      <label className="cursor-pointer self-start rounded-full bg-ink px-5 py-2.5 font-semibold text-page has-focus-visible:ring-2 has-focus-visible:ring-select sm:self-auto">
        Choose a file
        <input
          ref={input}
          type="file"
          name="file"
          accept="application/pdf,.pdf"
          required
          className="sr-only"
          onChange={send}
        />
      </label>
      <noscript>
        <button
          type="submit"
          className="rounded-full border border-hairline px-5 py-2.5 font-semibold"
        >
          Add this book
        </button>
      </noscript>
    </form>
  );
}
