import type { PathResponse } from "@interval/api-client";
import { z } from "zod";
import { paths } from "../../../../server/container";
import { pausePath, startPath } from "../../../../server/path-flow";
import { appAccount } from "../../../../server/app-account";
import { BIGINT_ID } from "../../../../server/ports";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ path: string }> };

// P4-W21-S03 (§5F): a path's sections, their readings and checkpoints.
export async function GET(
  request: Request,
  { params }: Params,
): Promise<Response> {
  const context = await appAccount(request);
  if (context instanceof Response) return context;
  const { path: pathId } = await params;
  if (!BIGINT_ID.test(pathId)) return new Response(null, { status: 400 });
  const timeline = await paths().path(context.userId, pathId);
  if (timeline === null) return new Response(null, { status: 404 });
  const body: PathResponse = {
    pathId: timeline.pathId,
    name: timeline.name,
    why: timeline.why,
    retired: timeline.retired,
    mine: timeline.mine,
    sections: timeline.sections.map((s) => ({
      sectionId: s.sectionId,
      concepts: s.concepts,
      open: s.open,
      checkpoint: s.checkpoint,
      skipped: s.skipped,
      holdsBack: s.holdsBack,
      mastered: s.mastered,
      size: s.size,
      passMark: s.passMark,
      readings: s.readings.map((r) => ({
        itemId: r.itemId,
        momentId: r.momentId,
        sectionTitle: r.sectionTitle,
        articleTitle: r.articleTitle,
        sourceName: r.sourceName,
        minutes: r.minutes,
        linkBroken: r.linkBroken,
        finished: r.finished,
      })),
    })),
  };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}

const Act = z.object({ action: z.enum(["start", "pause"]) });

// Start (or Resume, pausing any other) and Pause, as the web's (server/path-flow.ts).
export async function POST(
  request: Request,
  { params }: Params,
): Promise<Response> {
  const context = await appAccount(request);
  if (context instanceof Response) return context;
  const { path: pathId } = await params;
  const body = Act.safeParse(await request.json().catch(() => null));
  if (!BIGINT_ID.test(pathId) || !body.success)
    return new Response(null, { status: 400 });
  const done =
    body.data.action === "start"
      ? await startPath(context, pathId)
      : await pausePath(context, pathId);
  return new Response(null, { status: done ? 204 : 404 });
}
