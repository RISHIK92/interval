"use client";

import { useEffect, useRef, useState } from "react";
import { fractionOf, placeKeeper, scrollFor } from "./place";

const SETTLE_MS = 1000;
// Pages drawn this far around the window; further away their bitmaps are dropped, so a
// long section doesn't hold every page in memory (phones blank canvases past a limit).
const MARGIN = "150% 0px";

// §5F, Q-P2-31 updated (owner, 2026-10-28; P2-W11-S04): a section's own pages from the
// user's PDF, drawn by PDF.js, so diagrams, tables and code look as printed. Pages get
// their size at once (so the saved place can be restored) and are drawn as they come
// near the window. Only the reader's own scrolling moves the saved place: not opening a
// section, the jump to the top that comes with it, or the restore. The page keys this
// component by section, so each section is a fresh mount.
export function BookPages(props: {
  bookId: string;
  sessionId: string;
  firstPage: number;
  lastPage: number;
  fraction: number | null;
}) {
  const { bookId, sessionId, firstPage, lastPage, fraction } = props;
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "shown" | "failed">("loading");

  useEffect(() => {
    const holder = box.current;
    if (holder === null) return;
    // Set by the cleanup while the async load is under way (read through a function:
    // a plain variable would be narrowed to its first value across the awaits).
    const life = { stopped: false, touched: false };
    const stopped = () => life.stopped;
    let observer: IntersectionObserver | undefined;
    let close: (() => void) | undefined;

    const save = (at: number) => {
      void fetch(`/api/books/${bookId}/position`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, fraction: at }),
        keepalive: true, // still sent as the page goes away
      })
        .then((response) => {
          if (!response.ok)
            console.warn("books: place not saved", response.status);
        })
        .catch((error: unknown) => {
          console.warn("books: place not saved", error);
        });
    };
    const keeper = placeKeeper({
      save,
      settleMs: SETTLE_MS,
      schedule: (run, ms) => window.setTimeout(run, ms),
      cancel: (timer) => {
        window.clearTimeout(timer);
      },
    });
    // Scrolls before the reader's first touch, wheel or key are the app's own.
    const onInput = () => {
      life.touched = true;
    };
    const onScroll = () => {
      if (!life.touched) return;
      const doc = document.documentElement;
      keeper.scrolled(
        fractionOf(window.scrollY, doc.scrollHeight, window.innerHeight),
      );
    };
    const onLeave = () => {
      keeper.leaving();
    };

    void (async () => {
      const pdfjs = await import("pdfjs-dist");
      if (stopped()) return;
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      const task = pdfjs.getDocument({ url: `/api/books/${bookId}/file` });
      close = () => void task.destroy();
      const pdf = await task.promise;
      if (stopped()) return;
      const last = Math.min(lastPage, pdf.numPages);
      if (firstPage > last)
        throw new Error("the section's pages aren't in the PDF");
      const width = holder.clientWidth;
      const ratio = window.devicePixelRatio || 1;
      const pages = new Map<
        Element,
        { draw: () => Promise<void>; drop: () => void }
      >();
      const drawn = new Set<Element>();
      for (let n = firstPage; n <= last; n++) {
        const page = await pdf.getPage(n);
        if (stopped()) return;
        const base = page.getViewport({ scale: 1 });
        const canvas = document.createElement("canvas");
        canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", `Page ${String(n)}`);
        canvas.className = "w-full rounded-lg bg-white shadow-card";
        canvas.style.aspectRatio = `${String(base.width)} / ${String(base.height)}`;
        holder.append(canvas);
        pages.set(canvas, {
          draw: async () => {
            const viewport = page.getViewport({
              scale: (width / base.width) * ratio,
            });
            canvas.width = Math.floor(viewport.width);
            canvas.height = Math.floor(viewport.height);
            await page.render({ canvas, viewport }).promise;
          },
          drop: () => {
            canvas.width = 0;
            canvas.height = 0;
            page.cleanup();
          },
        });
      }
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const one = pages.get(entry.target);
            if (one === undefined) continue;
            if (entry.isIntersecting && !drawn.has(entry.target)) {
              drawn.add(entry.target);
              one.draw().catch((error: unknown) => {
                if (!stopped()) console.warn("books: page not drawn", error);
              });
            } else if (!entry.isIntersecting && drawn.has(entry.target)) {
              drawn.delete(entry.target);
              one.drop();
            }
          }
        },
        { rootMargin: MARGIN },
      );
      for (const canvas of pages.keys()) observer.observe(canvas);
      setState("shown");
      // Every page has its height now: back to where the reader left off.
      if (fraction !== null) {
        const doc = document.documentElement;
        window.scrollTo(
          0,
          scrollFor(fraction, doc.scrollHeight, window.innerHeight),
        );
      }
    })().catch((error: unknown) => {
      // A load cut short by leaving the section is not a failure.
      if (stopped()) return;
      console.warn("books: pdf not opened", error);
      setState("failed");
    });

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", onLeave);
    for (const name of ["wheel", "touchstart", "keydown", "pointerdown"])
      window.addEventListener(name, onInput, { passive: true });
    return () => {
      life.stopped = true;
      keeper.leaving();
      observer?.disconnect();
      close?.();
      holder.replaceChildren();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", onLeave);
      for (const name of ["wheel", "touchstart", "keydown", "pointerdown"])
        window.removeEventListener(name, onInput);
    };
  }, [bookId, sessionId, firstPage, lastPage, fraction]);

  return (
    <>
      {state === "loading" ? (
        <p role="status" className="text-ink-muted">
          Loading pages…
        </p>
      ) : null}
      {state === "failed" ? (
        <p role="alert" className="text-wrong">
          This book&apos;s pages couldn&apos;t be shown. The text is below.
        </p>
      ) : null}
      <div
        ref={box}
        aria-busy={state === "loading"}
        className="flex flex-col gap-4"
      />
    </>
  );
}
