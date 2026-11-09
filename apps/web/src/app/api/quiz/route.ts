import { GAMES } from "@interval/api-client";
import { z } from "zod";
import { sessionReader } from "../../../server/container";
import type { EventContext } from "../../../server/events";
import { BIGINT_ID } from "../../../server/ports";
import {
  startBookCheckpoint,
  startCheckpoint,
  startGame,
  startTest,
} from "../../../server/quiz-flow";
import { appPlatform, fromSiteOrApp } from "../../../server/same-origin";

export const dynamic = "force-dynamic";

const Start = z.union([
  z.object({ game: z.enum(GAMES) }),
  // P4-W21-S03 (§5F): a checkpoint on a section of the active path.
  z.object({ sectionId: z.string().regex(BIGINT_ID) }),
  // P4-W21-S04 (Q-P2-35): a book chapter's checkpoint.
  z.object({ chapterId: z.string().regex(BIGINT_ID) }),
  z.object({
    itemId: z.string().regex(BIGINT_ID),
    momentId: z.string().regex(BIGINT_ID).optional(),
  }),
]);

// P4-W21-S01 (§6.3, Q-P2-14): a solo game, or Test 60s on what the reader shows, started
// as the web's actions start them (server/quiz-flow.ts).
export async function POST(request: Request): Promise<Response> {
  if (!fromSiteOrApp(request)) return new Response(null, { status: 403 });
  const actor = await sessionReader().current(request.headers);
  // ADR-0029: guests play too.
  if (actor === null) return new Response(null, { status: 401 });
  const body = Start.safeParse(await request.json().catch(() => null));
  if (!body.success) return new Response(null, { status: 400 });
  const source = appPlatform(request);
  const context = {
    ...actor,
    sessionId: null,
    ...(source === undefined ? {} : { source }),
  };
  const started = await start(context, actor.isGuest, body.data);
  if (started === "forbidden") return new Response(null, { status: 403 });
  // Nothing to play: no live question, every one asked this week, or no daily set.
  if (started === null || started === "none")
    return new Response(null, { status: 404 });
  return Response.json({ attemptId: started.attemptId }, { status: 201 });
}

// Checkpoints are on a path or a book, which guests have none of (ADR-0029).
async function start(
  context: EventContext,
  guest: boolean,
  asked: z.infer<typeof Start>,
): Promise<{ attemptId: string } | "forbidden" | "none" | null> {
  if ("game" in asked) return startGame(context, asked.game);
  if ("sectionId" in asked)
    return guest ? null : startCheckpoint(context, asked.sectionId);
  if ("chapterId" in asked)
    return guest ? null : startBookCheckpoint(context, asked.chapterId);
  return startTest(context, asked.itemId, asked.momentId ?? null);
}
