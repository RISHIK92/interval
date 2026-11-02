import { sameSitePath } from "../form";

// Where to go back to after choosing a username: this site only (parsed as the browser
// will), and never this page again, which would loop.
export function localPath(next: string | undefined): string {
  const path = sameSitePath(next ?? "", "/");
  return new URL(path, "http://x").pathname.startsWith("/username")
    ? "/"
    : path;
}
