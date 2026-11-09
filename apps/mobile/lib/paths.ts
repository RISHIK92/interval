import { PathResponse, PathsResponse } from "@interval/api-client";
import { api, got } from "./api";

// P4-W21-S03 (§5F): topic paths from the site's API; a 409 is onboarding still to do on
// the web. Editing a path stays on the web (owner, 2026-11-09).
export const readPaths = async () =>
  got(await api("/api/paths", { method: "GET" }), PathsResponse, "paths");

export const readPath = async (pathId: string) =>
  got(
    await api(`/api/paths/${pathId}`, { method: "GET" }),
    PathResponse,
    "path",
  );

export async function setPath(
  pathId: string,
  action: "start" | "pause",
): Promise<boolean> {
  const response = await api(`/api/paths/${pathId}`, {
    method: "POST",
    body: { action },
  });
  if (!response.ok) console.warn("path: not changed", action, response.status);
  return response.ok;
}
