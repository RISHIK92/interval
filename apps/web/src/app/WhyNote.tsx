import type { FeedCard } from "../server/ports";

// Why this matters (§5E, REC-5): labelled AI only once the notes model wrote it (AI-3;
// a template note is the app's own words, owner 2026-10-26).
export function WhyNote({ note }: { note: FeedCard["note"] }) {
  if (note === null) return null;
  return (
    <p>
      {`Why this matters: ${note.text}`}
      {note.ai ? (
        <>
          {" "}
          <small>AI</small>
        </>
      ) : null}
    </p>
  );
}
