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

export async function startPathAction(form: FormData): Promise<void> {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  const parsed = Start.safeParse({ pathId: textField(form, "pathId") });
  if (!parsed.success) redirect("/paths");
  const { pathId } = parsed.data;
  const started = await paths().start(actor.userId, pathId);
  if (started === null) redirect("/paths");
  if (started)
    events().emit(
      "path_started",
      { path_id: pathId },
      { ...actor, sessionId: visitId(await cookies()) },
    );
  redirect(`/paths/${pathId}`);
}
