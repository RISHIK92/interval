import { z } from "zod";
import {
  battleResults,
  files,
  sessionReader,
} from "../../../../../server/container";

export const dynamic = "force-dynamic";

// P5-W35 (DB-6; Q-P5-22): one frame of a finished battle's replay, for its players:
// ?n= is the frame's place in the battle's snapshots, oldest first.
const Stored = z.object({ language: z.string(), code: z.string() });

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const actor = await sessionReader().current(request.headers);
  if (actor === null) return new Response(null, { status: 401 });
  const id = z.uuid().safeParse((await context.params).id);
  const n = z.coerce
    .number()
    .int()
    .min(0)
    .safeParse(new URL(request.url).searchParams.get("n"));
  if (!id.success || !n.success) return new Response(null, { status: 400 });
  const frames = await battleResults().frames(id.data, actor.userId);
  const frame = frames?.[n.data];
  if (frame === undefined) return new Response(null, { status: 404 });
  const file = await files().get(frame.key);
  if (file === null || file === "unchanged")
    return new Response(null, { status: 404 });
  let stored: z.infer<typeof Stored>;
  try {
    stored = Stored.parse(JSON.parse(await new Response(file.body).text()));
  } catch {
    // A snapshot whose store failed partway: gone, as a missing one is.
    return new Response(null, { status: 404 });
  }
  return Response.json(
    { userId: frame.userId, takenAt: frame.takenAt, ...stored },
    { headers: { "Cache-Control": "private, max-age=3600" } },
  );
}
