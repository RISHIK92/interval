import type { ReactNode } from "react";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { pushEnv } from "../../env";
import {
  agentHook,
  entitlements,
  feedback,
  feedReader,
  follows,
  githubAccounts,
  githubApp,
  leagues,
  playerCountries,
  playerUniversities,
  preferences,
  progress,
  pushSettings,
  sessionReader,
  usernames,
} from "../../server/container";
import type { LearnerState } from "@interval/db";
import type { GitHubConnection, Person, University } from "../../server/ports";
import { offeredTopics } from "../../server/preferences";
import { parseTheme, THEME_COOKIE, THEMES } from "../../server/theme";
import { countriesByName, countryName } from "../../server/countries";
import { TIER_NAMES } from "../../server/leagues";
import { ChoicesFields, GOAL_TEXT, TOPIC_NAMES } from "../ChoicesFields";
import { signOutAction } from "../actions";
import { TabBar } from "../TabBar";
import { setThemeAction } from "../theme/actions";
import { requireUsername } from "../username/gate";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { AgentHookCard } from "./AgentHookCard";
import { NotificationsCard } from "./NotificationsCard";
import { FIELD } from "../ui/field";
import { STATE_WORDS } from "../learnerState";
import {
  disconnectGitHubAction,
  refreshGitHubAction,
  chooseUniversityAction,
  followAction,
  removeCountryAction,
  removeUniversityAction,
  resetInferredAction,
  searchableAction,
  setCountryAction,
  typeUniversityAction,
  unfollowAction,
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
  country: "Country saved. Country boards update in a moment.",
  "country-removed": "Country removed.",
  university: "University saved. University boards update in a moment.",
  "university-removed": "University removed.",
  followed: "Following.",
  unfollowed: "Unfollowed.",
  "search-on": "People can find you in search again.",
  "search-off":
    "You're hidden from people search. Anyone with your exact username can still follow you.",
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
  // ADR-0049: a topic that isn't offered, from a stale or forged form.
  "topic-unavailable": "That topic isn't available yet.",
};

