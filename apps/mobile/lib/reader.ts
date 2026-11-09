import { type Chip, ReaderResponse } from "@interval/api-client";
import { api } from "./api";

// P4-W20-S02 (ADR-0018): the reader's page and its row's actions, from the site's API.
export async function readPage(
  itemId: string,
  query: { moment?: string; chip?: Chip; pos?: string },
): Promise<
  { status: "ok"; page: ReaderResponse } | { status: "gone" | "failed" }
> {
  const search = new URLSearchParams(query).toString();
  const response = await api(
    `/api/read/${itemId}${search === "" ? "" : `?${search}`}`,
    { method: "GET" },
  );
  if (response.status === 404) return { status: "gone" };
  if (!response.ok) {
    console.warn("reader: not read", response.status);
    return { status: "failed" };
  }
  const parsed = ReaderResponse.safeParse(await response.json());
  if (!parsed.success) {
    console.warn("reader: not one", parsed.error.message);
    return { status: "failed" };
  }
  return { status: "ok", page: parsed.data };
}

const sent = async (path: string, method: string, body: object) => {
  const response = await api(path, { method, body });
  if (!response.ok) console.warn("reader: not applied", path, response.status);
  return response.ok;
};

// The section reached, or the article when it fell back (reached is null).
const on = (itemId: string, momentId: string | null) =>
  momentId === null ? { itemId } : { itemId, momentId };

// Mark done, or auto: the reader saw the section read through (P4-W20-S03).
export const markDone = (
  itemId: string,
  momentId: string | null,
  method: "mark_done" | "auto" = "mark_done",
) => sent("/api/read/finish", "POST", { ...on(itemId, momentId), method });

// Empty deletes the note (§5I).
export const writeNote = (
  itemId: string,
  momentId: string | null,
  body: string,
) => sent("/api/notes", "PUT", { ...on(itemId, momentId), body });

// Open in browser from a page shown in the app: the click, as the web's /out records it.
export const recordOutbound = (itemId: string, momentId: string | null) =>
  sent(
    `/api/read/${itemId}/out`,
    "POST",
    momentId === null ? {} : { moment: momentId },
  );
