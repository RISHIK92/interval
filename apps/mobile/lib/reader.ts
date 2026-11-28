import { ReaderResponse } from "@interval/api-client";
import { api } from "./api";

// P4-W20-S02 (ADR-0018): the reader's page and its row's actions, from the site's API.
// ADR-0058: always the whole article.
export async function readPage(
  itemId: string,
  // pos: a feed card's position; path: a path's reading (P4-W21-S03), counted as the
  // web's from=path.
  query: { pos?: string; path?: string },
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

// Done, or auto: the reader saw the article read through (P4-W20-S03). Either
// completes the whole article (ADR-0058).
export const markDone = (
  itemId: string,
  method: "mark_done" | "auto" = "mark_done",
) => sent("/api/read/finish", "POST", { itemId, method });

// Empty deletes the note (§5I).
export const writeNote = (itemId: string, body: string) =>
  sent("/api/notes", "PUT", { itemId, body });

// Open in browser from a page shown in the app: the click, as the web's /out records it.
export const recordOutbound = (itemId: string) =>
  sent(`/api/read/${itemId}/out`, "POST", {});
