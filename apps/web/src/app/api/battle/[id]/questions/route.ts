import { z } from "zod";
import {
  battleQuestions,
  jobQueue,
  sessionReader,
} from "../../../../../server/container";
import { log } from "../../../../../server/log";
import { sameOrigin } from "../../../../../server/same-origin";

export const dynamic = "force-dynamic";

// P5-W33 (§6.2, AI-1, OPS-4; Q-P5-13): "ask the interviewer" in an AI-league battle.
// POST asks (at most 10 a battle) and queues the answer for the worker, which answers
// from the problem's notes with QUESTIONS_MODEL; GET lists this player's questions and
// answers, which the page labels AI.
const MATCH_ID = z.uuid();
const Ask = z.object({ question: z.string().trim().min(1).max(500) });

async function seat(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<{ userId: string; matchId: string } | Response> {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const actor = await sessionReader().current(request.headers);
  if (actor === null) return new Response(null, { status: 401 });
  const id = MATCH_ID.safeParse((await context.params).id);
  if (!id.success) return new Response(null, { status: 400 });
  return { userId: actor.userId, matchId: id.data };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const who = await seat(request, context);
  if (who instanceof Response) return who;
  const body = Ask.safeParse(await request.json().catch(() => null));
  if (!body.success) return new Response(null, { status: 400 });
  const asked = await battleQuestions().ask(
    who.matchId,
    who.userId,
    body.data.question,
  );
  if (asked === null) return new Response(null, { status: 404 });
  if (asked === "limit") return new Response(null, { status: 429 });
  try {
    await jobQueue().enqueue(
      "answer_interviewer",
      { question_id: Number(asked.id) },
      { idempotencyKey: `interviewer-${asked.id}` },
    );
  } catch (error) {
    // Shown as unanswered (and logged), not left waiting on a job that doesn't exist.
    log.error("battle: interviewer question not queued", {
      id: asked.id,
      error,
    });
    await battleQuestions().fail(asked.id);
    throw error;
  }
  return new Response(null, { status: 202 });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const who = await seat(request, context);
  if (who instanceof Response) return who;
  return Response.json(await battleQuestions().list(who.matchId, who.userId), {
    headers: { "Cache-Control": "no-store" },
  });
}
