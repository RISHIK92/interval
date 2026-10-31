"use server";

import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { adminQuestions } from "../../../server/container";
import { BIGINT_ID, LEVELS } from "../../../server/ports";
import { textField } from "../../form";
import { requireAdmin } from "../guard";

// Q-2, P2-W8-S03: Keep or Retire a question in the spot-check queue. Server actions
// are reachable without the page, so this checks access again.
export async function decideAction(form: FormData): Promise<void> {
  const actor = await requireAdmin();
  const questionId = textField(form, "questionId");
  if (!BIGINT_ID.test(questionId)) notFound();
  const decision = textField(form, "decision");
  if (decision !== "keep" && decision !== "retire") notFound();
  const decided = await adminQuestions().decide(
    questionId,
    decision,
    actor.userId,
  );
  redirect(
    decided ? "/admin/questions?saved=1" : "/admin/questions?error=decided",
  );
}

// P3-W13-S03 (Q-P3-05 (b)): an estimation question the owner writes, live at once.
// The limits are question's own (stem 500, citation 300, unit 40, title 300).
const Estimate = z.object({
  stem: z.string().trim().min(1).max(500),
  // Digits, an optional fraction: "1e3" and "Infinity" aren't what a person types.
  answer: z
    .string()
    .trim()
    .regex(/^\d+(\.\d+)?$/)
    .transform(Number)
    .pipe(z.number().positive()),
  unit: z.string().trim().min(1).max(40),
  concepts: z
    .string()
    .transform((v) => v.split(/[\s,]+/).filter((slug) => slug !== ""))
    .pipe(z.array(z.string().max(200)).min(1).max(10)),
  difficulty: z.enum(LEVELS),
  sourceUrl: z
    .string()
    .trim()
    .max(2000)
    .regex(/^https?:\/\//)
    .pipe(z.url()),
  sourceTitle: z.string().trim().min(1).max(300),
  citation: z.string().trim().min(1).max(300),
});

export async function writeEstimateAction(form: FormData): Promise<void> {
  await requireAdmin();
  const parsed = Estimate.safeParse(Object.fromEntries(form));
  if (!parsed.success) redirect("/admin/questions?error=estimate");
  const id = await adminQuestions().writeEstimate(parsed.data);
  redirect(
    id === null
      ? "/admin/questions?error=concepts"
      : "/admin/questions?written=1",
  );
}
