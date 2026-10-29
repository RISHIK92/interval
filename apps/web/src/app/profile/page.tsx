import { cookies, headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  feedback,
  githubAccounts,
  githubApp,
  preferences,
  progress,
  sessionReader,
} from "../../server/container";
import type { GitHubConnection } from "../../server/ports";
import { parseTheme, THEME_COOKIE, THEMES } from "../../server/theme";
import { ChoicesFields, GOAL_TEXT, TOPIC_NAMES } from "../ChoicesFields";
import { setThemeAction } from "../theme/actions";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { STATE_WORDS } from "../learnerState";
import {
  disconnectGitHubAction,
  refreshGitHubAction,
  resetInferredAction,
  unhideSourceAction,
  updatePreferencesAction,
} from "./actions";

export const dynamic = "force-dynamic";

const THEME_LABELS = {
  light: "Light",
  dark: "Dark",
  system: "Device",
} as const;

// Fixed text per key: the query string picks which, never what it says.
const NOTICES: Record<string, string> = {
  choices: "Your choices are saved. Your feed updates in a moment.",
  reset: "Inferred interests reset.",
  unhidden: "Source shown again. Your feed updates in a moment.",
  github: "GitHub connected.",
  "github-refresh": "Reading your repositories again; this takes a minute.",
  "github-off":
    "GitHub disconnected; what Interval read from it is deleted. Uninstall Interval on GitHub to revoke its access.",
};
// P2-W12-S01: the GitHub callback's outcomes.
const GITHUB_PROBLEMS: Record<string, string> = {
  failed: "GitHub couldn't be connected. Try again.",
  none: "Install Interval on at least one repository, then connect again.",
  "refresh-failed":
    "Your repositories couldn't be read again just now. Try later.",
};
const MISSING: Record<string, string> = {
  goal: "Pick at least one goal.",
  topic: "Pick at least one topic.",
  level: "Pick a level.",
  break: "Pick a break length.",
};

