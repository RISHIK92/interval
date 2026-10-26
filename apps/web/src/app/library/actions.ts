"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { feedback, jobQueue, sessionReader } from "../../server/container";
import { BIGINT_ID } from "../../server/ports";
import { queueRecompute } from "../../server/recompute";
import { textField } from "../form";

// Unsave from the Library (§5I, P1-W5-S05): back to the Library, not the feed.
export async function libraryUnsaveAction(form: FormData): Promise<void> {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  const itemId = textField(form, "itemId");
  if (!BIGINT_ID.test(itemId)) redirect("/library");
  // Saves anchor similar picks (Q-P1-13): the feed follows on its next recompute.
  if (await feedback().unsave(actor.userId, itemId)) {
    await queueRecompute(
      jobQueue(),
      actor.userId,
      `library-${actor.userId}-${randomUUID()}`,
      "feed: recompute after an unsave not queued",
    );
  }
  redirect("/library");
}
