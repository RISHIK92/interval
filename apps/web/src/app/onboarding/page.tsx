import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { preferences, sessionReader } from "../../server/container";
import { ChoicesFields } from "../ChoicesFields";
import { onboardingAction } from "./actions";

export const dynamic = "force-dynamic";

// Fixed text per field: the query string picks which, never what it says.
const MISSING: Record<string, string> = {
  topic: "Pick at least one topic.",
  level: "Pick a level.",
  break: "Pick a break length.",
};

// §5A, C-21, P1-W4-S01: one screen, three fields, then the feed.
export default async function OnboardingPage(props: {
  searchParams: Promise<{ missing?: string }>;
}) {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  // A returning user skips onboarding; the Profile page edits these (P1-W4-S08).
  if ((await preferences().get(actor.userId)) !== null) redirect("/");
  const { missing } = await props.searchParams;
  return (
    <main>
      <h1>What do you want to learn?</h1>
      {missing !== undefined && Object.hasOwn(MISSING, missing) ? (
        <p role="alert">{MISSING[missing]}</p>
      ) : null}
      <form action={onboardingAction}>
        <ChoicesFields />
        <button type="submit">Show my feed</button>
      </form>
    </main>
  );
}
