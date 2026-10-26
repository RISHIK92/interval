import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { preferences, sessionReader } from "../../server/container";
import {
  BreakChoices,
  GoalChoices,
  LevelChoices,
  TopicChoices,
} from "../ChoicesFields";
import { onboardingAction } from "./actions";
import { OnboardingSteps } from "./OnboardingSteps";

export const dynamic = "force-dynamic";

// Fixed text per field: the query string picks which, never what it says. In step order.
const MISSING: Record<string, string> = {
  goal: "Pick at least one goal.",
  topic: "Pick at least one topic.",
  level: "Pick a level.",
  break: "Pick a break length.",
};

const STEPS = [
  {
    title: "What should your breaks add up to?",
    subtitle: "We'll shape every pick around this.",
    fields: <GoalChoices />,
  },
  { title: "What do you want to learn?", fields: <TopicChoices /> },
  { title: "Where are you now?", fields: <LevelChoices /> },
  { title: "How long is a typical break?", fields: <BreakChoices /> },
];

// §5A, C-21, P1-W4-S01, ADR-0015: four steps of one form, then the feed.
export default async function OnboardingPage(props: {
  searchParams: Promise<{ missing?: string }>;
}) {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  // A returning user skips onboarding; the Profile page edits these (P1-W4-S08).
  if ((await preferences().get(actor.userId)) !== null) redirect("/");
  const { missing } = await props.searchParams;
  const refused =
    missing !== undefined && Object.hasOwn(MISSING, missing) ? missing : null;
  return (
    <main className="mx-auto max-w-md px-4 pt-6">
      <form action={onboardingAction}>
        <OnboardingSteps
          steps={STEPS}
          start={refused === null ? 0 : Object.keys(MISSING).indexOf(refused)}
          alert={refused === null ? null : (MISSING[refused] ?? null)}
        />
      </form>
    </main>
  );
}
