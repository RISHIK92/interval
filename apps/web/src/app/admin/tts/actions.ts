"use server";

import { notFound, redirect } from "next/navigation";
import { adminTts } from "../../../server/container";
import { BIGINT_ID } from "../../../server/ports";
import { textField } from "../../form";
import { requireAdmin } from "../guard";

// P4-W22-S03 (TTS-1): the owner's pick of a voice for one script, once. Server actions
// are reachable without the page, so this checks access again.
export async function pickVoiceAction(form: FormData): Promise<void> {
  const actor = await requireAdmin();
  const id = textField(form, "sampleId");
  if (!BIGINT_ID.test(id)) notFound();
  const picked = await adminTts().pick(id, actor.userId);
  redirect(picked ? "/admin/tts?saved=1" : "/admin/tts?error=picked");
}
