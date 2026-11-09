import { quizzes, sessionReader } from "../../../../../server/container";
import { BIGINT_ID } from "../../../../../server/ports";
import { quizResults } from "../../../../../server/quiz-flow";
import { fromSiteOrApp } from "../../../../../server/same-origin";

export const dynamic = "force-dynamic";

// P4-W21-S01 (§6.3): a finished attempt's results, read only. A running one is 409, as
// the web's results page sends it back to the quiz: showing results never finishes.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ attempt: string }> },
): Promise<Response> {
  if (!fromSiteOrApp(request)) return new Response(null, { status: 403 });
  const actor = await sessionReader().current(request.headers);
  if (actor === null) return new Response(null, { status: 401 });
  const { attempt: attemptId } = await params;
  if (!BIGINT_ID.test(attemptId)) return new Response(null, { status: 400 });
  const attempt = await quizzes().attempt(actor.userId, attemptId);
  if (attempt === null) return new Response(null, { status: 404 });
  if (attempt.finishedAt === null) return new Response(null, { status: 409 });
  return Response.json(quizResults(attempt), {
    headers: { "Cache-Control": "no-store" },
  });
}
