import {
  type CardControl,
  type Chip,
  FeedResponse,
  FeedSetup,
} from "@interval/api-client";
import { api } from "./api";

type Loaded =
  | { status: "ok"; feed: FeedResponse }
  | { status: "setup"; setup: FeedSetup["setup"] }
  | { status: "forbidden" | "failed" };

// P4-W20-S01 (§5A): Home's feed and its card controls, from the site's JSON API. No chip:
// the server answers with the break length chosen at onboarding.
export async function readFeed(chip: Chip | null): Promise<Loaded> {
  const response = await api(
    chip === null ? "/api/feed" : `/api/feed?chip=${chip}`,
    { method: "GET" },
  );
  // ADR-0036: the plan doesn't include the feed.
  if (response.status === 403) return { status: "forbidden" };
  if (response.status === 409) {
    const due = FeedSetup.safeParse(await response.json().catch(() => null));
    return {
      status: "setup",
      setup: due.success ? due.data.setup : "onboarding",
    };
  }
  if (!response.ok) {
    console.warn("feed: not read", response.status);
    return { status: "failed" };
  }
  const parsed = FeedResponse.safeParse(await response.json());
  if (!parsed.success) {
    console.warn("feed: not one", parsed.error.message);
    return { status: "failed" };
  }
  return { status: "ok", feed: parsed.data };
}

export async function sendControl(
  itemId: string,
  control: CardControl,
): Promise<boolean> {
  const response = await api("/api/feed/control", {
    method: "POST",
    body: { itemId, control },
  });
  if (!response.ok) console.warn("feed: control not applied", response.status);
  return response.ok;
}
