import type { QuizResults } from "@interval/api-client";
import { quizzes, sessionReader } from "../../../../../server/container";
import { BIGINT_ID } from "../../../../../server/ports";
import { finishAttempt, quizResults } from "../../../../../server/quiz-flow";
import { appPlatform, fromSiteOrApp } from "../../../../../server/same-origin";

export const dynamic = "force-dynamic";

// P4-W21-S01 (§6.3): the finish, recorded and scored as the web's, and the results.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ attempt: string }> },
): Promise<Response> {
  if (!fromSiteOrApp(request)) return new Response(null, { status: 403 });
  const actor = await sessionReader().current(request.headers);
  if (actor === null) return new Response(null, { status: 401 });
  const { attempt: attemptId } = await params;
  if (!BIGINT_ID.test(attemptId)) return new Response(null, { status: 400 });
  const source = appPlatform(request);
  const done = await finishAttempt(
    { ...actor, sessionId: null, ...(source === undefined ? {} : { source }) },
    attemptId,
  );
  const attempt =
    done === null ? null : await quizzes().attempt(actor.userId, attemptId);
  if (attempt === null) return new Response(null, { status: 404 });
  const body: QuizResults = quizResults(attempt);
  return Response.json(body);
}
