import {
  BREAK_LENGTHS,
  LEVELS,
  type Preferences,
  TOPICS,
} from "../server/ports";

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
