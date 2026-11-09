import { z } from "zod";
import { appAccount } from "../../../../../server/app-account";
import { finishBookSession } from "../../../../../server/book-flow";
import { books } from "../../../../../server/container";
import { BIGINT_ID } from "../../../../../server/ports";

export const dynamic = "force-dynamic";

const Finish = z.object({ sessionId: z.string().regex(BIGINT_ID) });

// P4-W21-S04 (§5F): the app's Mark done, as the web's (server/book-flow.ts).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const context = await appAccount(request);
  if (context instanceof Response) return context;
  const { id } = await params;
  const body = Finish.safeParse(await request.json().catch(() => null));
  if (!BIGINT_ID.test(id) || !body.success)
    return new Response(null, { status: 400 });
  // A session of this book of theirs, checked before anything is marked done.
  const session = await books().reading(
    context.userId,
    id,
    body.data.sessionId,
  );
  if (session?.sessionId !== body.data.sessionId)
    return new Response(null, { status: 404 });
  const done = await finishBookSession(context, body.data.sessionId);
  if (done === null) return new Response(null, { status: 404 });
  return Response.json({ chapterDone: done.chapterDone });
}
