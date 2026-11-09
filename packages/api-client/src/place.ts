// P2-W11-S04: where a reader is in a session, as a fraction of how far it can scroll
// (0 at the top, 1 at the end), and back. A page shorter than the window is at 0.
export function fractionOf(
  scrollY: number,
  scrollHeight: number,
  viewport: number,
): number {
  const room = scrollHeight - viewport;
  if (room <= 0) return 0;
  return Math.min(1, Math.max(0, scrollY / room));
}

export function scrollFor(
  fraction: number,
  scrollHeight: number,
  viewport: number,
): number {
  return Math.max(0, Math.round(fraction * (scrollHeight - viewport)));
}

// When to save the place (owner, 2026-10-28: only the reader's own scrolling moves it,
// not opening a section): a second after scrolling stops, and on leaving if it moved.
export function placeKeeper(opts: {
  save: (fraction: number) => void;
  settleMs: number;
  schedule: (run: () => void, ms: number) => number;
  cancel: (timer: number) => void;
}) {
  let timer: number | undefined;
  let moved: number | null = null;
  return {
    scrolled(fraction: number) {
      moved = fraction;
      if (timer !== undefined) opts.cancel(timer);
      timer = opts.schedule(() => {
        timer = undefined;
        if (moved !== null) opts.save(moved);
      }, opts.settleMs);
    },
    leaving() {
      if (timer !== undefined) opts.cancel(timer);
      timer = undefined;
      if (moved !== null) opts.save(moved);
    },
  };
}
