// The design's segmented bar: one segment per section of the article, filled up to this
// one. The words carry the meaning, so the bar is hidden from screen readers.
export function SectionProgress({
  number,
  count,
}: {
  number: number;
  count: number;
}) {
  return (
    <div className="mt-3">
      <div aria-hidden="true" className="flex gap-1">
        {Array.from({ length: count }, (_, i) => (
          <span
            key={i}
            className={`h-1.5 min-w-0 flex-1 rounded-full ${i < number ? "bg-go" : "bg-track"}`}
          />
        ))}
      </div>
      <p className="mt-1.5 text-sm text-ink-muted">
        {`Section ${String(number)} of ${String(count)}`}
      </p>
    </div>
  );
}