// §5A ("view, edit, or reset anything inferred"), PER-1, Q-P1-36, P1-W4-S08.
export default async function ProfilePage(props: {
  searchParams: Promise<{
    saved?: string;
    missing?: string;
    github?: string;
    country?: string;
    university?: string;
    uq?: string;
    pq?: string;
    friend?: string;
  }>;
}) {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  // ADR-0029: guests play, and only play; the rest is for accounts.
  if (actor.isGuest) redirect("/sign-up");
  const chosen = await preferences().get(actor.userId);
  if (chosen === null) redirect("/onboarding");
  const me = await requireUsername(actor.userId, "/profile");
  const offered = githubApp() !== null;
  const {
    saved,
    missing,
    github,
    country: countryProblem,
    university: universityProblem,
    uq,
    pq,
    friend,
  } = await props.searchParams;
  // Usernames are 20 characters at most.
  const people = (pq ?? "").trim().toLowerCase().slice(0, 20);
  const [
    hidden,
    inferred,
    concepts,
    connection,
    country,
    university,
    followingList,
    followerList,
    found,
    devices,
    hookGranted,
    pushGranted,
    savedPush,
    topics,
  ] = await Promise.all([
    feedback().hiddenSources(actor.userId),
    feedback().inferred(actor.userId),
    progress().concepts(actor.userId),
    offered ? githubAccounts().get(actor.userId) : Promise.resolve(null),
    playerCountries().get(actor.userId),
    playerUniversities().get(actor.userId),
    follows().following(actor.userId),
    follows().followers(actor.userId),
    // One more than shown, as the player may be among them.
    people.length >= 2 ? usernames().search(people, 21) : Promise.resolve(null),
    agentHook().devices(actor.userId),
    // ADR-0036 (OPS-3): each shows only on a plan that has it.
    entitlements().can(actor.userId, "agent.hook"),
    entitlements().can(actor.userId, "push.notify"),
    pushSettings().get(actor.userId),
    offeredTopics(feedReader()),
  ]);
  // ADR-0045 (Profile, web): the header's league, on a plan with leagues.
  const league = (await entitlements().can(actor.userId, "play.league"))
    ? await leagues().tier(actor.userId)
    : null;
  // ADR-0036: the push settings only on a plan with push.notify.
  const pushSettingsNow = pushGranted ? savedPush : null;
  const query = (uq ?? "").trim();
  // Searched only when a change is open, and on two letters or more.
  const matches =
    university.changeableFrom === null && query.length >= 2
      ? await playerUniversities().search(query, 20)
      : null;
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    // Wide screens (web design, 2026-11): the sidebar, a header with the avatar, then two
    // columns: what Interval knows (goals, concepts, choices) and the settings. Phones keep
    // one column in the markup's order, which wide screens rearrange only with `lg:` classes.
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-4 pt-6 pb-24 lg:mx-0 lg:grid lg:max-w-none lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start lg:gap-x-5 lg:gap-y-[22px] lg:pt-7 lg:pr-8 lg:pb-12 lg:pl-[14.5rem]">
      {/* Phones reach Profile from a header and leave by Back; wide screens keep the sidebar. */}
      <div className="hidden lg:block">
        <TabBar current="profile" firstName={chosen.firstName ?? null} />
      </div>
      <Link
        href="/"
        aria-label="Back to your feed"
        className="flex size-10 items-center justify-center rounded-full border border-hairline bg-page lg:hidden"
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
      <div className="flex items-center gap-4 lg:col-span-2">
        <span
          aria-hidden="true"
          className="hidden size-[72px] shrink-0 items-center justify-center rounded-full bg-(--distributed-systems-tint) text-2xl font-bold text-(--distributed-systems-line) lg:flex"
        >
          {(chosen.firstName ?? me.username).charAt(0).toUpperCase()}
        </span>
        <span
          aria-hidden="true"
          className="flex size-14 items-center justify-center rounded-full bg-well text-ink-muted lg:hidden"
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
        <div className="flex flex-col gap-0.5">
          <h1 className="text-display lg:text-[34px] lg:leading-[1.1] lg:tracking-[-0.03em]">
            Profile
          </h1>
          <p className="hidden text-[15px] text-ink-muted lg:block">
            @{me.username}
            {league === null ? null : ` · ${TIER_NAMES[league]} league`}
          </p>
        </div>
      </div>
      {saved !== undefined && Object.hasOwn(NOTICES, saved) ? (
        <Card className="px-5 py-3 lg:col-span-2">
          <p role="status">{NOTICES[saved]}</p>
        </Card>
      ) : null}
      {github !== undefined && Object.hasOwn(GITHUB_PROBLEMS, github) ? (
        <Card className="px-5 py-3 lg:col-span-2">
          <p role="alert" className="text-wrong">
            {GITHUB_PROBLEMS[github]}
          </p>
        </Card>
      ) : null}
      {missing !== undefined && Object.hasOwn(MISSING, missing) ? (
        <Card className="px-5 py-3 lg:col-span-2">
          <p role="alert" className="text-wrong">
            {MISSING[missing]}
          </p>
        </Card>
      ) : null}

      <Card className="p-5 lg:col-start-1 lg:overflow-hidden lg:p-0">
        <GoalArt />
        <div className="lg:px-5 lg:pt-4 lg:pb-[18px]">
          <section aria-label="Your goals">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-section lg:text-[13px] lg:font-medium lg:text-ink-muted">
                Your goals
              </h2>
              <a
                href="#choices"
                className="hidden text-[13px] font-semibold text-ink-soft underline underline-offset-[3px] lg:inline"
              >
                Change goal
              </a>
            </div>
            <ul className="flex flex-col gap-2">
              {chosen.goals.map((goal) => (
                <li
                  key={goal}
                  className="rounded-2xl bg-well px-4 py-3 lg:rounded-none lg:bg-transparent lg:p-0 lg:text-2xl lg:leading-tight lg:font-bold lg:tracking-[-0.02em]"
                >
                  {GOAL_TEXT[goal][0]}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </Card>
      <section
        aria-labelledby="settings"
        className="flex flex-col gap-6 lg:col-start-2 lg:row-span-2 lg:gap-0"
      >
        <h2
          id="settings"
          className="hidden text-[17px] font-semibold tracking-[-0.01em] lg:mb-1.5 lg:block"
        >
          Settings
        </h2>
        <Setting icon="github">
          <GitHubSection offered={offered} connection={connection} />
        </Setting>
        <Setting icon="country">
          <CountrySection
            country={country.country}
            changeableFrom={country.changeableFrom}
            refused={countryProblem === "soon"}
          />
        </Setting>
        <Setting icon="friends" className="lg:order-last">
          <FriendsSection
            me={me}
            userId={actor.userId}
            query={pq ?? ""}
            found={found}
            following={followingList}
            followers={followerList}
            problem={friend}
          />
        </Setting>
        <Setting icon="university">
          <UniversitySection
            university={university.university}
            changeableFrom={university.changeableFrom}
            problem={universityProblem}
            query={uq ?? ""}
            matches={matches}
          />
        </Setting>
        {/* ADR-0036: kept for a downgraded user's devices, so they can revoke them. */}
        {hookGranted || devices.length > 0 ? (
          <Setting icon="agent">
            <AgentHookCard canAdd={hookGranted} devices={devices} />
          </Setting>
        ) : null}
        {/* P4-W24-S01 (Q-P4-13, ADR-0036): opt-in pushes, on a plan with push.notify. */}
        {pushSettingsNow === null ? null : (
          <Setting icon="notifications">
            <NotificationsCard
              initial={pushSettingsNow}
              pushKey={pushEnv()?.VAPID_PUBLIC_KEY ?? null}
            />
          </Setting>
        )}
        {/* This device's theme (owner, 2026-10-26). */}
        <Setting icon="appearance">
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
        </Setting>
        {/* Home's sign-out, here too on wide screens, as the web design has it. */}
        <form
          action={signOutAction}
          className="mt-3 hidden lg:order-last lg:block"
        >
          <button
            type="submit"
            className="h-10 cursor-pointer rounded-full px-3.5 text-sm font-semibold text-ink-soft"
          >
            Sign out
          </button>
        </form>
      </section>
      {/* Wide screens show these in the left column under the goals, concepts first. */}
      <div className="flex flex-col gap-6 lg:col-start-1 lg:-mt-1.5 lg:gap-4">
        <Card className="p-5 lg:order-2">
          <section id="choices" className="scroll-mt-6">
            <h2 className="mb-3 text-section lg:text-[17px]">Your choices</h2>
            <form
              action={updatePreferencesAction}
              className="flex flex-col gap-4"
            >
              <ChoicesFields current={chosen} offered={topics} />
              <Button type="submit">Save choices</Button>
            </form>
          </section>
        </Card>
        <Card className="lg:order-4">
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
        <Card className="p-5 lg:order-3">
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
        <Card className="p-5 lg:order-1">
          <section className="flex flex-col gap-3">
            <h2 className="text-section lg:text-[17px]">Your concepts</h2>
            {concepts.length === 0 ? (
              <p className="text-ink-muted">
                Complete an article, or take Test 60s, to start: the concepts it
                covers show up here.
              </p>
            ) : (
              concepts.map((group) => (
                <div key={group.topic}>
                  <h3 className="font-semibold lg:mb-1 lg:text-[13px] lg:font-medium lg:text-ink-muted">
                    {TOPIC_NAMES[group.topic]}
                  </h3>
                  <ul className="flex flex-col gap-1 lg:gap-0">
                    {group.concepts.map((concept) => (
                      <li
                        key={concept.slug}
                        className="flex items-center justify-between gap-3 lg:min-h-11 lg:border-t lg:border-hairline"
                      >
                        <StateDot state={concept.state} />
                        <span className="lg:flex-1 lg:text-[15px] lg:font-medium">
                          {concept.name}
                        </span>
                        <span
                          className={`text-sm text-ink-muted lg:text-[13px] lg:font-semibold ${concept.state === "mastered" ? "lg:text-go-text" : ""}`}
                        >
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
      </div>
    </main>
  );
}

// One setting on wide screens: a hairline row with its mark beside the section, as in the
// web design; a card on phones.
const SETTING_ICONS = {
  agent: {
    tint: "bg-live/10 text-live",
    path: <path d="M3 4h18v12H3zM8 20h8M12 16v4" />,
  },
  notifications: {
    tint: "bg-(--distributed-systems-tint) text-(--distributed-systems-line)",
    path: (
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0" />
    ),
  },
  github: {
    tint: "bg-(--databases-tint) text-(--databases-line)",
    path: (
      <>
        <circle cx="6" cy="6" r="2" />
        <circle cx="6" cy="18" r="2" />
        <circle cx="18" cy="8" r="2" />
        <path d="M6 8v8M18 10c0 4-6 3-10 6" />
      </>
    ),
  },
  appearance: {
    tint: "bg-well text-ink-soft",
    path: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </>
    ),
  },
  country: {
    tint: "bg-(--system-design-tint) text-(--system-design-line)",
    path: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
      </>
    ),
  },
  university: {
    tint: "bg-(--review-tint) text-(--review-line)",
    path: <path d="M2 9l10-5 10 5-10 5zM6 11v5c3 2 9 2 12 0v-5M22 9v6" />,
  },
  friends: {
    tint: "bg-(--distributed-systems-tint) text-(--distributed-systems-line)",
    path: (
      <>
        <circle cx="9" cy="8" r="3.5" />
        <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5" />
      </>
    ),
  },
};

function Setting({
  icon,
  className = "",
  children,
}: {
  icon: keyof typeof SETTING_ICONS;
  className?: string;
  children: ReactNode;
}) {
  const mark = SETTING_ICONS[icon];
  return (
    <Card
      className={`${className} p-5 lg:flex lg:gap-3 lg:rounded-none lg:border-x-0 lg:border-t-0 lg:bg-transparent lg:px-0 lg:py-4 lg:shadow-none lg:[&_h2]:text-[15px] lg:[&_h2]:font-semibold`}
    >
      <span
        aria-hidden="true"
        className={`hidden size-[38px] shrink-0 items-center justify-center rounded-xl lg:flex ${mark.tint}`}
      >
        <svg
          viewBox="0 0 24 24"
          className="size-[18px]"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {mark.path}
        </svg>
      </span>
      <div className="min-w-0 lg:flex-1">{children}</div>
    </Card>
  );
}

// A concept's learner state as the web design's skill dot (§3.1): a tick once mastered,
// a select ring while practiced, an empty ring when only explored. The words stay beside it.
function StateDot({ state }: { state: LearnerState }) {
  const look =
    state === "mastered"
      ? "bg-go text-page"
      : state === "practiced"
        ? "border-2 border-select bg-select/10"
        : "border-[1.5px] border-hairline-strong";
  return (
    <span
      aria-hidden="true"
      className={`hidden size-6 shrink-0 items-center justify-center rounded-full lg:flex ${look}`}
    >
      {state === "mastered" ? (
        <svg
          viewBox="0 0 24 24"
          className="size-3"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m5 12.5 4.5 4.5L19 7.5" />
        </svg>
      ) : null}
    </span>
  );
}

// The goal card's picture band on wide screens (web design): blocks and a database in
// the system design family. Decorative.
function GoalArt() {
  const c = (role: string) => `var(--system-design-${role})`;
  return (
    <div
      aria-hidden="true"
      className="hidden h-[110px] items-center justify-center bg-(--system-design-tint) lg:flex"
    >
      <svg viewBox="0 0 352 96" className="h-24 w-[352px]">
        <path
          d="M118 50 158 40M210 40 248 52"
          fill="none"
          stroke={c("line")}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="2 8"
        />
        <path d="M90 20 118 34 90 48 62 34z" fill={c("top")} />
        <path d="M62 34 90 48v28L62 62z" fill={c("left")} />
        <path d="M90 48 118 34v28L90 76z" fill={c("right")} />
        <path d="M184 14 208 26 184 38 160 26z" fill={c("top")} />
        <path d="M160 26 184 38v24L160 50z" fill={c("left")} />
        <path d="M184 38 208 26v24L184 62z" fill={c("right")} />
        <path d="M250 34v32a30 10 0 0 0 60 0V34z" fill={c("left")} />
        <path
          d="M250 50a30 10 0 0 0 60 0"
          fill="none"
          stroke={c("right")}
          strokeWidth="3"
        />
        <ellipse cx="280" cy="34" rx="30" ry="10" fill={c("top")} />
      </svg>
    </div>
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
  offered,
  connection,
}: {
  offered: boolean;
  connection: GitHubConnection | null;
}) {
  const confirm = "disconnect-github";
  return (
    <section id="github" aria-label="GitHub" className="flex flex-col gap-3">
      <h2 className="text-section">GitHub</h2>
      {!offered ? (
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

// P3-W14-S02 (§6.7, Q-P3-08; owner, 2026-11-02): optional, for country boards; set or
// changed once a month, removed at any time.
function CountrySection({
  country,
  changeableFrom,
  refused,
}: {
  country: string | null;
  changeableFrom: Date | null;
  refused: boolean;
}) {
  const locked = changeableFrom !== null;
  return (
    <section aria-label="Country">
      <h2 className="text-section">Country</h2>
      <p className="mt-1 text-ink-muted">
        Optional. It puts you on your country&apos;s boards on Play.
      </p>
      {refused ? (
        <p role="alert" className="mt-2 text-wrong">
          A country can be changed once a month.
        </p>
      ) : null}
      <form action={setCountryAction} className="mt-3 flex flex-col gap-3">
        <label className="sr-only" htmlFor="country">
          Country
        </label>
        <select
          id="country"
          name="country"
          defaultValue={country ?? ""}
          disabled={locked}
          required
          aria-describedby={locked ? "country-opens" : undefined}
          className={FIELD}
        >
          <option value="" disabled>
            Not set
          </option>
          {countriesByName().map(({ code, name }) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
        {locked ? (
          <Opens id="country-opens" from={changeableFrom} />
        ) : (
          <Button type="submit">Save country</Button>
        )}
      </form>
      {country === null ? null : (
        <form action={removeCountryAction} className="mt-3">
          <Button type="submit" variant="secondary">
            Remove country
          </Button>
        </form>
      )}
    </section>
  );
}

function Opens({ id, from }: { id?: string; from: Date }) {
  return (
    <p id={id} className="text-ink-muted">
      You can change it again from{" "}
      {/* The first whole (UTC) day it's open: it opens at the hour it last changed. */}
      {new Date(from.getTime() + 86_400_000).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      })}
      .
    </p>
  );
}

const UNIVERSITY_PROBLEMS: Record<string, string> = {
  soon: "A university can be changed once a month.",
  name: "A university's name is 2 to 120 letters, without hidden characters.",
};

function UniversityName({ university }: { university: University }) {
  return (
    <>
      <span className="font-semibold">{university.name}</span>
      <span className="block text-sm text-ink-muted">
        {university.country === null
          ? "Added by players"
          : countryName(university.country)}
      </span>
    </>
  );
}

// P3-W14-S03 (§6.7, ADR-0032; owner, 2026-11-02): optional, for university boards;
// picked from the list or typed, unverified; changed once a month, removed any time.
function UniversitySection({
  university,
  changeableFrom,
  problem,
  query,
  matches,
}: {
  university: University | null;
  changeableFrom: Date | null;
  problem: string | undefined;
  query: string;
  matches: University[] | null;
}) {
  return (
    <section aria-label="University">
      <h2 className="text-section">University</h2>
      <p className="mt-1 text-ink-muted">
        Optional. It puts you on your university&apos;s board on Play.
      </p>
      {problem !== undefined && Object.hasOwn(UNIVERSITY_PROBLEMS, problem) ? (
        <p role="alert" className="mt-2 text-wrong">
          {UNIVERSITY_PROBLEMS[problem]}
        </p>
      ) : null}
      {university === null ? null : (
        <div className="mt-3 rounded-2xl bg-well px-4 py-3">
          <UniversityName university={university} />
        </div>
      )}
      {changeableFrom !== null ? (
        <div className="mt-3">
          <Opens from={changeableFrom} />
        </div>
      ) : (
        <>
          <form
            action="/profile"
            method="get"
            role="search"
            className="mt-3 flex gap-2"
          >
            <label className="sr-only" htmlFor="uq">
              Find your university
            </label>
            <input
              id="uq"
              name="uq"
              type="search"
              defaultValue={query}
              placeholder="Find your university"
              minLength={2}
              className={FIELD}
            />
            <Button type="submit" variant="secondary">
              Search
            </Button>
          </form>
          {matches === null ? null : matches.length === 0 ? (
            <p className="mt-3 text-ink-muted">
              No university matches. You can type its name below.
            </p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {matches.map((match) => (
                <li
                  key={match.id}
                  className="flex items-center justify-between gap-3 rounded-2xl bg-well px-4 py-3"
                >
                  <div>
                    <UniversityName university={match} />
                  </div>
                  <form action={chooseUniversityAction}>
                    <input type="hidden" name="universityId" value={match.id} />
                    <Button
                      type="submit"
                      variant="secondary"
                      aria-label={`Choose ${match.name}`}
                    >
                      Choose
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <form
            action={typeUniversityAction}
            className="mt-3 flex flex-col gap-3"
          >
            <label htmlFor="university-name" className="text-ink-muted">
              Not listed? Type its name
            </label>
            <input
              id="university-name"
              name="name"
              required
              minLength={2}
              maxLength={120}
              className={FIELD}
            />
            <Button type="submit">Use this name</Button>
          </form>
        </>
      )}
      {university === null ? null : (
        <form action={removeUniversityAction} className="mt-3">
          <Button type="submit" variant="secondary">
            Remove university
          </Button>
        </form>
      )}
    </section>
  );
}

const FRIEND_PROBLEMS: Record<string, string> = {
  nobody: "Nobody has that username.",
  self: "That's you.",
};

function FollowButton({ person, back }: { person: Person; back?: boolean }) {
  return (
    <form action={followAction}>
      <input type="hidden" name="userId" value={person.userId} />
      <Button
        type="submit"
        variant="secondary"
        aria-label={
          back === true
            ? `Follow back @${person.username}`
            : `Follow @${person.username}`
        }
      >
        {back === true ? "Follow back" : "Follow"}
      </Button>
    </form>
  );
}

function UnfollowButton({ person }: { person: Person }) {
  return (
    <form action={unfollowAction}>
      <input type="hidden" name="userId" value={person.userId} />
      <Button
        type="submit"
        variant="secondary"
        aria-label={`Unfollow @${person.username}`}
      >
        Unfollow
      </Button>
    </form>
  );
}

function PersonRow({
  person,
  children,
}: {
  person: Person;
  children: ReactNode;
}) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-2xl bg-well px-4 py-2">
      <span className="font-semibold">@{person.username}</span>
      {children}
    </li>
  );
}

// P3-W14-S05 (§6.7, Q-P3-11; owner, 2026-11-02): one-way follows by username, no accept
// step; the people you follow make your friends board on Play (S06). Followers are
// listed in full (owner, 2026-11-02; not capped).
function FriendsSection({
  me,
  userId,
  query,
  found,
  following,
  followers,
  problem,
}: {
  me: { username: string; searchable: boolean };
  userId: string;
  query: string;
  found: Person[] | null;
  following: Person[];
  followers: Person[];
  problem: string | undefined;
}) {
  const followed = new Set(following.map((p) => p.userId));
  const others = found?.filter((p) => p.userId !== userId).slice(0, 20) ?? null;
  return (
    <section id="friends" aria-label="Friends" className="flex flex-col gap-3">
      <h2 className="text-section">Friends</h2>
      <p className="text-ink-muted">
        You&apos;re{" "}
        <span className="font-semibold text-ink">@{me.username}</span>. Follow
        people by their username; they aren&apos;t asked first.
      </p>
      {problem !== undefined && Object.hasOwn(FRIEND_PROBLEMS, problem) ? (
        <p role="alert" className="text-wrong">
          {FRIEND_PROBLEMS[problem]}
        </p>
      ) : null}
      <form action={searchableAction}>
        <input
          type="hidden"
          name="searchable"
          value={me.searchable ? "off" : "on"}
        />
        <Button type="submit" variant="secondary">
          {me.searchable
            ? "Hide me from people search"
            : "Show me in people search"}
        </Button>
      </form>
      <form
        action="/profile#friends"
        method="get"
        role="search"
        className="flex gap-2"
      >
        <label className="sr-only" htmlFor="pq">
          Find people by username
        </label>
        <input
          id="pq"
          name="pq"
          type="search"
          defaultValue={query}
          placeholder="Find people by username"
          minLength={2}
          autoCapitalize="none"
          className={FIELD}
        />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      {others === null ? null : others.length === 0 ? (
        <p className="text-ink-muted">Nobody by that name in search.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {others.map((person) => (
            <PersonRow key={person.userId} person={person}>
              {followed.has(person.userId) ? (
                <UnfollowButton person={person} />
              ) : (
                <FollowButton person={person} />
              )}
            </PersonRow>
          ))}
        </ul>
      )}
      <form action={followAction} className="flex gap-2">
        <label className="sr-only" htmlFor="follow-username">
          Follow by exact username
        </label>
        <input
          id="follow-username"
          name="username"
          required
          placeholder="Follow by exact username"
          autoCapitalize="none"
          className={FIELD}
        />
        <Button type="submit">Follow</Button>
      </form>
      <h3 className="font-semibold">Following</h3>
      {following.length === 0 ? (
        <p className="text-ink-muted">You don&apos;t follow anyone yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {following.map((person) => (
            <PersonRow key={person.userId} person={person}>
              <UnfollowButton person={person} />
            </PersonRow>
          ))}
        </ul>
      )}
      <h3 className="font-semibold">Followers</h3>
      {followers.length === 0 ? (
        <p className="text-ink-muted">Nobody follows you yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {followers.map((person) => (
            <PersonRow key={person.userId} person={person}>
              {followed.has(person.userId) ? null : (
                <FollowButton person={person} back />
              )}
            </PersonRow>
          ))}
        </ul>
      )}
    </section>
  );
}
