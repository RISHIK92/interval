"use server";

import { redirect } from "next/navigation";
import { CHIPS, parseChip } from "../../../server/chips";
import { jobQueue, rankingInspection } from "../../../server/container";
import { saveRankingSetting } from "../../../server/ranking-settings";
import { textField } from "../../form";
import { requireAdmin } from "../guard";

// Server actions are reachable without the page, so this checks access again.
export async function saveRankingSettingAction(form: FormData): Promise<void> {
  const actor = await requireAdmin();
  const chip = parseChip(textField(form, "chip")) ?? CHIPS[0];
  const result = await saveRankingSetting(
    rankingInspection(),
    jobQueue(),
    actor.userId,
    textField(form, "key"),
    textField(form, "value"),
  );
  redirect(
    `/admin/ranking?chip=${chip}&${result.ok ? `saved=${result.changed ? "1" : "same"}` : `error=${result.error}`}`,
  );
}
