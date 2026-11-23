// The web design's battle frame ("HLD battle, web" and "LLD battle, web"): on a
// desktop, a bordered frame with a header row and three columns (the brief, the canvas
// or the code, the selection or the tests). The pages place their parts into it; on a
// phone it's the single column it was.

export const FRAME =
  "mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 pt-6 pb-12 lg:my-10 lg:grid lg:min-h-[700px] lg:w-[calc(100%-80px)] lg:max-w-[1200px] lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_minmax(0,17.5rem)] lg:grid-rows-[auto_auto_1fr] lg:gap-0 lg:overflow-hidden lg:rounded-3xl lg:border lg:border-hairline lg:p-0";

export const HEADER =
  "lg:col-span-3 lg:flex lg:flex-wrap lg:items-center lg:gap-3.5 lg:border-b lg:border-hairline lg:px-5 lg:py-3.5";

export const HEADER_TILE =
  "hidden size-11 shrink-0 items-center justify-center rounded-xl bg-(--system-design-tint) lg:flex";

export const TITLE =
  "text-display lg:text-[18px] lg:leading-snug lg:tracking-[-0.01em]";

export function Requirements({ requirements }: { requirements: string[] }) {
  return (
    <section
      aria-label="Requirements"
      className="-mt-3 lg:col-start-1 lg:row-start-2 lg:mt-0 lg:flex lg:flex-col lg:gap-1.5 lg:border-r lg:border-hairline lg:p-5 lg:pb-0"
    >
      <h2 className="mb-1 hidden text-[15px] font-semibold lg:block">
        Requirements
      </h2>
      <ul className="list-disc pl-5 text-ink-muted lg:flex lg:list-none lg:flex-col lg:gap-1.5 lg:pl-0">
        {requirements.map((r) => (
          <li
            key={r}
            className="lg:rounded-xl lg:bg-well lg:px-[11px] lg:py-[9px] lg:text-sm lg:font-semibold lg:text-ink"
          >
            {r}
          </li>
        ))}
      </ul>
    </section>
  );
}
