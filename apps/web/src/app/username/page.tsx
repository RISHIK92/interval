import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { sessionReader, usernames } from "../../server/container";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { FIELD } from "../ui/field";
import { chooseUsernameAction } from "./actions";
import { usernameOf } from "../../server/usernames";
import { localPath } from "./next";

export const dynamic = "force-dynamic";

// Fixed text per key: the query string picks which, never what it says.
const ERRORS: Record<string, string> = {
  taken: "That username is taken. Try another.",
  format: "3 to 20 letters a–z, digits or _.",
  reserved: "That username is kept for Interval. Try another.",
};

// P3-W14-S05 (§6.7, Q-P3-11; owner, 2026-11-02): asked once of every account, straight
// after onboarding or on its next visit; shown on boards in place of its name.
export default async function UsernamePage(props: {
  searchParams: Promise<{ next?: string; error?: string; tried?: string }>;
}) {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  // ADR-0029: guests play without one.
  if (actor.isGuest) redirect("/play");
  const { next: raw, error, tried } = await props.searchParams;
  const problem =
    error !== undefined && Object.hasOwn(ERRORS, error) ? ERRORS[error] : null;
  const next = localPath(raw);
  if ((await usernames().get(actor.userId)) !== null) redirect(next);
  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-4 pt-10">
      <h1 className="text-display">Choose your username</h1>
      <p className="text-ink-muted">
        Other players see it on boards and follow you by it. It can&apos;t be
        changed later.
      </p>
      <Card className="p-5">
        <form action={chooseUsernameAction} className="flex flex-col gap-3">
          <input type="hidden" name="next" value={next} />
          <label htmlFor="username" className="text-section">
            Username
          </label>
          <input
            id="username"
            name="username"
            required
            minLength={3}
            maxLength={20}
            pattern="[A-Za-z0-9_]{3,20}"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            // A name that was taken, to edit; only ever a valid username.
            defaultValue={usernameOf(tried ?? "") ?? undefined}
            aria-invalid={problem === null ? undefined : true}
            aria-describedby={
              problem === null
                ? "username-rule"
                : "username-rule username-error"
            }
            className={FIELD}
          />
          <p id="username-rule" className="text-sm text-ink-muted">
            3 to 20 letters a–z, digits or _.
          </p>
          {problem === null ? null : (
            <p id="username-error" role="alert" className="text-wrong">
              {problem}
            </p>
          )}
          <Button type="submit">Save username</Button>
        </form>
      </Card>
    </main>
  );
}
