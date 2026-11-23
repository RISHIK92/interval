// A book becoming sessions: one block, then its short pieces, the last still to come
// (decorative). The first visit's hero and a book's next-up card.
export function BookArt({ className }: { className: string }) {
  const c = (role: string) => `var(--distributed-systems-${role})`;
  const cube = (x: number) => (
    <g key={x}>
      <path d={`M${String(x)} 56 l14 -7 l14 7 l-14 7z`} fill={c("top")} />
      <path d={`M${String(x)} 56 l14 7 v16 l-14 -7z`} fill={c("left")} />
      <path d={`M${String(x + 14)} 63 l14 -7 v16 l-14 7z`} fill={c("right")} />
    </g>
  );
  return (
    <div
      aria-hidden="true"
      className={`flex items-center justify-center p-4 ${className}`}
      style={{ background: c("tint") }}
    >
      <svg viewBox="0 0 300 120" className="h-[7.5rem] w-full max-w-[18.75rem]">
        <path d="M14 52 64 30 112 52 62 74z" fill={c("top")} />
        <path d="M14 52 62 74v22L14 74z" fill={c("left")} />
        <path d="M62 74 112 52v22L62 96z" fill={c("right")} />
        <path
          d="M70 80 104 65M70 87 104 72"
          fill="none"
          stroke={c("top")}
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M120 64H150"
          fill="none"
          stroke={c("line")}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="2 8"
        />
        {[158, 194, 230].map(cube)}
        <path
          d="M266 56 280 49 294 56 280 63zM266 56v16l14 7 14-7V56M280 63v16"
          fill="none"
          stroke={c("line")}
          strokeWidth="2"
          strokeDasharray="3 4"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
