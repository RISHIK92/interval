"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { notes, sessionReader } from "../../server/container";
import { log } from "../../server/log";
import { emitNote, writeNote } from "../../server/note-writes";
import { BIGINT_ID } from "../../server/ports";
import { visitId } from "../../server/visits";
import { sameSitePath, textField } from "../form";

// Notes (§5I, Q-P2-01, P2-W7-S03): a private note on the section being read, or on
// the article when there is no section. The Library edits a note by its own id
// (P2-W7-S04), which also reaches one whose section was re-segmented away. Saving an
// empty note deletes it.
const Body = z.string().trim().max(2000);
const Note = z.union([
  z.object({
    control: z.enum(["save", "delete"]),
    noteId: z.string().regex(BIGINT_ID),
    body: Body,
  }),
  z.object({
    control: z.enum(["save", "delete"]),
    itemId: z.string().regex(BIGINT_ID),
    momentId: z.string().regex(BIGINT_ID).optional(),
    body: Body,
  }),
]);

export async function noteAction(form: FormData): Promise<void> {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  // ADR-0029: guests play, and only play.
  if (actor.isGuest) redirect("/sign-up");
  const back = sameSitePath(textField(form, "back"), "/");
  const noteId = textField(form, "noteId");
  const parsed = Note.safeParse({
    control: textField(form, "control"),
    ...(noteId === ""
      ? {
          itemId: textField(form, "itemId"),
          momentId: textField(form, "momentId") || undefined,
        }
      : { noteId }),
    // Browsers send a text area's newlines as CRLF but its maxLength counts each
    // once; count and store them as the user saw them.
    body: textField(form, "body").replaceAll("\r\n", "\n"),
  });
  if (!parsed.success) {
    log.warn("notes: refused input", { user_id: actor.userId });
    redirect(back);
  }
  const note = parsed.data;
  const saving = note.control === "save" && note.body !== "";
  const context = { ...actor, sessionId: visitId(await cookies()) };
  if ("noteId" in note) {
    const on = saving
      ? await notes().update(actor.userId, note.noteId, note.body)
      : await notes().removeById(actor.userId, note.noteId);
    if (on !== null)
      emitNote(saving ? "note_saved" : "note_deleted", on, context);
    // Deleted in another tab, gone with its article, or not this user's: an edit's
    // text is lost, so it must at least be seen.
    else if (saving) {
      log.warn("notes: no such note", {
        user_id: actor.userId,
        note_id: note.noteId,
      });
    }
    redirect(back);
  }
  await writeNote(
    context,
    { itemId: note.itemId, momentId: note.momentId ?? null },
    // A delete is an empty save.
    note.control === "save" ? note.body : "",
  );
  redirect(back);
}
