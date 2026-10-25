import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { preferences, sessionReader } from "../../server/container";
import { BREAK_LENGTHS, LEVELS, TOPICS } from "../../server/ports";
import { onboardingAction } from "./actions";

export const dynamic = "force-dynamic";

const TOPIC_NAMES: Record<(typeof TOPICS)[number], string> = {
  "system-design": "System design",
  databases: "Databases",
  "distributed-systems": "Distributed systems",
  backend: "Backend",
};

const LEVEL_NAMES: Record<(typeof LEVELS)[number], string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

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
  // A returning user skips onboarding; profile settings edit these later (W4-S08).
  if ((await preferences().get(actor.userId)) !== null) redirect("/");
  const { missing } = await props.searchParams;
  return (
    <main>
      <h1>What do you want to learn?</h1>
      {missing !== undefined && Object.hasOwn(MISSING, missing) ? (
        <p role="alert">{MISSING[missing]}</p>
      ) : null}
      <form action={onboardingAction}>
        <fieldset>
          <legend>Topics</legend>
          {TOPICS.map((topic) => (
            <label key={topic}>
              <input type="checkbox" name="topic" value={topic} />{" "}
              {TOPIC_NAMES[topic]}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>Your level</legend>
          {LEVELS.map((level) => (
            <label key={level}>
              <input type="radio" name="level" value={level} required />{" "}
              {LEVEL_NAMES[level]}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>A typical break</legend>
          {BREAK_LENGTHS.map((minutes) => (
            <label key={minutes}>
              <input type="radio" name="breakLength" value={minutes} required />{" "}
              {minutes.replace("-", "–")} min
            </label>
          ))}
        </fieldset>
        <button type="submit">Show my feed</button>
      </form>
    </main>
  );
}
