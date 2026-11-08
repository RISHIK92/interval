// ADR-0037 (AI-1, AI-3; owner, 2026-11-08): a question a model drafted says so, in the
// AiBox tag's style, wherever it is shown.
export function AiDrafted() {
  // The space keeps the accessible name "…? AI-drafted", not run together.
  return (
    <>
      {" "}
      <span className="ml-2 rounded-md bg-well px-1.5 py-0.5 align-middle text-xs font-semibold text-ink-muted">
        AI-drafted
      </span>
    </>
  );
}
