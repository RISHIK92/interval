import type { ChapterEnd } from "@interval/api-client";
import { appAccount } from "../../../../../../server/app-account";
import { requestCheckpoint } from "../../../../../../server/books";
import { books, jobQueue } from "../../../../../../server/container";
import { BIGINT_ID, passMark } from "../../../../../../server/ports";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; chapter: string }> };

// P4-W21-S04 (§5F, Q-P2-35): a chapter's end in the app: its checkpoint's state, as the
// web's chapter page shows it.
export async function GET(
  request: Request,
  { params }: Params,
): Promise<Response> {
  const context = await appAccount(request);
  if (context instanceof Response) return context;
  const { id, chapter } = await params;
  if (!BIGINT_ID.test(id) || !BIGINT_ID.test(chapter))
    return new Response(null, { status: 400 });
  const end = await books().checkpoint(context.userId, chapter);
  if (end?.bookId !== id) return new Response(null, { status: 404 });
  const body: ChapterEnd = { ...end, passMark: passMark(end.size) };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}

// Make the checkpoint, or ask again after a failure or a stuck job (the web's
// requestCheckpointAction).
export async function POST(
  request: Request,
  { params }: Params,
): Promise<Response> {
  const context = await appAccount(request);
  if (context instanceof Response) return context;
  const { id, chapter } = await params;
  if (!BIGINT_ID.test(id) || !BIGINT_ID.test(chapter))
    return new Response(null, { status: 400 });
  const end = await books().checkpoint(context.userId, chapter);
  if (end?.bookId !== id) return new Response(null, { status: 404 });
  await requestCheckpoint(
    { books: books(), queue: jobQueue() },
    context.userId,
    chapter,
  );
  return new Response(null, { status: 204 });
}
