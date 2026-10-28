"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { events, paths, sessionReader } from "../../server/container";
import { BIGINT_ID } from "../../server/ports";
import { visitId } from "../../server/visits";
import { textField } from "../form";

// §5F, Q-P2-27 (P2-W10-S03): Start (or Resume) makes a live path the user's active
// one, pausing any other.
const Start = z.object({ pathId: z.string().regex(BIGINT_ID) });

async function signedIn() {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  return { actor, context: { ...actor, sessionId: visitId(await cookies()) } };
}

export async function startPathAction(form: FormData): Promise<void> {
  const { actor, context } = await signedIn();
  const parsed = Start.safeParse({ pathId: textField(form, "pathId") });
  if (!parsed.success) redirect("/paths");
  const { pathId } = parsed.data;
  const started = await paths().start(actor.userId, pathId);
  if (started === null) redirect("/paths");
  // Q-P2-28: the pause a start causes counts as a pause for the continuity metric.
  if (started.paused !== null)
    events().emit(
      "path_paused",
      { path_id: started.paused, cause: "started_other" },
      context,
    );
  if (started.firstTime)
    events().emit("path_started", { path_id: pathId }, context);
  redirect(`/paths/${pathId}`);
}

// P2-W10-S05 (C-25, Q-P2-23): edits to the user's own copy of the path, from the
// path page's Edit mode, which they return to.
const Section = z.object({ sectionId: z.string().regex(BIGINT_ID) });
const Edit = z.discriminatedUnion("edit", [
  z.object({ edit: z.literal("pause"), pathId: z.string().regex(BIGINT_ID) }),
  Section.extend({ edit: z.enum(["up", "down", "skip", "unskip"]) }),
  Section.extend({
    edit: z.literal("swap"),
    ordinal: z.coerce.number().int().min(0).max(32767),
    momentId: z.string().regex(BIGINT_ID),
  }),
]);

export async function editPathAction(form: FormData): Promise<void> {
  const { actor, context } = await signedIn();
  const parsed = Edit.safeParse(Object.fromEntries(form));
  if (!parsed.success) redirect("/paths");
  const edit = parsed.data;
  const { userId } = actor;
  if (edit.edit === "pause") {
    if (await paths().pause(userId, edit.pathId))
      events().emit(
        "path_paused",
        { path_id: edit.pathId, cause: "user" },
        context,
      );
    redirect(`/paths/${edit.pathId}?edit=1`);
  }
  const pathId =
    edit.edit === "swap"
      ? await paths().swapSession(
          userId,
          edit.sectionId,
          edit.ordinal,
          edit.momentId,
        )
      : edit.edit === "skip"
        ? await paths().skipSection(userId, edit.sectionId)
        : edit.edit === "unskip"
          ? await paths().unskipSection(userId, edit.sectionId)
          : await paths().moveSection(userId, edit.sectionId, edit.edit);
  // Refused (not theirs, or no longer possible): the Paths tab shows where it stands.
  if (pathId === null) redirect("/paths");
  if (edit.edit === "skip")
    events().emit(
      "path_section_skipped",
      { path_id: pathId, section_id: edit.sectionId },
      context,
    );
  redirect(`/paths/${pathId}?edit=1`);
}
