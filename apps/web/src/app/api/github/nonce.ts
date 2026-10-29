// P2-W12-S01: the nonce that ties GitHub's callback to the connect this browser began.
// Only the GitHub routes read it, for 10 minutes.
export const NONCE_COOKIE = "iv_github";

export const nonceCookie = (secure: boolean) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure,
  path: "/api/github",
  maxAge: 10 * 60,
});
