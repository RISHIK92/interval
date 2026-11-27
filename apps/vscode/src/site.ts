import type { Chip } from "@interval/api-client";

// The device token travels with every request, so the site is https, or plain http to
// this machine only, as `interval` allows (cli/interval/cli.go, safeSite).
const THIS_MACHINE = new Set(["localhost", "127.0.0.1", "[::1]"]);

export type Site = {
  // The site's address without a trailing slash; a site may live under a path.
  readonly base: string;
  readonly origin: string;
};

type SiteSetting =
  | { readonly kind: "unset" }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "ok"; readonly site: Site };

export function readSite(raw: string): SiteSetting {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (trimmed === "") return { kind: "unset" };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return refused(`"${trimmed}" isn't a web address`);
  }
  const secure =
    url.protocol === "https:" ||
    (url.protocol === "http:" && THIS_MACHINE.has(url.hostname));
  if (!secure) {
    return refused(
      "it must be https (plain http only for localhost): the device token travels with every request",
    );
  }
  if (url.username !== "" || url.password !== "") {
    return refused("it must not carry a user name or password");
  }
  if (url.search !== "" || url.hash !== "") {
    return refused("it must be the site's address alone, without ? or #");
  }
  return {
    kind: "ok",
    site: {
      base: url.origin + url.pathname.replace(/\/+$/, ""),
      origin: url.origin,
    },
  };
}

function refused(why: string): SiteSetting {
  return { kind: "refused", reason: `interval.url is refused: ${why}.` };
}

export function statusUrl(site: Site, chip: Chip | undefined): string {
  return withChip(new URL(`${site.base}/api/agent/status`), chip);
}

// With no suggestions, the quick session is Home at the same break length (or the
// user's own, when there's no answer to take it from).
export function homeUrl(site: Site, chip: Chip | undefined): string {
  return withChip(new URL(`${site.base}/`), chip);
}

function withChip(url: URL, chip: Chip | undefined): string {
  if (chip !== undefined) url.searchParams.set("chip", chip);
  return url.toString();
}

// Only the configured site's pages open: a link elsewhere in an answer is refused, so a
// tampered or misconfigured answer can't send the browser anywhere else.
export function onSite(site: Site, raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.origin === site.origin ? url.toString() : null;
  } catch {
    return null;
  }
}
