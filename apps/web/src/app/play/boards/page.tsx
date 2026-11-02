import type { ReactNode } from "react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  boardName,
  type Game,
  GAMES,
  guestLabel,
  type Period,
  PERIODS,
  SCOPES,
} from "../../../server/boards";
import {
  follows,
  leaderboards,
  playerCountries,
  playerUniversities,
  sessionReader,
  usernames,
} from "../../../server/container";
import type {
  BoardScope,
  Standing,
  UniversityStanding,
} from "../../../server/ports";
import { Card } from "../../ui/Card";
import { requireUsername } from "../../username/gate";

export const dynamic = "force-dynamic";

type Scope = (typeof SCOPES)[number];

const TOP = 50;
const GAME_LABELS: Record<Game, string> = {
  daily: "Daily",
  sprint: "Sprint",
  estimation: "Estimation",
};
const SCOPE_LABELS: Record<Scope, string> = {
  global: "Global",
  country: "Country",
  university: "University",
  friends: "Friends",
  universities: "Universities",
};
const PERIOD_LABELS: Record<Game, Record<Period, string>> = {
  daily: { current: "Today", previous: "Yesterday" },
  sprint: { current: "This week", previous: "Last week" },
  estimation: { current: "This week", previous: "Last week" },
};
const UNITS: Record<Game, string> = {
  daily: "points",
  sprint: "correct answers",
  estimation: "points",
};
const UNITS_TEXT: Record<Game, string> = {
  daily: "Points in the day's challenge",
  sprint: "Correct answers over the week's sprints",
  estimation: "Points over the week's estimation rounds",
};
// ADR-0029: guests have no Profile, so no country, university or follows.
const GUEST_SCOPES: readonly Scope[] = ["global", "universities"];

const pick = <T extends string>(
  options: readonly T[],
  value: string | undefined,
): T => options.find((o) => o === value) ?? (options[0] as T);

// A row's place among everyone on the board, as the wireframe's pinned row shows it.
const percentile = (rank: number, size: number) =>
  size < 1
    ? ""
    : ` · top ${String(Math.min(100, Math.max(1, Math.ceil((rank / size) * 100))))}%`;

type Row = { id: string; name: string; score: string; rank: number };
type Pinned = Row & { note: string };

const pin = ([row]: Row[], size: number): Pinned | null =>
  row === undefined
    ? null
    : { ...row, note: `#${String(row.rank)}${percentile(row.rank, size)}` };

const NOT_YET = "You're not on this board yet: play to join it.";

