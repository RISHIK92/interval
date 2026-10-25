"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { accounts, sessionReader } from "../server/container";
import { endVisit } from "./visit";

// Accounts only (owner choice, 2026-10-25): a guest who signed out could not get back
// in without a new invite code.
export async function signOutAction(): Promise<void> {
  const requestHeaders = await headers();
  const actor = await sessionReader().current(requestHeaders);
  if (actor === null || actor.isGuest) redirect("/");
  await accounts().signOut(requestHeaders);
  await endVisit();
  redirect("/sign-in");
}
