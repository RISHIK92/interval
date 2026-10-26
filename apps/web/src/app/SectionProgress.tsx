// The design's segmented bar: one segment per section of the article. Finished ones are
// green, this one light green with a slow pulse (owner, 2026-10-26). The words carry the meaning, so the bar is hidden from screen readers. A
// one-section article gets no bar: a single full segment says nothing (owner,
// 2026-10-26).
export function SectionProgress({
  number,
  count,
}: {
  number: number;
  count: number;
}) {
  return (
    <div className="mt-3">
      {count > 1 ? (
        <div aria-hidden="true" className="flex gap-1">
          {Array.from({ length: count }, (_, i) => (
            <span
              key={i}
              className={`h-1.5 min-w-0 flex-1 rounded-full ${
                i < number - 1
                  ? "bg-go"
                  : i === number - 1
                    ? "bg-go-soft motion-safe:animate-glow"
                    : "bg-track"
              }`}
            />
          ))}
        </div>
      ) : null}
      <p className="mt-1.5 text-sm text-ink-muted">
        {`Section ${String(number)} of ${String(count)}`}
      </p>
    </div>
  );
}
