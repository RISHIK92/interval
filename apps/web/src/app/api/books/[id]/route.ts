import type { BookReading } from "@interval/api-client";
import { appAccount } from "../../../../server/app-account";
import { books, events } from "../../../../server/container";
import { BIGINT_ID } from "../../../../server/ports";

export const dynamic = "force-dynamic";

// P4-W21-S04 (§5F, Q-P2-31): a book session for the app's PDF reader, as the web's book
// page reads it: its pages, the place kept, the way on. The owner's only.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const context = await appAccount(request);
  if (context instanceof Response) return context;
  const { id } = await params;
  const session = new URL(request.url).searchParams.get("session");
  if (!BIGINT_ID.test(id) || (session !== null && !BIGINT_ID.test(session)))
    return new Response(null, { status: 400 });
  const reading = await books().reading(context.userId, id, session);
  // Not the user's, not there, or not ready yet: nothing to read.
  if (reading === null) return new Response(null, { status: 404 });
  events().emit(
    "book_opened",
    { book_id: reading.bookId, session_id: reading.sessionId },
    context,
  );
  const body: BookReading = reading;
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
