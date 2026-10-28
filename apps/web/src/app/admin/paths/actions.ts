"use server";

import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { adminPaths } from "../../../server/container";
import { BIGINT_ID } from "../../../server/ports";
import { requireAdmin } from "../guard";

// §5F, Q-P2-23 (P2-W10-S02): the owner's edits to a proposed path. One form control
// per action; the name and why fit the path table's limits. Server actions are
// reachable without the page, so this checks access again.
const Id = z.string().regex(BIGINT_ID);
const Control = z.discriminatedUnion("control", [
  z.object({
    control: z.literal("rename"),
    pathId: Id,
    name: z.string().trim().min(1).max(120),
    why: z.string().trim().min(1).max(500),
  }),
  z.object({ control: z.enum(["up", "down"]), sectionId: Id }),
  z.object({ control: z.literal("remove-section"), sectionId: Id }),
  z.object({
    control: z.literal("remove-session"),
    sectionId: Id,
    // Digits only: an empty field must not read as reading 0.
    ordinal: z
      .string()
      .regex(/^\d{1,5}$/)
      .transform(Number)
      .pipe(z.number().max(32767)),
  }),
  z.object({ control: z.enum(["approve", "retire"]), pathId: Id }),
]);

export async function pathAction(form: FormData): Promise<void> {
  await requireAdmin();
  const parsed = Control.safeParse(Object.fromEntries(form));
  if (!parsed.success) notFound();
  const c = parsed.data;
  const paths = adminPaths();
  let done: boolean;
  switch (c.control) {
    case "rename":
      done = await paths.rename(c.pathId, c.name, c.why);
      break;
    case "up":
    case "down":
      done = await paths.moveSection(c.sectionId, c.control);
      break;
    case "remove-section":
      done = await paths.removeSection(c.sectionId);
      break;
    case "remove-session":
      done = await paths.removeSession(c.sectionId, c.ordinal);
      break;
    case "approve":
      done = await paths.approve(c.pathId);
      break;
    case "retire":
      done = await paths.retire(c.pathId);
      break;
  }
  redirect(done ? "/admin/paths?saved=1" : "/admin/paths?error=refused");
}
