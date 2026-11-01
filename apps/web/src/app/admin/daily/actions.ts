"use server";

import { notFound, redirect } from "next/navigation";
import { adminDaily } from "../../../server/container";
import { textField } from "../../form";
import { requireAdmin } from "../guard";

// A real calendar day, "YYYY-MM-DD" (2031-02-30 would fail in Postgres).
const isDay = (day: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(day) &&
  !Number.isNaN(Date.parse(`${day}T00:00:00Z`)) &&
  new Date(`${day}T00:00:00Z`).toISOString().startsWith(day);

// P3-W13-S05 (ADR-0031): approve tomorrow's daily challenge, or swap one of its
// questions. Server actions are reachable without the page, so this checks access
// again.
export async function approveDailyAction(form: FormData): Promise<void> {
  await requireAdmin();
  const day = textField(form, "day");
  if (!isDay(day)) notFound();
  redirect(
    (await adminDaily().approve(day))
      ? "/admin/daily?saved=approved"
      : "/admin/daily?error=started",
  );
}

export async function swapDailyAction(form: FormData): Promise<void> {
  await requireAdmin();
  const day = textField(form, "day");
  const position = Number(textField(form, "position"));
  if (
    !isDay(day) ||
    !Number.isInteger(position) ||
    position < 0 ||
    position > 4
  )
    notFound();
  redirect(
    (await adminDaily().swap(day, position))
      ? "/admin/daily?saved=swapped"
      : "/admin/daily?error=swap",
  );
}
