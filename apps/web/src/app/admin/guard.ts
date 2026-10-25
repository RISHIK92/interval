import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { entitlements, sessionReader } from "../../server/container";
import type { Actor } from "../../server/ports";

// Q-P1-29: the admin pages exist only for holders of admin.review (OPS-3). Anyone
// else, signed in or not, gets a 404, so the pages' existence isn't revealed.
export async function requireAdmin(): Promise<Actor> {
  const actor = await sessionReader().current(await headers());
  if (
    actor === null ||
    !(await entitlements().can(actor.userId, "admin.review"))
  ) {
    notFound();
  }
  return actor;
}
