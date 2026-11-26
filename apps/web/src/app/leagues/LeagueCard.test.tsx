import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { LeagueRow } from "../../server/ports";
import { LeagueCard } from "./LeagueCard";

// ADR-0045 (Play hub, web): the league card, as the design's rail shows it.
const row = (rank: number, userId = `p${String(rank)}`): LeagueRow => ({
  userId,
  username: `player${String(rank)}`,
  rank,
  points: 500 - rank,
  matches: 1,
  battles: 0,
  checkpoints: 0,
  today: 0,
});
const cohort = (mine: number) => ({
  size: 30,
  up: 7,
  down: 5,
  rows: Array.from({ length: 30 }, (_, i) =>
    row(i + 1, i + 1 === mine ? "me" : undefined),
  ),
});
const left = { days: 2, hours: 6 };

test("the player between their neighbours, and the promotion zone", () => {
  const html = renderToStaticMarkup(
    <LeagueCard tier="sapphire" cohort={cohort(5)} userId="me" left={left} />,
  );
  expect(html).toContain('href="/leagues"');
  expect(html).toContain("Sapphire league");
  expect(html).toContain("2 days 6 h left");
  expect(html).toContain("player4");
  expect(html).toContain("You");
  expect(html).toContain("player6");
  expect(html).not.toContain("player3");
  expect(html).not.toContain("player7");
  expect(html).toContain("In the promotion zone · top 7 move up");
});

test("the demotion zone, the middle, and not yet placed", () => {
  const low = renderToStaticMarkup(
    <LeagueCard tier="gold" cohort={cohort(30)} userId="me" left={left} />,
  );
  expect(low).toContain("In the demotion zone · bottom 5 move down");
  expect(low).toContain("player29");
  const middle = renderToStaticMarkup(
    <LeagueCard tier="gold" cohort={cohort(15)} userId="me" left={left} />,
  );
  expect(middle).not.toContain(" zone ·");
  const none = renderToStaticMarkup(
    <LeagueCard tier="bronze" cohort={null} userId="me" left={left} />,
  );
  expect(none).toContain("Bronze league");
  expect(none).toContain("Your first points this week put you in a league.");
});
