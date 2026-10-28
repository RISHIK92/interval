import { cookies } from "next/headers";
import {
  books,
  entitlements,
  events,
  files,
  jobQueue,
  sessionReader,
} from "../../../server/container";
import { addBook } from "../../../server/books";
import { visitId } from "../../../server/visits";
import { sameOrigin } from "../../../server/same-origin";

export const dynamic = "force-dynamic";

const MB = 1024 * 1024;
// The multipart form's own fields and boundaries around the file.
const FORM_OVERHEAD = MB;

// PDF books (§5F, Q-P2-34, Q-P2-37, P2-W11-S01): the upload goes through the web server.
// A route, not a server action, so the session and the declared size are checked before
// the body is read: a server action's body limit applies to every action, anyone's.
export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const actor = await sessionReader().current(request.headers);
  if (actor === null) return see("/join");
  // Owner, 2026-10-28: books are for accounts, not guests.
  if (actor.isGuest) return see("/books/new?error=guest");
  const maxMb = await entitlements().limit(actor.userId, "books.max_mb");
  const length = Number(request.headers.get("content-length"));
  if (!Number.isFinite(length) || length <= 0)
    return see("/books/new?error=not_pdf");
  if (maxMb !== null && length > maxMb * MB + FORM_OVERHEAD)
    return see("/books/new?error=too_large");
  const file = (await request.formData()).get("file");
  if (!(file instanceof File) || file.size === 0)
    return see("/books/new?error=not_pdf");
  const added = await addBook(
    {
      books: books(),
      files: files(),
      queue: jobQueue(),
      entitlements: entitlements(),
    },
    actor.userId,
    { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) },
  );
  if (!added.ok) return see(`/books/new?error=${added.reason}`);
  events().emit(
    "book_uploaded",
    { book_id: added.bookId, size_bytes: file.size },
    { ...actor, sessionId: visitId(await cookies()) },
  );
  return see("/paths#your-books");
}

// A form post, answered like a server action's redirect.
function see(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location } });
}
