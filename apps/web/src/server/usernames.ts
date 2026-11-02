// P3-W14-S05 (Q-P3-11; owner, 2026-11-02): 3 to 20 of a-z, 0-9 and underscore. Typed
// capitals are taken as lower case; anything else is refused.
export function usernameOf(raw: string): string | null {
  const username = raw.trim().toLowerCase();
  return /^[a-z0-9_]{3,20}$/.test(username) ? username : null;
}
