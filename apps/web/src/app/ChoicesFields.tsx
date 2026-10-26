import {
  BREAK_LENGTHS,
  GOALS,
  LEVELS,
  LIVE_GOALS,
  type Preferences,
  TOPICS,
} from "../server/ports";

// The design's goal options (docs/wireframes/app-design.html, screen 1; ADR-0015).
const GOAL_TEXT: Record<(typeof GOALS)[number], [string, string]> = {
  "system-design-interviews": [
    "Pass system design interviews",
    "Battles, estimation, real trade-offs",
  ],
  "stack-i-use": [
    "Get better at the stack I use",
    "Picks tied to your real projects",
  ],
  "finish-that-book": [
    "Finally finish that book",
    "Split into 4-minute sessions",
  ],
  "stay-sharp": ["Stay sharp, nothing formal", "A good mix, no syllabus"],
};

const isLive = (goal: (typeof GOALS)[number]) =>
  LIVE_GOALS.some((live) => live === goal);

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

// The explicit choices (PER-1): asked at onboarding (C-21), edited on the Profile page
// (P1-W4-S08), which fills them in.
export function ChoicesFields({ current }: { current?: Preferences }) {
  return (
    <>
      <fieldset>
        <legend>What should your breaks add up to?</legend>
        {GOALS.map((goal) => {
          const [title, detail] = GOAL_TEXT[goal];
          const live = isLive(goal);
          return (
            <label key={goal}>
              <input
                type="checkbox"
                name="goal"
                value={goal}
                disabled={!live}
                defaultChecked={live && current?.goals.includes(goal)}
              />{" "}
              {title} <small>{live ? detail : `${detail} · Coming soon`}</small>
            </label>
          );
        })}
      </fieldset>
      <fieldset>
        <legend>Topics</legend>
        {TOPICS.map((topic) => (
          <label key={topic}>
            <input
              type="checkbox"
              name="topic"
              value={topic}
              defaultChecked={current?.topics.includes(topic)}
            />{" "}
            {TOPIC_NAMES[topic]}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>Your level</legend>
        {LEVELS.map((level) => (
          <label key={level}>
            <input
              type="radio"
              name="level"
              value={level}
              required
              defaultChecked={current?.level === level}
            />{" "}
            {LEVEL_NAMES[level]}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>A typical break</legend>
        {BREAK_LENGTHS.map((minutes) => (
          <label key={minutes}>
            <input
              type="radio"
              name="breakLength"
              value={minutes}
              required
              defaultChecked={current?.breakLength === minutes}
            />{" "}
            {minutes.replace("-", "–")} min
          </label>
        ))}
      </fieldset>
    </>
  );
}
