"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { sessionReader, usernames } from "../../server/container";
import { isReserved, usernameOf } from "../../server/usernames";
import { textField } from "../form";
import { localPath } from "./next";

// P3-W14-S05 (Q-P3-11; owner, 2026-11-02): an account's username, chosen once.
export async function chooseUsernameAction(form: FormData): Promise<void> {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  // ADR-0029: guests play without one.
  if (actor.isGuest) redirect("/play");
  const next = localPath(textField(form, "next"));
  const again = (error: string, tried = "") =>
    `/username?error=${error}&next=${encodeURIComponent(next)}${tried === "" ? "" : `&tried=${tried}`}`;
  const username = usernameOf(textField(form, "username"));
  if (username === null) redirect(again("format"));
  if (isReserved(username)) redirect(again("reserved"));
  // "has-one": a double submit, or another tab chose first; either way it's done.
  if ((await usernames().claim(actor.userId, username)) === "taken")
    redirect(again("taken", username));
  redirect(next);
}
