import { env } from "../env";

// What a server action hands back to its form: null before the first submit.
export type FormState = { message: string } | null;

// A field the browser sent as a file, or not at all, counts as empty.
export function textField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

// A page to go back to, parsed as the browser will (it drops tabs and newlines), kept
// only while it stays on this site; anything else is `fallback`.
export function sameSitePath(value: string, fallback: string): string {
  if (value === "") return fallback;
  const base = new URL(env().BETTER_AUTH_URL);
  const url = URL.parse(value, base);
  return url !== null && url.origin === base.origin
    ? `${url.pathname}${url.search}`
    : fallback;
}
