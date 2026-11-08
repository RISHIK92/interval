import { useSyncExternalStore } from "react";

// P4-W19-S03: Better Auth's client as the screens use it, without a server. Tests set the
// session and read what was asked of it.
type Session = { user: { email: string } } | null;
let session: Session = { user: { email: "ada@example.test" } };
let pending = false;
const listeners = new Set<() => void>();
const set = (next: Session, nextPending = pending) => {
  session = next;
  pending = nextPending;
  for (const l of listeners) l();
};

export const fake = {
  signIn: jest.fn<
    Promise<{ error: { status: number } | null }>,
    [{ email: string; password: string }]
  >(),
  signedIn: (email = "ada@example.test") => {
    set({ user: { email } }, false);
  },
  signedOut: () => {
    set(null, false);
  },
  // A refetch in flight, as when the app comes back to the foreground.
  refetching: (on: boolean) => {
    set(session, on);
  },
};

export const SITE = "http://localhost:3100";

export const authClient = {
  getCookie: () => Promise.resolve("better-auth.session_token=test"),
  useSession: () => ({
    data: useSyncExternalStore(
      (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      () => session,
    ),
    isPending: useSyncExternalStore(
      (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      () => pending,
    ),
  }),
  signIn: {
    email: async (input: { email: string; password: string }) => {
      const result = await fake.signIn(input);
      if (result.error === null) fake.signedIn(input.email);
      return result;
    },
  },
  signOut: () => {
    fake.signedOut();
    return Promise.resolve();
  },
};
