// The admin pages are a dense desktop layout (design system: 12px corners, hairline
// rows). Cells are styled from the table so rows and cells stay plain markup.
export const ADMIN_MAIN = "mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8";

export const TABLE =
  "w-full text-sm tabular-nums [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_th]:sticky [&_th]:top-0 [&_th]:bg-well [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_tbody_tr]:border-t [&_tbody_tr]:border-hairline";

export const ACT =
  "rounded-xl bg-ink px-3 py-1.5 text-sm font-semibold text-page disabled:opacity-50";

export const SECONDARY =
  "rounded-xl border border-hairline bg-page px-3 py-1.5 text-sm font-semibold text-ink";
