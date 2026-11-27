import { AgentStatus, type Chip } from "@interval/api-client";
import { statusUrl, type Site } from "./site";

// The shape `interval` accepts (cli/interval/cli.go, tokenShape).
export const DEVICE_TOKEN = /^ivd_[A-Za-z0-9_-]{43}$/;

// A status is three links and a state; anything much bigger isn't one.
const MAX_BODY = 64 * 1024;
const TIMEOUT_MS = 10_000;
// What the route sends with a 429 (apps/web/src/app/api/agent/hook.ts).
const DEFAULT_RETRY_AFTER_S = 60;
// An hour at most: a larger wait is a broken header, and setTimeout can't take more
// than 2^31-1 ms anyway.
const MAX_RETRY_AFTER_S = 3600;

export type StatusResult =
  | { readonly kind: "ok"; readonly status: AgentStatus }
  | { readonly kind: "refused" }
  | { readonly kind: "plan" }
  | { readonly kind: "rateLimited"; readonly retryAfterSeconds: number }
  | { readonly kind: "redirect" }
  | { readonly kind: "failed"; readonly detail: string };

// The extension's only request (§7): the device token and, if set, the break length.
// Nothing from the editor, the workspace or a terminal goes with it.
export async function fetchStatus(
  fetchFn: typeof fetch,
  site: Site,
  token: string,
  chip: Chip | undefined,
): Promise<StatusResult> {
  let response: Response;
  try {
    response = await fetchFn(statusUrl(site, chip), {
      headers: { Authorization: `Bearer ${token}` },
      // As `interval` does: a redirect could carry the token to another host.
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    return {
      kind: "failed",
      detail: `couldn't reach Interval (${error instanceof Error ? error.message : String(error)})`,
    };
  }
  // A browser-style fetch hides a manual redirect behind status 0.
  if (
    response.type === "opaqueredirect" ||
    (response.status >= 300 && response.status < 400)
  ) {
    return { kind: "redirect" };
  }
  switch (response.status) {
    case 200:
      return parse(response);
    case 401:
      return { kind: "refused" };
    case 403:
      return { kind: "plan" };
    case 429:
      return {
        kind: "rateLimited",
        retryAfterSeconds: retryAfter(response.headers.get("Retry-After")),
      };
    default:
      return {
        kind: "failed",
        detail: `Interval answered ${String(response.status)}`,
      };
  }
}

async function parse(response: Response): Promise<StatusResult> {
  const malformed: StatusResult = {
    kind: "failed",
    detail: "Interval's answer wasn't a status",
  };
  let text: string | null;
  try {
    text = await readCapped(response);
  } catch (error) {
    return {
      kind: "failed",
      detail: `couldn't read Interval's answer (${error instanceof Error ? error.message : String(error)})`,
    };
  }
  if (text === null) return malformed;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return malformed;
  }
  const status = AgentStatus.safeParse(json);
  return status.success ? { kind: "ok", status: status.data } : malformed;
}

// The body as text, or null past MAX_BODY bytes: refused up front by its
// Content-Length, else by stopping the read once it's too long.
async function readCapped(response: Response): Promise<string | null> {
  const declared = Number(response.headers.get("Content-Length") ?? "0");
  if (declared > MAX_BODY) {
    await response.body?.cancel();
    return null;
  }
  if (response.body === null) return "";
  // fetch's body is bytes; the DOM-less types leave its chunks untyped.
  const reader: ReadableStreamDefaultReader<Uint8Array> =
    response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_BODY) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

// The route sends whole seconds; an HTTP date or nonsense falls back to its usual
// minute, and anything past an hour (or past what a number holds) is an hour.
function retryAfter(header: string | null): number {
  const value = header?.trim() ?? "";
  if (!/^\d+$/.test(value)) return DEFAULT_RETRY_AFTER_S;
  const seconds = Number(value);
  return Number.isFinite(seconds)
    ? Math.min(seconds, MAX_RETRY_AFTER_S)
    : MAX_RETRY_AFTER_S;
}
