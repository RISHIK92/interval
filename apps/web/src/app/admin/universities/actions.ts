"use server";

import { notFound, redirect } from "next/navigation";
import { adminUniversities, leaderboards } from "../../../server/container";
import { BIGINT_ID } from "../../../server/ports";
import { universityName } from "../../../server/universities";
import { textField } from "../../form";
import { requireAdmin } from "../guard";

// P3-W14-S04: the moved players' boards, and the averages of both universities.
// shortcut: one invalidation per player, fine for a typed university's handful;
// batch if typed universities grow large.
async function movedBoards(players: string[], from: string): Promise<void> {
  for (const userId of players)
    await leaderboards().invalidate(userId, [{ university: from }]);
}

// P3-W14-S03 (ADR-0032): rename, merge or remove a typed university. Server actions are
// reachable without the page, so this checks access again.
export async function tidyUniversityAction(form: FormData): Promise<void> {
  await requireAdmin();
  const id = textField(form, "universityId");
  if (!BIGINT_ID.test(id)) notFound();
  const op = textField(form, "op");
  let error: string | null;
  if (op === "rename") {
    const name = universityName(textField(form, "name"));
    if (name === null) redirect("/admin/universities?error=name");
    const outcome = await adminUniversities().rename(id, name);
    error = outcome === "renamed" ? null : outcome;
  } else if (op === "merge") {
    const intoId = textField(form, "intoId").trim();
    const moved = BIGINT_ID.test(intoId)
      ? await adminUniversities().merge(id, intoId)
      : null;
    if (moved !== null) await movedBoards(moved, id);
    error = moved === null ? "merge" : null;
  } else if (op === "remove") {
    const moved = await adminUniversities().remove(id);
    if (moved !== null) await movedBoards(moved, id);
    error = moved === null ? "missing" : null;
  } else notFound();
  redirect(
    error === null
      ? "/admin/universities?saved=1"
      : `/admin/universities?error=${error}`,
  );
}
