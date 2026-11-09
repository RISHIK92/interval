import { AnswerBody, type AnswerResult } from "@interval/api-client";
import { quizzes, sessionReader } from "../../../../../server/container";
import { BIGINT_ID } from "../../../../../server/ports";
import { answerChoice, answerEstimate } from "../../../../../server/quiz-flow";
import { appPlatform, fromSiteOrApp } from "../../../../../server/same-origin";

export const dynamic = "force-dynamic";

// P4-W21-S01 (Q-P2-14, C-27): an answer, checked and scored by the server, as the web's
// actions do; 409 after the clock and its grace. A resubmission gets the stored result.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ attempt: string }> },
): Promise<Response> {
  if (!fromSiteOrApp(request)) return new Response(null, { status: 403 });
  const actor = await sessionReader().current(request.headers);
  if (actor === null) return new Response(null, { status: 401 });
  const { attempt: attemptId } = await params;
  const body = AnswerBody.safeParse(await request.json().catch(() => null));
  if (
    !BIGINT_ID.test(attemptId) ||
    !body.success ||
    !BIGINT_ID.test(body.data.questionId)
  )
    return new Response(null, { status: 400 });
  const source = appPlatform(request);
  const context = {
    ...actor,
    sessionId: null,
    ...(source === undefined ? {} : { source }),
  };
  const { questionId } = body.data;
  let result: AnswerResult;
  if ("chosen" in body.data) {
    const got = await answerChoice(
      context,
      attemptId,
      questionId,
      body.data.chosen,
    );
    if (got === "late") return new Response(null, { status: 409 });
    if (got === null) return new Response(null, { status: 404 });
    result = {
      kind: "choice",
      correct: got.correct,
      correctOption: got.correctOption,
    };
  } else {
    const got = await answerEstimate(
      context,
      attemptId,
      questionId,
      body.data.guess,
    );
    if (got === "late") return new Response(null, { status: 409 });
    if (got === null) return new Response(null, { status: 404 });
    // Its source, as the web's reveal shows it (AI-3).
    const shown = await quizzes().answered(actor.userId, attemptId, questionId);
    const source = shown?.kind === "estimate" ? shown.source : null;
    result = {
      kind: "estimate",
      answer: got.answer,
      unit: got.unit,
      score: got.score,
      source:
        source === null || source.kind === "page"
          ? source
          : {
              kind: "section",
              itemId: source.itemId,
              momentId: source.momentId,
              sectionTitle: source.sectionTitle,
            },
    };
  }
  return Response.json(result);
}
