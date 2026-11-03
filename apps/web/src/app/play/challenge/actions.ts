"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { log } from "../../../server/log";
import {
  GAME_MODES,
  type GameMode,
  type LiveMatch,
} from "../../../server/ports";
import { requireUsername } from "../../username/gate";
import { gameEnv } from "../../../env";
import {
  challenges,
  entitlements,
  privateMatch,
  sessionReader,
} from "../../../server/container";
import { textField } from "../../form";
import { liveHref } from "../live/href";
import { TOKEN } from "./token";

const Mode = z.enum(GAME_MODES);

// The plan has live games (OPS-3), and the sprint itself for a sprint challenge (its
// screen asks both), with live games configured.
async function mayPlay(userId: string, mode: GameMode): Promise<boolean> {
  if (gameEnv() === null) return false;
  const [live, sprint] = await Promise.all([
    entitlements().can(userId, "play.live"),
    mode === "sprint"
      ? entitlements().can(userId, "play.sprint")
      : Promise.resolve(true),
  ]);
  return live && sprint;
}

// P3-W17-S03 (Q-P3-16; owner, 2026-11-03): a challenge link for one friend, valid 10
// minutes. Making it counts as being online.
export async function createChallengeAction(form: FormData): Promise<void> {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/play");
  if (!actor.isGuest) await requireUsername(actor.userId, "/play/challenge");
  const mode = Mode.safeParse(form.get("mode"));
  if (!mode.success) redirect("/play/challenge");
  if (!(await mayPlay(actor.userId, mode.data))) redirect("/play");
  const token = await challenges().create(actor.userId, mode.data);
  await challenges().beat(actor.userId);
  redirect(`/play/challenge?t=${encodeURIComponent(token)}`);
}

// The friend's "Play now": taken once, while its sender is online and both may play
// it; the private, unrated match is made and the sender's open tab told. Anything else
// goes back to the link, which says why.
export async function acceptChallengeAction(form: FormData): Promise<void> {
  const token = TOKEN.safeParse(textField(form, "token"));
  if (!token.success) redirect("/play");
  const back = `/c/${token.data}`;
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect(back);
  const open = await challenges().peek(token.data, actor.userId);
  if (open.status !== "open" || !(await challenges().online(open.sender)))
    redirect(back);
  if (
    !(await mayPlay(actor.userId, open.mode)) ||
    !(await mayPlay(open.sender, open.mode))
  )
    redirect(`${back}?unplayable=1`);
  const taken = await challenges().take(token.data, actor.userId);
  if (taken.status !== "open") redirect(back);
  let match: LiveMatch;
  try {
    match = await privateMatch([taken.sender, actor.userId], taken.mode);
  } catch (error) {
    // The link is spent; the friend is told, and it's counted (logged).
    log.error("game: challenge not started", { error });
    redirect(`${back}?failed=1`);
  }
  await challenges().notify(taken.sender, {
    matchId: match.id,
    mode: taken.mode,
  });
  redirect(liveHref(taken.mode, match.id));
}
