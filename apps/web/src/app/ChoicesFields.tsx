import type { Topic } from "@interval/db";
import type { InputHTMLAttributes, ReactNode } from "react";
import {
  BREAK_LENGTHS,
  GOALS,
  LEVELS,
  LIVE_GOALS,
  type Preferences,
  TOPICS,
} from "../server/ports";

type Goal = (typeof GOALS)[number];

// The design's goal options (docs/wireframes/app-design.html, screen 1; ADR-0015), each
// drawn in the colour of the topic family it leans on.
export const GOAL_TEXT: Record<Goal, [string, string, Topic]> = {
  "system-design-interviews": [
    "Pass system design interviews",
    "Battles, estimation, real trade-offs",
    "system-design",
  ],
  "stack-i-use": [
    "Get better at the stack I use",
    "Picks tied to your real projects",
    "databases",
  ],
  "finish-that-book": [
    "Finally finish that book",
    "Split into 4-minute sessions",
    "distributed-systems",
  ],
  "stay-sharp": [
    "Stay sharp, nothing formal",
    "A good mix, no syllabus",
    "backend",
  ],
};

const isLive = (goal: Goal) => LIVE_GOALS.some((live) => live === goal);

export const TOPIC_NAMES: Record<Topic, string> = {
  "system-design": "System design",
  databases: "Databases",
  "distributed-systems": "Distributed systems",
  backend: "Backend",
  "software-design": "Software design",
};

export const LEVEL_NAMES: Record<(typeof LEVELS)[number], string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