// P3-W14-S06 (§6.7; owner, 2026-11-02; wireframe 15 `lead`): every board, the top 50 of
// the current or previous period, with the player's own row always in view.
export default async function BoardsPage(props: {
  searchParams: Promise<{ game?: string; scope?: string; period?: string }>;
}) {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  if (!actor.isGuest) await requireUsername(actor.userId, "/play/boards");
  const query = await props.searchParams;
  const game = pick(GAMES, query.game);
  const period = pick(PERIODS, query.period);
  const allowed = actor.isGuest ? GUEST_SCOPES : SCOPES;
  const scope = pick(allowed, query.scope);
  const board = boardName(game, period, new Date());
  const href = (change: { game?: Game; scope?: Scope; period?: Period }) =>
    `/play/boards?${new URLSearchParams({ game, scope, period, ...change }).toString()}`;

  const players = async (standings: Standing[]): Promise<Row[]> => {
    const labels = new Map(
      (await usernames().labels(standings.map((s) => s.userId))).map((l) => [
        l.userId,
        l,
      ]),
    );
    return standings.map((s) => {
      const label = labels.get(s.userId);
      return {
        id: s.userId,
        name:
          label?.username != null
            ? `@${label.username}`
            : label?.guest === true
              ? guestLabel(s.userId)
              : "Player",
        score: String(s.score),
        rank: s.rank,
      };
    });
  };
  // A university gone between the two reads is left out, not given a made-up name.
  const schools = async (standings: UniversityStanding[]): Promise<Row[]> => {
    const named = new Map(
      (
        await playerUniversities().names(standings.map((s) => s.universityId))
      ).map((u) => [u.id, u.name]),
    );
    return standings.flatMap((s) => {
      const name = named.get(s.universityId);
      return name === undefined
        ? []
        : [
            {
              id: s.universityId,
              name,
              score: s.score.toFixed(1).replace(/\.0$/, ""),
              rank: s.rank,
            },
          ];
    });
  };

  let body: ReactNode;
  if (scope === "universities") {
    const mine = actor.isGuest
      ? null
      : (await playerUniversities().get(actor.userId)).university;
    const [list, own, count] = await Promise.all([
      leaderboards().universities(board, TOP),
      mine === null
        ? Promise.resolve(null)
        : leaderboards().universityStanding(board, mine.id),
      leaderboards().universityCount(board),
    ]);
    body = (
      <Table
        rows={await schools(list)}
        mine={mine?.id ?? null}
        mark="Yours"
        unit={`Average ${UNITS[game]} of each university's players`}
        pinned={own === null ? null : pin(await schools([own]), count)}
        missing={
          actor.isGuest ? null : mine === null ? (
            <>
              <Link href="/profile" className="underline">
                Set your university on Profile
              </Link>{" "}
              to see where it stands.
            </>
          ) : (
            "Your university isn't on this board yet: its players haven't played."
          )
        }
      />
    );
  } else if (scope === "friends") {
    const followed = await follows().following(actor.userId);
    if (followed.length === 0)
      body = (
        <Empty>
          <Link href="/profile#friends" className="underline">
            Follow people on Profile
          </Link>{" "}
          to see them here.
        </Empty>
      );
    else {
      const all = await leaderboards().among(board, [
        actor.userId,
        ...followed.map((p) => p.userId),
      ]);
      const own = all.find((s) => s.userId === actor.userId);
      body = (
        <Table
          rows={await players(all.slice(0, TOP))}
          mine={actor.userId}
          mark="You"
          unit={UNITS_TEXT[game]}
          pinned={
            own === undefined ? null : pin(await players([own]), all.length)
          }
          missing={NOT_YET}
        />
      );
    }
  } else {
    let boardScope: BoardScope | undefined;
    let unset: string | null = null;
    if (scope === "country") {
      const { country } = await playerCountries().get(actor.userId);
      if (country === null) unset = "country";
      else boardScope = { country };
    } else if (scope === "university") {
      const { university } = await playerUniversities().get(actor.userId);
      if (university === null) unset = "university";
      else boardScope = { university: university.id };
    }
    if (unset !== null) {
      body = (
        <Empty>
          <Link href="/profile" className="underline">
            Set your {unset} on Profile
          </Link>{" "}
          to see its board.
        </Empty>
      );
    } else {
      const [list, own, total] = await Promise.all([
        leaderboards().top(board, TOP, boardScope),
        leaderboards().standing(board, actor.userId, boardScope),
        leaderboards().size(board, boardScope),
      ]);
      body = (
        <Table
          rows={await players(list)}
          mine={actor.userId}
          mark="You"
          unit={UNITS_TEXT[game]}
          pinned={own === null ? null : pin(await players([own]), total)}
          missing={NOT_YET}
        />
      );
    }
  }

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-5 px-4 pt-6 pb-24 lg:max-w-[52rem] lg:pt-10">
      <Link href="/play" className="text-sm text-ink-muted underline">
        Back to Play
      </Link>
      <h1 className="text-display">Boards</h1>
      {/* Wireframe 15: the filters are chips in one row. */}
      <nav
        aria-label="Filters"
        className="flex items-center gap-2 overflow-x-auto pb-1"
      >
        <Chips label="Game">
          {GAMES.map((g) => (
            <Chip key={g} href={href({ game: g })} on={g === game}>
              {GAME_LABELS[g]}
            </Chip>
          ))}
        </Chips>
        <Chips label="Board">
          {allowed.map((s) => (
            <Chip key={s} href={href({ scope: s })} on={s === scope}>
              {SCOPE_LABELS[s]}
            </Chip>
          ))}
        </Chips>
        <Chips label="When">
          {PERIODS.map((p) => (
            <Chip key={p} href={href({ period: p })} on={p === period}>
              {PERIOD_LABELS[game][p]}
            </Chip>
          ))}
        </Chips>
      </nav>
      <Card className="p-4">{body}</Card>
    </main>
  );
}

function Chips({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex shrink-0 gap-2 border-r border-hairline pr-2 last:border-r-0 last:pr-0"
    >
      {children}
    </div>
  );
}

function Chip({
  href,
  on,
  children,
}: {
  href: string;
  on: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold ${on ? "border-ink bg-ink text-page" : "border-hairline bg-page text-ink"}`}
    >
      {children}
    </Link>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-ink-muted">{children}</p>;
}

// The player's own row is pinned under the list and stays in view as it scrolls
// (wireframe 15), with its rank and percentile; it is also marked in the list.
function Table({
  rows,
  mine,
  mark,
  unit,
  pinned,
  missing,
}: {
  rows: Row[];
  mine: string | null;
  mark: string;
  unit: string;
  pinned: Pinned | null;
  missing: ReactNode;
}) {
  return (
    <>
      <p className="mb-2 text-sm text-ink-muted">{unit}</p>
      {rows.length === 0 ? (
        <Empty>Nobody on this board yet.</Empty>
      ) : (
        // Not <ol>: tied players share a rank, which the list's own numbers wouldn't.
        <ul className="flex flex-col">
          {rows.map((row) => (
            <li
              key={row.id}
              aria-current={row.id === mine ? "true" : undefined}
              className={`flex items-center gap-3 rounded-xl px-3 py-2 ${row.id === mine ? "bg-well font-semibold" : ""}`}
            >
              <span className="w-10 text-numbers text-ink-muted">
                #{row.rank}
              </span>
              <span className="flex-1 truncate">
                {row.name}
                {row.id === mine ? (
                  <span className="ml-2 text-sm text-go-text">{mark}</span>
                ) : null}
              </span>
              <span className="text-numbers">{row.score}</span>
            </li>
          ))}
        </ul>
      )}
      {pinned !== null ? (
        <p className="sticky bottom-4 mt-3 flex items-center gap-3 rounded-xl border border-hairline bg-well px-3 py-2 font-semibold shadow-card">
          <span className="flex-1 truncate">
            {pinned.name} <span className="text-sm text-go-text">{mark}</span>
          </span>
          <span className="text-numbers">{pinned.note}</span>
          <span className="text-numbers">{pinned.score}</span>
        </p>
      ) : missing === null ? null : (
        <p className="mt-3 text-ink-muted">{missing}</p>
      )}
    </>
  );
}
