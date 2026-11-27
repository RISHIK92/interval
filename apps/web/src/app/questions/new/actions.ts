"use server";

import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { submitQuestion } from "../../../server/community";
import {
  communityQuestions,
  entitlements,
  events,
  jobQueue,
  sessionReader,
} from "../../../server/container";
import { COMMUNITY_OPTIONS } from "../../../server/ports";
import { visitId } from "../../../server/visits";
import { textField } from "../../form";

// What the form typed, given back on a refusal: React resets a form after its action.
export type QuestionValues = {
  stem: string;
  options: string[];
  correct: string;
  citation: string;
};

export type QuestionState =
  | { status: "sent"; remaining: number | null }
  | { status: "problem"; message: string; values: QuestionValues }
  | null;

const REFUSALS = {
  unverified: "Verify your email to write questions.",
  daily_limit:
    "You've reached today's limit of questions. Come back tomorrow (UTC).",
  no_section: "You can only write a question about a section you've opened.",
} as const;

// Q-P7-05 (owner, 2026-11-27): a community question, checked then reviewed. Server
// actions are reachable without the page, so this checks access again.
export async function submitQuestionAction(
  _previous: QuestionState,
  form: FormData,
): Promise<QuestionState> {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  // ADR-0029, Q-P7-05: guests can't submit.
  if (actor.isGuest) redirect("/sign-up");
  // ADR-0036: a plan without it gets what the page answers, a 404.
  if (!(await entitlements().can(actor.userId, "questions.submit"))) notFound();
  const values: QuestionValues = {
    stem: textField(form, "stem"),
    options: Array.from({ length: COMMUNITY_OPTIONS }, (_, i) =>
      textField(form, `option${String(i)}`),
    ),
    correct: textField(form, "correct"),
    citation: textField(form, "citation"),
  };
  const result = await submitQuestion(
    {
      community: communityQuestions(),
      entitlements: entitlements(),
      queue: jobQueue(),
      events: events(),
    },
    { ...actor, sessionId: visitId(await cookies()) },
    {
      ...values,
      // No choice made is no answer, never the first one.
      correct: values.correct === "" ? undefined : values.correct,
      momentId: textField(form, "momentId"),
      idempotencyKey: textField(form, "idempotencyKey"),
    },
    new Date(),
  );
  switch (result.status) {
    case "submitted":
      return { status: "sent", remaining: result.remaining };
    case "invalid":
      return { status: "problem", message: result.message, values };
    case "refused":
      return {
        status: "problem",
        message: REFUSALS[result.reason],
        values,
      };
  }
}
