import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { EVENT_NAMES, EVENT_VERSIONS, envelopeSchema } from "./generated.js";

type Spec = { events: Record<string, { version: number; props: object }> };
const spec = JSON.parse(
  readFileSync(new URL("../events.json", import.meta.url), "utf8"),
) as Spec;

describe("the event list (Q-P1-20)", () => {
  test("holds exactly the accepted names", () => {
    expect([...EVENT_NAMES].sort()).toEqual(
      [
        "session_started",
        "onboarding_completed",
        "feed_viewed",
        "card_impression",
        "card_opened",
        "section_finished",
        "article_finished",
        "continue_clicked",
        "item_saved",
        "feedback_given",
        // Added by the owner with W4-S07's plan (2026-10-26): Not interested undone.
        "feedback_undone",
        "source_hidden",
        "signup_completed",
        "guest_merged",
        "pwa_installed",
        "outbound_click",
        // Phase 2, in the owner-approved Week 7 plan (2026-10-27, P2-W7-S03).
        "note_saved",
        "note_deleted",
        // The owner-approved Week 9 plan (2026-10-27, Q-P2-20, P2-W9-S01).
        "quiz_started",
        "quiz_answered",
        "quiz_finished",
        "question_flagged",
        // The owner-approved Week 10 plan (2026-10-28, Q-P2-28, P2-W10-S03).
        "path_started",
      ].sort(),
    );
  });

  test("names are snake_case object_action", () => {
    for (const name of EVENT_NAMES) expect(name).toMatch(/^[a-z]+(_[a-z]+)+$/);
  });

  test("the generated code follows events.json", () => {
    expect(Object.keys(spec.events).sort()).toEqual([...EVENT_NAMES].sort());
    for (const [name, event] of Object.entries(spec.events)) {
      expect(EVENT_VERSIONS[name as keyof typeof EVENT_VERSIONS]).toBe(
        event.version,
      );
    }
  });
});

const base = {
  event_id: "6f1c1f3e-0b7a-4c55-9d43-0d6a1f0b2c11",
  occurred_at: "2026-10-25T10:00:00.000Z",
  user_id: "u1",
  is_guest: true,
  beta_group: "student",
  session_id: "v1",
  source: "web",
};

describe("the envelope", () => {
  test("accepts an event with its own props", () => {
    const event = {
      ...base,
      name: "feed_viewed",
      version: 1,
      props: { card_count: 3 },
    };
    expect(envelopeSchema.parse(event)).toEqual(event);
  });

  // ADR-0018: an open says where it opened, Interval's reader or the browser.
  test("card_opened v3 carries its surface", () => {
    const props = {
      kind: "moment",
      chip: "3-8",
      position: 1,
      item_id: "5",
      moment_id: "9",
    };
    const event = { ...base, name: "card_opened", version: 3 };
    for (const surface of ["in_app", "browser"]) {
      expect(
        envelopeSchema.safeParse({ ...event, props: { ...props, surface } })
          .success,
      ).toBe(true);
    }
    expect(envelopeSchema.safeParse({ ...event, props }).success).toBe(false);
    expect(
      envelopeSchema.safeParse({
        ...event,
        props: { ...props, surface: "app" },
      }).success,
    ).toBe(false);
    expect(
      envelopeSchema.safeParse({
        ...event,
        version: 2,
        props: { ...props, surface: "browser" },
      }).success,
    ).toBe(false);
  });

  test.each([
    [
      "props from another event",
      { name: "feed_viewed", version: 1, props: { method: "mark_done" } },
    ],
    [
      "a negative count",
      { name: "feed_viewed", version: 1, props: { card_count: -1 } },
    ],
    [
      "an unknown enum value",
      { name: "section_finished", version: 1, props: { method: "skipped" } },
    ],
    [
      "a stale version",
      { name: "feed_viewed", version: 2, props: { card_count: 1 } },
    ],
    ["an unknown name", { name: "page_viewed", version: 1, props: {} }],
  ])("rejects %s", (_case, event) => {
    expect(envelopeSchema.safeParse({ ...base, ...event }).success).toBe(false);
  });

  test.each([
    ["a non-uuid event_id", { event_id: "1" }],
    ["a local time", { occurred_at: "2026-10-25T10:00:00" }],
    ["an unknown beta group", { beta_group: "teacher" }],
    ["an extra field", { extra: 1 }],
  ])("rejects %s", (_case, change) => {
    const event = {
      ...base,
      name: "session_started",
      version: 1,
      props: {},
      ...change,
    };
    expect(envelopeSchema.safeParse(event).success).toBe(false);
  });

  test("session_id may be null", () => {
    const event = {
      ...base,
      session_id: null,
      name: "signup_completed",
      version: 1,
      props: {},
    };
    expect(envelopeSchema.safeParse(event).success).toBe(true);
  });
});
