"use server";

import { notFound, redirect } from "next/navigation";
import {
  type SaveResult,
  saveBoundaries,
  saveTags,
} from "../../../../server/admin-review";
import { adminReview, jobQueue } from "../../../../server/container";
import { textField } from "../../../form";
import { requireAdmin } from "../../guard";

// A bigint id; anything else is not an item, and never reaches a redirect path.
function itemIdOf(form: FormData): string {
  const id = textField(form, "itemId");
  if (!/^\d{1,18}$/.test(id)) notFound();
  return id;
}

function back(itemId: string, result: SaveResult): never {
  const query = new URLSearchParams(
    result.ok ? { saved: "1" } : { error: result.error },
  );
  if (!result.ok)
    for (const value of result.detail) query.append("detail", value);
  redirect(`/admin/items/${itemId}?${query.toString()}`);
}

// Server actions are reachable without the page, so each one checks access again.
export async function saveBoundariesAction(form: FormData): Promise<void> {
  const actor = await requireAdmin();
  const itemId = itemIdOf(form);
  const headings = form.getAll("boundary").filter((v) => typeof v === "string");
  back(
    itemId,
    await saveBoundaries(
      adminReview(),
      jobQueue(),
      actor.userId,
      itemId,
      headings,
    ),
  );
}

export async function saveTagsAction(form: FormData): Promise<void> {
  const actor = await requireAdmin();
  const itemId = itemIdOf(form);
  const heading = textField(form, "heading");
  const input =
    textField(form, "intent") === "clear"
      ? null
      : {
          difficulty: textField(form, "difficulty"),
          concepts: textField(form, "concepts")
            .split(",")
            .map((c) => c.trim())
            .filter((c) => c !== ""),
        };
  back(
    itemId,
    await saveTags(adminReview(), actor.userId, itemId, heading, input),
  );
}
