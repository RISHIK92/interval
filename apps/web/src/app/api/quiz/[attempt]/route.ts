import type { QuizView } from "@interval/api-client";
import { quizzes, sessionReader } from "../../../../server/container";
import { BIGINT_ID } from "../../../../server/ports";
import { quizKind } from "../../../../server/quiz-flow";
import { fromSiteOrApp } from "../../../../server/same-origin";

export const dynamic = "force-dynamic";

// P4-W21-S01 (Q-P2-14): the attempt and its open question, served now (the server's
// clock starts on it). Never the key: that comes with the answer.
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
  const next =
    attempt.finishedAt === null
      ? await quizzes().next(actor.userId, attemptId)
      : "over";
  if (next === null) return new Response(null, { status: 404 });
  const body: QuizView = {
    title: attempt.title,
    kind: quizKind(attempt),
    secondsLeft: attempt.secondsLeft,
    question:
      next === "over"
        ? null
        : next.kind === "choice"
          ? {
              kind: "choice",
              questionId: next.questionId,
              stem: next.stem,
              aiDrafted: next.aiDrafted,
              options: next.options,
            }
          : {
              kind: "estimate",
              questionId: next.questionId,
              stem: next.stem,
              aiDrafted: next.aiDrafted,
              unit: next.unit,
            },
  };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
