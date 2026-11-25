import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Topic } from "@interval/db";
import { feedReader, preferences, sessionReader } from "../../server/container";
import { offeredTopics } from "../../server/preferences";
import {
  BreakChoices,
  GoalChoices,
  LevelChoices,
  TopicChoices,
} from "../ChoicesFields";
import { onboardingAction } from "./actions";
import { OnboardingSteps } from "./OnboardingSteps";

export const dynamic = "force-dynamic";

// Fixed text per field: the query string picks which, never what it says.
const MISSING: Record<string, string> = {
  goal: "Pick at least one goal.",
  topic: "Pick at least one topic.",
  level: "Pick a level.",
  break: "Pick a break length.",
  // ADR-0049: a topic that isn't offered, from a stale or forged form.
  "topic-unavailable": "That topic isn't available yet.",
};
// The step each refusal opens.
const STEP_OF: Record<string, number> = {
  goal: 0,
  topic: 1,
  "topic-unavailable": 1,
  level: 2,
  break: 3,
};

const steps = (topics: readonly Topic[]) => [
  {
    title: "What should your breaks add up to?",
    subtitle: "We'll shape every pick around this.",
    plan: "Goal",
    fields: <GoalChoices />,
  },
  {
    title: "What do you want to learn?",
    plan: "Topics",
    fields: <TopicChoices offered={topics} />,
  },
  { title: "Where are you now?", plan: "Level", fields: <LevelChoices /> },
  {
    title: "How long is a typical break?",
    plan: "Break length",
    fields: <BreakChoices />,
  },
];

// §5A, C-21, P1-W4-S01, ADR-0015: four steps of one form, then the feed.
export default async function OnboardingPage(props: {
  searchParams: Promise<{ missing?: string }>;
}) {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  // ADR-0029: guests play, and only play; the rest is for accounts.
  if (actor.isGuest) redirect("/sign-up");
  // A returning user skips onboarding; the Profile page edits these (P1-W4-S08).
  if ((await preferences().get(actor.userId)) !== null) redirect("/");
  const { missing } = await props.searchParams;
  const refused =
    missing !== undefined && Object.hasOwn(MISSING, missing) ? missing : null;
  const topics = await offeredTopics(feedReader());
  return (
    <main className="mx-auto max-w-md px-4 pt-6 lg:max-w-none lg:px-0 lg:pt-0">
      <form action={onboardingAction}>
        <OnboardingSteps
          steps={steps(topics)}
          start={refused === null ? 0 : (STEP_OF[refused] ?? 0)}
          alert={refused === null ? null : (MISSING[refused] ?? null)}
        />
      </form>
    </main>
  );
}
