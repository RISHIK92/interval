import {
  boardName,
  type Game,
  GAMES,
  guestLabel,
  type Period,
  PERIODS,
  SCOPES,
} from "./boards";
import {
  follows,
  leaderboards,
  playerCountries,
  playerUniversities,
  usernames,
} from "./container";
import type { Actor, BoardScope, Standing, UniversityStanding } from "./ports";

// P3-W14-S06 (§6.7; owner, 2026-11-02; wireframe 15 `lead`): what a board shows, for the
// web's boards page and the app's (P4-W21-S03): the top 50 of the current or previous
// period, with the player's own row always in view.
export type Scope = (typeof SCOPES)[number];

const TOP = 50;
export const GAME_LABELS: Record<Game, string> = {
  daily: "Daily",
  sprint: "Sprint",
  estimation: "Estimation",
  season: "Season",
};
export const SCOPE_LABELS: Record<Scope, string> = {
  global: "Global",
  country: "Country",
  university: "University",
  friends: "Friends",
  universities: "Universities",
};
export const PERIOD_LABELS: Record<Game, Record<Period, string>> = {
  daily: { current: "Today", previous: "Yesterday" },
  sprint: { current: "This week", previous: "Last week" },
  estimation: { current: "This week", previous: "Last week" },
  season: { current: "This season", previous: "Last season" },
};
const UNITS: Record<Game, string> = {
  daily: "points",
  sprint: "correct answers",
  estimation: "points",
  season: "rating",
};
const UNITS_TEXT: Record<Game, string> = {
  daily: "Points in the day's challenge",
  sprint: "Correct answers over the week's sprints",
  estimation: "Points over the week's estimation rounds",
  season: "Quick-game rating, for anyone with a rated live match this month",
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

export type Row = { id: string; name: string; score: string; rank: number };
export type Pinned = Row & { note: string };

const pin = ([row]: Row[], size: number): Pinned | null =>
  row === undefined
    ? null
    : { ...row, note: `#${String(row.rank)}${percentile(row.rank, size)}` };

// Why the player's own row isn't pinned: not on the board yet, no university set (a
// link to Profile on the web), or their university's players haven't played.
export type Missing = "not_yet" | "set_university" | "university_absent" | null;

export type BoardView = {
  game: Game;
  scope: Scope;
  period: Period;
  scopes: readonly Scope[];
  body:
    | {
        kind: "rows";
        rows: Row[];
        mine: string | null;
        mark: "You" | "Yours";
        unit: string;
        pinned: Pinned | null;
        missing: Missing;
      }
    // Set on Profile first.
    | { kind: "unset"; what: "country" | "university" | "follows" };
};

export async function readBoard(
  actor: Actor,
  query: {
    game?: string | undefined;
    scope?: string | undefined;
    period?: string | undefined;
  },
  now: Date,
): Promise<BoardView> {
  const game = pick(GAMES, query.game);
  const period = pick(PERIODS, query.period);
  const scopes = actor.isGuest ? GUEST_SCOPES : SCOPES;
  const scope = pick(scopes, query.scope);
  const board = boardName(game, period, now);
  const view = (body: BoardView["body"]): BoardView => ({
    game,
    scope,
    period,
    scopes,
    body,
  });

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
        // A rating is a decimal; every other board's score is whole already.
        score: String(Math.round(s.score)),
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
    return view({
      kind: "rows",
      rows: await schools(list),
      mine: mine?.id ?? null,
      mark: "Yours",
      unit: `Average ${UNITS[game]} of each university's players`,
      pinned: own === null ? null : pin(await schools([own]), count),
      missing: actor.isGuest
        ? null
        : mine === null
          ? "set_university"
          : "university_absent",
    });
  }
  if (scope === "friends") {
    const followed = await follows().following(actor.userId);
    if (followed.length === 0) return view({ kind: "unset", what: "follows" });
    const all = await leaderboards().among(board, [
      actor.userId,
      ...followed.map((p) => p.userId),
    ]);
    const own = all.find((s) => s.userId === actor.userId);
    return view({
      kind: "rows",
      rows: await players(all.slice(0, TOP)),
      mine: actor.userId,
      mark: "You",
      unit: UNITS_TEXT[game],
      pinned: own === undefined ? null : pin(await players([own]), all.length),
      missing: "not_yet",
    });
  }
  let boardScope: BoardScope | undefined;
  if (scope === "country") {
    const { country } = await playerCountries().get(actor.userId);
    if (country === null) return view({ kind: "unset", what: "country" });
    boardScope = { country };
  } else if (scope === "university") {
    const { university } = await playerUniversities().get(actor.userId);
    if (university === null) return view({ kind: "unset", what: "university" });
    boardScope = { university: university.id };
  }
  const [list, own, total] = await Promise.all([
    leaderboards().top(board, TOP, boardScope),
    leaderboards().standing(board, actor.userId, boardScope),
    leaderboards().size(board, boardScope),
  ]);
  return view({
    kind: "rows",
    rows: await players(list),
    mine: actor.userId,
    mark: "You",
    unit: UNITS_TEXT[game],
    pinned: own === null ? null : pin(await players([own]), total),
    missing: "not_yet",
  });
}