// A small mark per topic family for the option tiles; decorative.
function Glyph({ topic }: { topic: Topic }) {
  const ink = `var(--${topic}-right)`;
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6 lg:size-8">
      {topic === "system-design" ? (
        <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" fill={ink} />
      ) : topic === "databases" ? (
        <>
          <path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6z" fill={ink} />
          <ellipse cx="12" cy="6" rx="7" ry="3" fill={ink} opacity="0.6" />
        </>
      ) : topic === "software-design" ? (
        <>
          <rect x="4" y="3" width="16" height="6" rx="1.5" fill={ink} />
          <rect
            x="5"
            y="4"
            width="14"
            height="16"
            rx="1.5"
            fill="none"
            stroke={ink}
            strokeWidth="2"
          />
          <path d="M8 14h8" stroke={ink} strokeWidth="2" />
        </>
      ) : topic === "distributed-systems" ? (
        <g fill={ink} stroke={ink} strokeWidth="2">
          <path d="M7 7l10 0M7 7l5 10M17 7l-5 10" fill="none" />
          <circle cx="7" cy="7" r="3" />
          <circle cx="17" cy="7" r="3" />
          <circle cx="12" cy="17" r="3" />
        </g>
      ) : (
        <path
          d="M9 6l-6 6 6 6M15 6l6 6-6 6"
          fill="none"
          stroke={ink}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

// The web design's goal pictures (2026-11): a block, a database, a book, a stopwatch, in
// three tones of the goal's topic family. Wide screens only; decorative.
function GoalArt({ goal, topic }: { goal: Goal; topic: Topic }) {
  const c = (role: string) => `var(--${topic}-${role})`;
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 40 40"
      className="hidden size-[38px] lg:block"
    >
      {goal === "system-design-interviews" ? (
        <>
          <path d="M20 6 32 12 20 18 8 12z" fill={c("top")} />
          <path d="M8 12 20 18v14L8 26z" fill={c("left")} />
          <path d="M20 18 32 12v14L20 32z" fill={c("right")} />
        </>
      ) : goal === "stack-i-use" ? (
        <>
          <path d="M9 11v18a11 4 0 0 0 22 0V11z" fill={c("left")} />
          <ellipse cx="20" cy="11" rx="11" ry="4" fill={c("top")} />
        </>
      ) : goal === "finish-that-book" ? (
        <>
          <path d="M20 12c-4-3-9-3-13-1v18c4-2 9-2 13 1z" fill={c("top")} />
          <path d="M20 12c4-3 9-3 13-1v18c-4-2-9-2-13 1z" fill={c("left")} />
        </>
      ) : (
        <>
          <circle cx="20" cy="22" r="12" fill={c("top")} />
          <path d="M20 22V13a9 9 0 0 1 7.8 4.5z" fill={c("left")} />
          <rect x="17" y="5" width="6" height="4" rx="1.5" fill={c("right")} />
        </>
      )}
    </svg>
  );
}

// One choice as a full-width card. The whole card is the label; the real input stays
// focusable for keyboards and screen readers, so the card shows its focus ring.
function Option({
  input,
  title,
  detail,
  topic,
  art,
  note,
}: {
  input: InputHTMLAttributes<HTMLInputElement> & {
    type: "checkbox" | "radio";
    name: string;
    value: string;
  };
  title: string;
  detail?: string;
  topic?: Topic;
  // The wide screens' picture in place of the topic mark (goals).
  art?: ReactNode;
  note?: string | undefined;
}) {
  return (
    // Wide screens (web design, 2026-11): a pictured choice is a tile in a two-column grid,
    // its tick in the corner; the selected one is drawn with a heavier select edge.
    <label
      className={`group flex cursor-pointer items-center gap-3 rounded-2xl border border-hairline p-4 has-checked:border-select has-checked:bg-select/10 has-focus-visible:ring-2 has-focus-visible:ring-select has-disabled:cursor-not-allowed has-disabled:opacity-50 lg:has-checked:ring-1 lg:has-checked:ring-select ${topic === undefined ? "lg:py-[15px]" : "lg:relative lg:flex-col lg:items-start lg:rounded-[20px]"}`}
    >
      <input {...input} data-label={title} className="sr-only" />
      {topic === undefined ? null : (
        <span
          className="flex size-12 shrink-0 items-center justify-center rounded-xl lg:size-14 lg:rounded-[14px]"
          style={{ background: `var(--${topic}-tint)` }}
        >
          {art === undefined ? (
            <Glyph topic={topic} />
          ) : (
            <>
              <span className="flex lg:hidden">
                <Glyph topic={topic} />
              </span>
              {art}
            </>
          )}
        </span>
      )}
      <span
        className={`min-w-0 flex-1 ${topic === undefined ? "" : "lg:pr-8"}`}
      >
        <span className="block font-semibold lg:text-[17px]">{title}</span>
        {detail === undefined ? null : (
          <span className="block text-ink-muted lg:mt-[3px] lg:text-sm">
            {detail}
          </span>
        )}
      </span>
      {note === undefined ? null : (
        <span className="shrink-0 rounded-full bg-track px-2 py-0.5 text-xs font-semibold text-ink-muted">
          {note}
        </span>
      )}
      <span
        aria-hidden="true"
        className={`hidden size-6 shrink-0 items-center justify-center rounded-full bg-select text-page group-has-checked:flex ${topic === undefined ? "" : "lg:absolute lg:top-3.5 lg:right-3.5"}`}
      >
        <svg viewBox="0 0 24 24" className="size-4">
          <path
            d="M5 12.5l4.5 4.5L19 7.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </label>
  );
}

const OPTIONS = "flex flex-col gap-3 lg:gap-2";
// Pictured choices sit two to a row on wide screens (web design).
const TILES = "flex flex-col gap-3 lg:grid lg:grid-cols-2";

// Profile fills the groups in with the saved choices; onboarding starts them empty.
type Chosen = { current?: Preferences | undefined };

export function GoalChoices({ current }: Chosen) {
  return (
    <div className={TILES}>
      {GOALS.map((goal) => {
        const [title, detail, topic] = GOAL_TEXT[goal];
        const live = isLive(goal);
        return (
          <Option
            key={goal}
            input={{
              type: "checkbox",
              name: "goal",
              value: goal,
              disabled: !live,
              defaultChecked: live && current?.goals.includes(goal),
            }}
            title={title}
            detail={detail}
            topic={topic}
            art={<GoalArt goal={goal} topic={topic} />}
            note={live ? undefined : "Coming soon"}
          />
        );
      })}
    </div>
  );
}

// ADR-0049: only the offered topics (offeredTopics), plus any the user already chose,
// so saving Profile never drops an explicit choice (PER-1).
export function TopicChoices({
  current,
  offered,
}: Chosen & { offered: readonly Topic[] }) {
  return (
    <div className={TILES}>
      {TOPICS.filter(
        (t) => offered.includes(t) || current?.topics.includes(t) === true,
      ).map((topic) => (
        <Option
          key={topic}
          input={{
            type: "checkbox",
            name: "topic",
            value: topic,
            defaultChecked: current?.topics.includes(topic),
          }}
          title={TOPIC_NAMES[topic]}
          topic={topic}
        />
      ))}
    </div>
  );
}

export function LevelChoices({ current }: Chosen) {
  return (
    <div className={OPTIONS}>
      {LEVELS.map((level) => (
        <Option
          key={level}
          input={{
            type: "radio",
            name: "level",
            value: level,
            required: true,
            defaultChecked: current?.level === level,
          }}
          title={LEVEL_NAMES[level]}
        />
      ))}
    </div>
  );
}

export function BreakChoices({ current }: Chosen) {
  return (
    <div className={OPTIONS}>
      {BREAK_LENGTHS.map((minutes) => (
        <Option
          key={minutes}
          input={{
            type: "radio",
            name: "breakLength",
            value: minutes,
            required: true,
            defaultChecked: current?.breakLength === minutes,
          }}
          title={`${minutes.replace("-", "–")} min`}
        />
      ))}
    </div>
  );
}

function Group({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="mt-6">
      <legend className="mb-3 text-section">{legend}</legend>
      {children}
    </fieldset>
  );
}

// The explicit choices (PER-1) on one page, for Profile (P1-W4-S08), which fills them in;
// onboarding (C-21) asks the same groups one step at a time.
export function ChoicesFields({
  current,
  offered,
}: Chosen & { offered: readonly Topic[] }) {
  return (
    <>
      <Group legend="What should your breaks add up to?">
        <GoalChoices current={current} />
      </Group>
      <Group legend="Topics">
        <TopicChoices current={current} offered={offered} />
      </Group>
      <Group legend="Your level">
        <LevelChoices current={current} />
      </Group>
      <Group legend="A typical break">
        <BreakChoices current={current} />
      </Group>
    </>
  );
}
