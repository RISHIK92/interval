import {
  Design,
  fitsProblem,
  judgeInput,
  practiceProblems,
  simulate,
} from "@interval/hld";
import {
  hldJudgements,
  jobQueue,
  sessionReader,
} from "../../../../../../server/container";
import { forbidden } from "../../../../../../server/capability";
import { log } from "../../../../../../server/log";
import { sameOrigin } from "../../../../../../server/same-origin";

export const dynamic = "force-dynamic";

const MAX_BYTES = 64 * 1024; // as the autosave: far above the largest valid design

// P6-W41 (CANVAS-6, §6.4, Q-P6-05): the AI judge and coach on a practice design, on the
// player's request. The design is checked and simulated here, never trusted from the
// browser; a design that fails the baseline earns no rubric points, so the worker only
// coaches it. Asking while one is waiting is the same request (LOAD-5).
export async function POST(
  request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const actor = await sessionReader().current(request.headers);
  if (actor === null) return new Response(null, { status: 401 });
  const refused = await forbidden(actor, "play.hld");
  if (refused !== null) return refused;
  const { slug } = await context.params;
  const problem = practiceProblems().find((p) => p.slug === slug);
  if (problem === undefined) return new Response(null, { status: 404 });
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) return new Response(null, { status: 413 });
  const body = await request.text();
  if (new TextEncoder().encode(body).length > MAX_BYTES)
    return new Response(null, { status: 413 });
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return new Response(null, { status: 400 });
  }
  const parsed = Design.safeParse(raw);
  if (!parsed.success || fitsProblem(parsed.data, problem).length > 0)
    return new Response(null, { status: 400 });
  const result = simulate(problem, parsed.data);
  const asked = await hldJudgements().request(
    actor.userId,
    slug,
    judgeInput(problem, parsed.data, result),
    result.baselinePassed,
  );
  if (asked.created)
    try {
      await jobQueue().enqueue(
        "judge_hld",
        { judgement_id: asked.id },
        { idempotencyKey: `hld-judge-${asked.id}` },
      );
    } catch (error) {
      // Said and thrown; the request is dropped, so the player may ask again rather
      // than wait on feedback nobody will write.
      log.error("hld: judgement not queued", { id: asked.id, error });
      await hldJudgements().drop(asked.id);
      throw error;
    }
  return Response.json({ id: asked.id }, { status: 202 });
}
