import { books, files, sessionReader } from "../../../../../server/container";
import { BIGINT_ID } from "../../../../../server/ports";

export const dynamic = "force-dynamic";

// §5F, DB-6 (P2-W11-S04): the user's own PDF, for the reader's PDF.js. The book's
// owner only, and ready books only; anyone else finds nothing here.
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const actor = await sessionReader().current(request.headers);
  if (actor === null) return new Response(null, { status: 401 });
  const { id } = await context.params;
  if (!BIGINT_ID.test(id)) return new Response(null, { status: 404 });
  const key = await books().fileKey(actor.userId, id);
  // The browser keeps its copy but asks each time (no-cache), so a deleted book or a
  // signed-out session is never served from the cache; an unchanged file costs a 304.
  const stored =
    key === null
      ? null
      : await files().get(
          key,
          request.headers.get("if-none-match") ?? undefined,
        );
  if (stored === null) return new Response(null, { status: 404 });
  const cache = { "Cache-Control": "private, no-cache" };
  if (stored === "unchanged")
    return new Response(null, { status: 304, headers: cache });
  return new Response(stored.body, {
    headers: {
      ...cache,
      "Content-Type": "application/pdf",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      ...(stored.etag === null ? {} : { ETag: stored.etag }),
      ...(stored.size === null
        ? {}
        : { "Content-Length": String(stored.size) }),
    },
  });
}
