"use server";

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import {
  entitlements,
  hldTournaments,
  sessionReader,
} from "../../../../server/container";
import { textField } from "../../../form";

// P6-W43 (Q-P6-07): entering a tournament: register before it starts, check in during
// the hour before. Signed-in players only, not guests; server actions are reachable
// without the page, so each checks again.
async function entrant(): Promise<string> {
  const actor = await sessionReader().current(await headers());
  if (actor === null || actor.isGuest) redirect("/sign-in");
  if (!(await entitlements().can(actor.userId, "play.hld"))) notFound();
  return actor.userId;
}

const idOf = (form: FormData) => {
  const id = z.uuid().safeParse(textField(form, "id"));
  if (!id.success) notFound();
  return id.data;
};

export async function registerAction(form: FormData): Promise<void> {
  const userId = await entrant();
  const id = idOf(form);
  const done = await hldTournaments().register(id, userId);
  redirect(`/hld/tournaments/${id}${done ? "" : "?said=closed"}`);
}

export async function unregisterAction(form: FormData): Promise<void> {
  const userId = await entrant();
  const id = idOf(form);
  await hldTournaments().unregister(id, userId);
  redirect(`/hld/tournaments/${id}`);
}

export async function checkInAction(form: FormData): Promise<void> {
  const userId = await entrant();
  const id = idOf(form);
  const done = await hldTournaments().checkIn(id, userId, new Date());
  redirect(
    `/hld/tournaments/${id}${done === "checked_in" ? "" : `?said=${done}`}`,
  );
}