// §5A ("view, edit, or reset anything inferred"), PER-1, Q-P1-36, P1-W4-S08.
export default async function ProfilePage(props: {
  searchParams: Promise<{ saved?: string; missing?: string; github?: string }>;
}) {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  const chosen = await preferences().get(actor.userId);
  if (chosen === null) redirect("/onboarding");
  const offered = githubApp() !== null;
  const [hidden, inferred, concepts, connection] = await Promise.all([
    feedback().hiddenSources(actor.userId),
    feedback().inferred(actor.userId),
    progress().concepts(actor.userId),
    offered && !actor.isGuest
      ? githubAccounts().get(actor.userId)
      : Promise.resolve(null),
  ]);
  const { saved, missing, github } = await props.searchParams;
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-4 pt-6 pb-24">
      <Link
        href="/"
        aria-label="Back to your feed"
        className="flex size-10 items-center justify-center rounded-full border border-hairline bg-page"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M15 5l-7 7 7 7" />
        </svg>
      </Link>
      <div className="flex items-center gap-4">
        <span
          aria-hidden="true"
          className="flex size-14 items-center justify-center rounded-full bg-well text-ink-muted"
        >
          <svg
            viewBox="0 0 24 24"
            className="size-7"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          >
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21a8 8 0 0 1 16 0" />
          </svg>
        </span>
        <h1 className="text-display">Profile</h1>
      </div>
      {saved !== undefined && Object.hasOwn(NOTICES, saved) ? (
        <Card className="px-5 py-3">
          <p role="status">{NOTICES[saved]}</p>
        </Card>
      ) : null}
      {github !== undefined && Object.hasOwn(GITHUB_PROBLEMS, github) ? (
        <Card className="px-5 py-3">
          <p role="alert" className="text-wrong">
            {GITHUB_PROBLEMS[github]}
          </p>
        </Card>
      ) : null}
      {missing !== undefined && Object.hasOwn(MISSING, missing) ? (
        <Card className="px-5 py-3">
          <p role="alert" className="text-wrong">
            {MISSING[missing]}
          </p>
        </Card>
      ) : null}

      <Card className="p-5">
        <section aria-label="Your goals">
          <h2 className="mb-3 text-section">Your goals</h2>
          <ul className="flex flex-col gap-2">
            {chosen.goals.map((goal) => (
              <li key={goal} className="rounded-2xl bg-well px-4 py-3">
                {GOAL_TEXT[goal][0]}
              </li>
            ))}
          </ul>
        </section>
      </Card>

      <Card className="p-5">
        <GitHubSection
          guest={actor.isGuest}
          offered={offered}
          connection={connection}
        />
      </Card>

      {/* This device's theme (owner, 2026-10-26). */}
      <Card className="p-5">
        <form action={setThemeAction} aria-label="Appearance">
          <input type="hidden" name="back" value="/profile" />
          <h2 className="text-section">Appearance</h2>
          <div className="mt-3 flex gap-1 rounded-2xl bg-well p-1">
            {THEMES.map((option) => (
              <button
                key={option}
                type="submit"
                name="theme"
                value={option}
                aria-pressed={option === theme}
                className={`flex-1 rounded-xl py-2 text-sm font-semibold ${option === theme ? "bg-lift shadow-card" : "text-ink-muted"}`}
              >
                {THEME_LABELS[option]}
              </button>
            ))}
          </div>
        </form>
      </Card>

      <Card className="p-5">
        <section>
          <h2 className="mb-3 text-section">Your choices</h2>
          <form
            action={updatePreferencesAction}
            className="flex flex-col gap-4"
          >
            <ChoicesFields current={chosen} />
            <Button type="submit">Save choices</Button>
          </form>
        </section>
      </Card>

      <Card>
        <section>
          <h2 className="px-5 pt-5 pb-3 text-section">Hidden sources</h2>
          {hidden.length === 0 ? (
            <p className="px-5 pb-5 text-ink-muted">No hidden sources.</p>
          ) : (
            <ul className="divide-y divide-hairline border-t border-hairline">
              {hidden.map((source) => (
                <li key={source.sourceId}>
                  <form
                    action={unhideSourceAction}
                    className="flex items-center justify-between gap-3 px-5 py-3"
                  >
                    <span className="font-semibold">{source.name}</span>
                    <input
                      type="hidden"
                      name="sourceId"
                      value={source.sourceId}
                    />
                    <Button
                      type="submit"
                      variant="secondary"
                      className="px-4 py-1.5 text-sm"
                    >
                      Show again
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>
      </Card>

      <Card className="p-5">
        <section className="flex flex-col gap-3">
          <h2 className="text-section">Inferred from your feedback</h2>
          <p className="text-ink-muted">
            These shape your feed alongside your choices, which always win.
          </p>
          <h3 className="font-semibold">More like these</h3>
          <TitleList items={inferred.more} />
          <h3 className="font-semibold">Less like these</h3>
          <TitleList items={inferred.less} />
          <h3 className="font-semibold">
            Topics pushed down by Not interested
          </h3>
          {inferred.avoidedConcepts.length === 0 ? (
            <p className="text-ink-muted">None.</p>
          ) : (
            <ul className="list-disc pl-5">
              {inferred.avoidedConcepts.map((concept) => (
                <li key={concept.slug}>{concept.name}</li>
              ))}
            </ul>
          )}
          <form action={resetInferredAction}>
            <Button type="submit" variant="secondary">
              Reset inferred interests
            </Button>
          </form>
        </section>
      </Card>

      <Card className="p-5">
        <section className="flex flex-col gap-3">
          <h2 className="text-section">Your concepts</h2>
          {concepts.length === 0 ? (
            <p className="text-ink-muted">
              Finish a section or an article, or take Test 60s, to start: the
              concepts it covers show up here.
            </p>
          ) : (
            concepts.map((group) => (
              <div key={group.topic}>
                <h3 className="font-semibold">{TOPIC_NAMES[group.topic]}</h3>
                <ul className="flex flex-col gap-1">
                  {group.concepts.map((concept) => (
                    <li
                      key={concept.slug}
                      className="flex items-center justify-between gap-3"
                    >
                      <span>{concept.name}</span>
                      <span className="text-sm text-ink-muted">
                        {STATE_WORDS[concept.state]}
                        {concept.due ? " · Due for review" : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </section>
      </Card>
    </main>
  );
}

function TitleList({ items }: { items: { itemId: string; title: string }[] }) {
  if (items.length === 0) return <p className="text-ink-muted">None.</p>;
  return (
    <ul className="list-disc pl-5">
      {items.map((item) => (
        <li key={item.itemId}>{item.title}</li>
      ))}
    </ul>
  );
}

// P2-W12-S01 (§5H, ADR-0024): GitHub, a data connection for accounts. Interval's App
// reads repository names and dependency files, never code; it's installed (and
// revoked) on GitHub, repository by repository.
function GitHubSection({
  guest,
  offered,
  connection,
}: {
  guest: boolean;
  offered: boolean;
  connection: GitHubConnection | null;
}) {
  const confirm = "disconnect-github";
  return (
    <section id="github" aria-label="GitHub" className="flex flex-col gap-3">
      <h2 className="text-section">GitHub</h2>
      {guest ? (
        <p className="text-ink-muted">Create an account to connect GitHub.</p>
      ) : !offered ? (
        <p className="text-ink-muted">
          Connecting GitHub isn&apos;t available yet.
        </p>
      ) : connection === null ? (
        <>
          <p className="text-ink-muted">
            Interval reads your repositories&apos; names and dependency files to
            pick what fits your stack, never your code. You choose the
            repositories on GitHub.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <a
              href="/api/github/connect"
              className="rounded-full bg-ink px-5 py-2.5 font-semibold text-page"
            >
              Connect GitHub
            </a>
            <a
              href="/api/github/connect?link=1"
              className="text-sm font-semibold text-select"
            >
              Already installed? Link it
            </a>
          </div>
        </>
      ) : (
        <>
          <p className="font-semibold">Connected as @{connection.login}</p>
          {connection.installations.length === 0 ? (
            <p className="text-sm text-ink-muted">
              Interval isn&apos;t installed on any repository you can reach.
            </p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {connection.installations.map((i) => (
                <li key={i.installationId}>
                  <span className="text-ink-muted">
                    {i.accountType === "User"
                      ? "On your account"
                      : `On ${i.accountLogin}`}
                  </span>{" "}
                  ·{" "}
                  <a
                    href={
                      i.accountType === "User"
                        ? `https://github.com/settings/installations/${i.installationId}`
                        : `https://github.com/organizations/${i.accountLogin}/settings/installations/${i.installationId}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-select"
                  >
                    Choose repositories
                  </a>
                </li>
              ))}
            </ul>
          )}
          <Repositories connection={connection} />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              popoverTarget={confirm}
              className="cursor-pointer rounded-full border border-hairline px-4 py-2 text-sm font-semibold"
            >
              Disconnect
            </button>
          </div>
          <div
            id={confirm}
            popover="auto"
            role="alertdialog"
            aria-labelledby={`${confirm}-title`}
            className="m-auto w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-hairline bg-page p-5 text-ink shadow-card backdrop:bg-black/40"
          >
            <p id={`${confirm}-title`} className="font-semibold">
              Disconnect GitHub?
            </p>
            <p className="mt-1 text-sm text-ink-muted">
              What Interval read from your repositories is deleted. To revoke
              its access too,{" "}
              <a
                href="https://github.com/settings/installations"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-select"
              >
                uninstall Interval on GitHub
              </a>
              .
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <form action={disconnectGitHubAction}>
                <button
                  type="submit"
                  className="w-full cursor-pointer rounded-full border border-wrong px-5 py-3 font-semibold"
                >
                  Disconnect GitHub
                </button>
              </form>
              <button
                type="button"
                autoFocus
                popoverTarget={confirm}
                popoverTargetAction="hide"
                className="w-full cursor-pointer rounded-full bg-ink px-5 py-3 font-semibold text-page"
              >
                Keep it
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

// P2-W12-S02: what the worker last read from the user's repositories.
function Repositories({ connection }: { connection: GitHubConnection }) {
  if (connection.syncedMinutesAgo === null)
    return (
      <p role="status" className="text-sm text-ink-muted">
        Reading your repositories…
      </p>
    );
  const minutes = Math.max(1, connection.syncedMinutesAgo);
  const ago =
    minutes < 60
      ? `${String(minutes)} min ago`
      : minutes < 48 * 60
        ? `${String(Math.round(minutes / 60))} h ago`
        : `${String(Math.round(minutes / 1440))} days ago`;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">Your repositories</h3>
      {connection.repositories.length === 0 ? (
        <p className="text-sm text-ink-muted">No repositories to read yet.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {connection.repositories.map((r) => (
            <li key={r.fullName}>
              <span className="font-semibold">{r.fullName}</span>
              <span className="text-ink-muted">
                {" "}
                · {r.languages.slice(0, 3).join(", ")}
                {r.languages.length > 0 ? " · " : ""}
                {r.dependencies} dependencies
              </span>
              {r.technologies.length === 0 ? null : (
                <span className="block text-ink-muted">
                  Uses {r.technologies.join(", ")}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <form action={refreshGitHubAction} className="flex items-center gap-3">
        <span className="text-xs text-ink-muted">Read {ago}</span>
        <button
          type="submit"
          className="cursor-pointer text-sm font-semibold text-select"
        >
          Refresh
        </button>
      </form>
    </div>
  );
}
