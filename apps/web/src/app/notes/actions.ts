"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { events, notes, sessionReader } from "../../server/container";
import { log } from "../../server/log";
import { BIGINT_ID } from "../../server/ports";
import { visitId } from "../../server/visits";
import { sameSitePath, textField } from "../form";

// Notes (§5I, Q-P2-01, P2-W7-S03): a private note on the section being read, or on
// the article when there is no section. Saving an empty note deletes it.
const Note = z.object({
  control: z.enum(["save", "delete"]),
  itemId: z.string().regex(BIGINT_ID),
  momentId: z.string().regex(BIGINT_ID).optional(),
  body: z.string().trim().max(2000).default(""),
});

export async function noteAction(form: FormData): Promise<void> {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  const back = sameSitePath(textField(form, "back"), "/");
  const parsed = Note.safeParse({
    control: textField(form, "control"),
    itemId: textField(form, "itemId"),
    momentId: textField(form, "momentId") || undefined,
    // Browsers send a text area's newlines as CRLF but its maxLength counts each
    // once; count and store them as the user saw them.
    body: textField(form, "body").replaceAll("\r\n", "\n"),
  });
  if (!parsed.success) {
    log.warn("notes: refused input", { user_id: actor.userId });
    redirect(back);
  }
  const { control, itemId, body } = parsed.data;
  const momentId = parsed.data.momentId ?? null;
  const context = { ...actor, sessionId: visitId(await cookies()) };
  // Ids only, never the text (DB-5 events are analytics, not user content).
  const props = { item_id: itemId, moment_id: momentId };
  if (control === "save" && body !== "") {
    if (await notes().save(actor.userId, itemId, momentId, body)) {
      events().emit("note_saved", props, context);
    } else {
      // The section was re-segmented away since the page was shown, or the ids are
      // stale: the text is lost, so it must at least be seen.
      log.warn("notes: nothing to attach the note to", {
        user_id: actor.userId,
        ...props,
      });
    }
  } else if (await notes().remove(actor.userId, itemId, momentId)) {
    events().emit("note_deleted", props, context);
  }
  redirect(back);
}
