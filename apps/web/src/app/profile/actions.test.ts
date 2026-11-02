import { afterEach, describe, expect, test, vi } from "vitest";
import type {
  Actor,
  Feedback,
  GitHubAccounts,
  Leaderboards,
  PlayerCountries,
  PlayerUniversities,
  PreferencesStore,
  University,
} from "../../server/ports";

// §5A, PER-1, Q-P1-36, P1-W4-S08: the Profile page's three actions.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const update = vi.fn<PreferencesStore["update"]>(() => Promise.resolve(true));
const resetInferred = vi.fn<Feedback["resetInferred"]>(() => Promise.resolve());
const unhideSource = vi.fn<Feedback["unhideSource"]>(() =>
  Promise.resolve(true),
);
const give = vi.fn();
const enqueue = vi.fn<(...args: unknown[]) => Promise<void>>(() =>
  Promise.resolve(),
);
vi.mock("../../server/container", () => ({
  sessionReader: () => ({ current }),
  preferences: () => ({ update }),
  feedback: () => ({ resetInferred, unhideSource, give }),
  jobQueue: () => ({ enqueue }),
  githubAccounts: () => ({ disconnect, get: githubGet }),
  events: () => ({ emit }),
  playerCountries: () => ({ set: setCountry, remove: removeCountry }),
  leaderboards: () => ({ invalidate }),
  playerUniversities: () => ({
    set: setUniversity,
    setTyped: setTypedUniversity,
    remove: removeUniversity,
  }),
}));
const LISTED: University = {
  id: "7",
  name: "Indian Institute of Technology Delhi",
  country: "IN",
  listed: true,
};
const TYPED: University = {
  id: "9",
  name: "Night School",
  country: null,
  listed: false,
};
const setUniversity = vi.fn<PlayerUniversities["set"]>(() =>
  Promise.resolve({ ok: true, university: LISTED, previous: TYPED }),
);
const setTypedUniversity = vi.fn<PlayerUniversities["setTyped"]>(() =>
  Promise.resolve({ ok: true, university: TYPED, previous: null }),
);
const removeUniversity = vi.fn<PlayerUniversities["remove"]>(() =>
  Promise.resolve(TYPED),
);
const setCountry = vi.fn<PlayerCountries["set"]>(() =>
  Promise.resolve({ ok: true, previous: "IN" }),
);
const removeCountry = vi.fn<PlayerCountries["remove"]>(() =>
  Promise.resolve("BR"),
);
const invalidate = vi.fn<Leaderboards["invalidate"]>(() => Promise.resolve());
const disconnect = vi.fn<GitHubAccounts["disconnect"]>(() =>
  Promise.resolve(true),
);
const emit = vi.fn();
const githubGet = vi.fn<GitHubAccounts["get"]>(() =>
  Promise.resolve({
    login: "octo",
    connectedAt: new Date(),
    installations: [],
    syncedMinutesAgo: null,
    repositories: [],
  }),
);
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === "iv_visit" ? { name, value: "visit-1.1790000000" } : undefined,
    }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

const user: Actor = { userId: "g1", isGuest: false, betaGroup: "student" };
const guest: Actor = { ...user, isGuest: true };

afterEach(() => {
  vi.clearAllMocks();
});

// A goal unless the test gives its own (ADR-0015 needs one).
function form(fields: [string, string][]): FormData {
  const data = new FormData();
  const withGoal: [string, string][] = fields.some(([name]) => name === "goal")
    ? fields
    : [["goal", "system-design-interviews"], ...fields];
  for (const [name, value] of withGoal) data.append(name, value);
  return data;
}

async function actions() {
  current.mockResolvedValue(user);
  return import("./actions");
}

describe("editing the explicit choices", () => {
  test("replaces them, queues a recompute, and touches no feedback", async () => {
    const { updatePreferencesAction } = await actions();
    await expect(
      updatePreferencesAction(
        form([
          ["topic", "backend"],
          ["topic", "databases"],
          ["level", "advanced"],
          ["breakLength", "8-15"],
        ]),
      ),
    ).rejects.toThrow("redirect:/profile?saved=choices");
    expect(update).toHaveBeenCalledExactlyOnceWith("g1", {
      goals: ["system-design-interviews"],
      topics: ["backend", "databases"],
      level: "advanced",
      breakLength: "8-15",
    });
    expect(enqueue).toHaveBeenCalledOnce();
    expect(give).not.toHaveBeenCalled();
    expect(resetInferred).not.toHaveBeenCalled();
  });

  test("before onboarding there is nothing to edit: off to onboarding", async () => {
    const { updatePreferencesAction } = await actions();
    update.mockResolvedValueOnce(false);
    await expect(
      updatePreferencesAction(
        form([
          ["topic", "backend"],
          ["level", "advanced"],
          ["breakLength", "8-15"],
        ]),
      ),
    ).rejects.toThrow("redirect:/onboarding");
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("an edit with no topic is refused and changes nothing", async () => {
    const { updatePreferencesAction } = await actions();
    await expect(
      updatePreferencesAction(
        form([
          ["level", "advanced"],
          ["breakLength", "8-15"],
        ]),
      ),
    ).rejects.toThrow("redirect:/profile?missing=topic");
    expect(update).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });
});

test("reset clears the inferred layer and never the explicit choices", async () => {
  const { resetInferredAction } = await actions();
  await expect(resetInferredAction()).rejects.toThrow(
    "redirect:/profile?saved=reset",
  );
  expect(resetInferred).toHaveBeenCalledExactlyOnceWith("g1");
  expect(update).not.toHaveBeenCalled();
  expect(enqueue).toHaveBeenCalledOnce();
});

test("unhide restores one source on the next recompute", async () => {
  const { unhideSourceAction } = await actions();
  await expect(unhideSourceAction(form([["sourceId", "7"]]))).rejects.toThrow(
    "redirect:/profile?saved=unhidden",
  );
  expect(unhideSource).toHaveBeenCalledExactlyOnceWith("g1", "7");
  expect(enqueue).toHaveBeenCalledOnce();
  expect(enqueue.mock.calls[0]?.[0]).toBe("recompute_feed");
});

test("a malformed source id is refused", async () => {
  const { unhideSourceAction } = await actions();
  await expect(
    unhideSourceAction(form([["sourceId", "7 or 1=1"]])),
  ).rejects.toThrow(/^redirect:\/profile$/);
  expect(unhideSource).not.toHaveBeenCalled();
});

test("without a session every action sends the visitor to /join", async () => {
  const all = await import("./actions");
  current.mockResolvedValue(null);
  const valid = form([
    ["topic", "backend"],
    ["level", "advanced"],
    ["breakLength", "8-15"],
    ["sourceId", "7"],
  ]);
  await expect(all.updatePreferencesAction(valid)).rejects.toThrow(
    "redirect:/join",
  );
  await expect(all.resetInferredAction()).rejects.toThrow("redirect:/join");
  await expect(all.unhideSourceAction(valid)).rejects.toThrow("redirect:/join");
  expect(update).not.toHaveBeenCalled();
  expect(resetInferred).not.toHaveBeenCalled();
  expect(unhideSource).not.toHaveBeenCalled();
});

// P2-W12-S01 (§5H, ADR-0024): disconnecting deletes Interval's copy, recorded once.
test("disconnect deletes the user's GitHub connection and says how to revoke on GitHub", async () => {
  const { disconnectGitHubAction } = await import("./actions");
  current.mockResolvedValue(user);
  await expect(disconnectGitHubAction()).rejects.toThrow(
    "redirect:/profile?saved=github-off",
  );
  expect(disconnect).toHaveBeenCalledWith("g1");
  expect(emit).toHaveBeenCalledWith(
    "github_disconnected",
    {},
    expect.objectContaining({ userId: "g1", sessionId: "visit-1" }),
  );
  // P2-W12-S04: the feed drops its project picks on the recompute.
  expect(enqueue).toHaveBeenCalledWith(
    "recompute_feed",
    { user_id: "g1" },
    expect.anything(),
  );
  // Nothing was connected: nothing recorded.
  emit.mockClear();
  disconnect.mockResolvedValueOnce(false);
  await expect(disconnectGitHubAction()).rejects.toThrow("redirect:/profile");
  expect(emit).not.toHaveBeenCalled();
});

test("refresh queues a read of the user's repositories, one a minute", async () => {
  const { refreshGitHubAction } = await import("./actions");
  current.mockResolvedValue(user);
  await expect(refreshGitHubAction()).rejects.toThrow(
    "redirect:/profile?saved=github-refresh",
  );
  expect(enqueue).toHaveBeenCalledWith(
    "github_sync",
    { user_id: "g1" },
    {
      idempotencyKey: expect.stringMatching(/^github-sync-g1-m\d+$/) as unknown,
    },
  );
});

test("refresh does nothing for someone not connected, and says so when the queue is down", async () => {
  const { refreshGitHubAction } = await import("./actions");
  current.mockResolvedValue(user);
  githubGet.mockResolvedValueOnce(null);
  await expect(refreshGitHubAction()).rejects.toThrow("redirect:/profile");
  expect(enqueue).not.toHaveBeenCalled();
  enqueue.mockRejectedValueOnce(new Error("valkey down"));
  await expect(refreshGitHubAction()).rejects.toThrow(
    "redirect:/profile?github=refresh-failed",
  );
});

// ADR-0029: guests play, and only play; this action is for accounts.
test("a guest is sent to sign up before anything is written", async () => {
  current.mockResolvedValue(guest);
  const all = await import("./actions");
  await expect(all.updatePreferencesAction(new FormData())).rejects.toThrow(
    "redirect:/sign-up",
  );
  await expect(all.resetInferredAction()).rejects.toThrow("redirect:/sign-up");
  await expect(all.unhideSourceAction(new FormData())).rejects.toThrow(
    "redirect:/sign-up",
  );
  await expect(all.refreshGitHubAction()).rejects.toThrow("redirect:/sign-up");
  await expect(all.disconnectGitHubAction()).rejects.toThrow(
    "redirect:/sign-up",
  );
});

// P3-W14-S02 (Q-P3-08; owner, 2026-11-02): the country, and its boards worked out again.
describe("country", () => {
  const country = (code: string) => {
    const data = new FormData();
    data.set("country", code);
    return data;
  };

  test("saving sets it and rebuilds the boards of the country it was", async () => {
    const { setCountryAction } = await actions();
    await expect(setCountryAction(country("BR"))).rejects.toThrow(
      "redirect:/profile?saved=country",
    );
    expect(setCountry).toHaveBeenCalledExactlyOnceWith("g1", "BR");
    expect(invalidate).toHaveBeenCalledExactlyOnceWith("g1", [
      { country: "IN" },
    ]);
    expect(emit).toHaveBeenCalledExactlyOnceWith(
      "country_changed",
      { action: "set" },
      expect.objectContaining({ userId: "g1", sessionId: "visit-1" }),
    );
  });

  test("saving the country it already has is no event", async () => {
    const { setCountryAction } = await actions();
    setCountry.mockResolvedValueOnce({ ok: true, previous: "BR" });
    await expect(setCountryAction(country("BR"))).rejects.toThrow(
      "redirect:/profile?saved=country",
    );
    expect(emit).not.toHaveBeenCalled();
  });

  test("inside the month it's refused, and the boards are left alone", async () => {
    const { setCountryAction } = await actions();
    setCountry.mockResolvedValueOnce({
      ok: false,
      changeableFrom: new Date("2026-12-02T10:00:00Z"),
    });
    await expect(setCountryAction(country("BR"))).rejects.toThrow(
      "redirect:/profile?country=soon",
    );
    expect(invalidate).not.toHaveBeenCalled();
  });

  test.each(["", "br", "XX", "EU", "BRA"])(
    "%j isn't a country: nothing is written",
    async (code) => {
      const { setCountryAction } = await actions();
      await expect(setCountryAction(country(code))).rejects.toThrow(
        "redirect:/profile",
      );
      expect(setCountry).not.toHaveBeenCalled();
    },
  );

  test("removing is always allowed, and rebuilds the boards it was on", async () => {
    const { removeCountryAction } = await actions();
    await expect(removeCountryAction()).rejects.toThrow(
      "redirect:/profile?saved=country-removed",
    );
    expect(removeCountry).toHaveBeenCalledExactlyOnceWith("g1");
    expect(invalidate).toHaveBeenCalledExactlyOnceWith("g1", [
      { country: "BR" },
    ]);
    expect(emit).toHaveBeenCalledExactlyOnceWith(
      "country_changed",
      { action: "removed" },
      expect.objectContaining({ userId: "g1" }),
    );
    // Nothing to remove: no event.
    removeCountry.mockResolvedValueOnce(null);
    await expect(removeCountryAction()).rejects.toThrow(
      "redirect:/profile?saved=country-removed",
    );
    expect(emit).toHaveBeenCalledOnce();
  });

  test("a guest is sent to sign up", async () => {
    const { removeCountryAction, setCountryAction } = await actions();
    current.mockResolvedValue(guest);
    await expect(setCountryAction(country("BR"))).rejects.toThrow(
      "redirect:/sign-up",
    );
    await expect(removeCountryAction()).rejects.toThrow("redirect:/sign-up");
    expect(setCountry).not.toHaveBeenCalled();
    expect(removeCountry).not.toHaveBeenCalled();
  });
});

// P3-W14-S03 (§6.7, ADR-0032): picked from the list or typed; unverified, no email.
describe("university", () => {
  const fields = (name: string, value: string) => {
    const data = new FormData();
    data.set(name, value);
    return data;
  };

  test("choosing a listed one sets it and records the change", async () => {
    const { chooseUniversityAction } = await actions();
    await expect(
      chooseUniversityAction(fields("universityId", "7")),
    ).rejects.toThrow("redirect:/profile?saved=university");
    expect(setUniversity).toHaveBeenCalledExactlyOnceWith("g1", "7");
    // P3-W14-S04: its boards, and the averages of the one it left.
    expect(invalidate).toHaveBeenCalledExactlyOnceWith("g1", [
      { university: "9" },
    ]);
    expect(emit).toHaveBeenCalledExactlyOnceWith(
      "university_changed",
      { action: "set", listed: true },
      expect.objectContaining({ userId: "g1", sessionId: "visit-1" }),
    );
  });

  test("choosing the one it already has is no event", async () => {
    const { chooseUniversityAction } = await actions();
    setUniversity.mockResolvedValueOnce({
      ok: true,
      university: LISTED,
      previous: LISTED,
    });
    await expect(
      chooseUniversityAction(fields("universityId", "7")),
    ).rejects.toThrow("redirect:/profile?saved=university");
    expect(emit).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });

  test.each(["", "x", "7; drop", "-1", "1.5"])(
    "%j isn't an id: nothing is written",
    async (id) => {
      const { chooseUniversityAction } = await actions();
      await expect(
        chooseUniversityAction(fields("universityId", id)),
      ).rejects.toThrow("redirect:/profile");
      expect(setUniversity).not.toHaveBeenCalled();
    },
  );

  test("an id that isn't a university goes back to Profile", async () => {
    const { chooseUniversityAction } = await actions();
    setUniversity.mockResolvedValueOnce({ ok: false, reason: "unknown" });
    await expect(
      chooseUniversityAction(fields("universityId", "8")),
    ).rejects.toThrow(/^redirect:\/profile$/);
    expect(emit).not.toHaveBeenCalled();
  });

  test("inside the month it's refused", async () => {
    const { chooseUniversityAction, typeUniversityAction } = await actions();
    const refused = {
      ok: false as const,
      reason: "soon" as const,
      changeableFrom: new Date("2026-12-02T10:00:00Z"),
    };
    setUniversity.mockResolvedValueOnce(refused);
    setTypedUniversity.mockResolvedValueOnce(refused);
    await expect(
      chooseUniversityAction(fields("universityId", "7")),
    ).rejects.toThrow("redirect:/profile?university=soon");
    await expect(
      typeUniversityAction(fields("name", "Night School")),
    ).rejects.toThrow("redirect:/profile?university=soon");
    expect(emit).not.toHaveBeenCalled();
  });

  test("a name of 120 letters outside the BMP is allowed", async () => {
    const { typeUniversityAction } = await actions();
    await expect(
      typeUniversityAction(fields("name", "𝔘".repeat(120))),
    ).rejects.toThrow("redirect:/profile?saved=university");
  });

  test("a typed name is set as typed, and recorded as not listed", async () => {
    const { typeUniversityAction } = await actions();
    await expect(
      typeUniversityAction(fields("name", "  Night   School ")),
    ).rejects.toThrow("redirect:/profile?saved=university");
    expect(setTypedUniversity).toHaveBeenCalledExactlyOnceWith(
      "g1",
      "Night School",
    );
    // Nothing before: only its own boards.
    expect(invalidate).toHaveBeenCalledExactlyOnceWith("g1", []);
    expect(emit).toHaveBeenCalledExactlyOnceWith(
      "university_changed",
      { action: "set", listed: false },
      expect.anything(),
    );
  });

  // Counted as Postgres counts (code points); hidden characters could spoof a name.
  test.each([
    "",
    " ",
    "a",
    "x".repeat(121),
    "😀",
    "\u202Eevil U",
    "A\u200BB",
    "A\u0000B",
  ])("a typed name that can't be shown (%j) is sent back", async (name) => {
    const { typeUniversityAction } = await actions();
    await expect(typeUniversityAction(fields("name", name))).rejects.toThrow(
      "redirect:/profile?university=name",
    );
    expect(setTypedUniversity).not.toHaveBeenCalled();
  });

  test("removing is always allowed and records the change", async () => {
    const { removeUniversityAction } = await actions();
    await expect(removeUniversityAction()).rejects.toThrow(
      "redirect:/profile?saved=university-removed",
    );
    expect(removeUniversity).toHaveBeenCalledExactlyOnceWith("g1");
    expect(invalidate).toHaveBeenCalledExactlyOnceWith("g1", [
      { university: "9" },
    ]);
    expect(emit).toHaveBeenCalledExactlyOnceWith(
      "university_changed",
      { action: "removed", listed: false },
      expect.anything(),
    );
    removeUniversity.mockResolvedValueOnce(null);
    await expect(removeUniversityAction()).rejects.toThrow(
      "redirect:/profile?saved=university-removed",
    );
    expect(emit).toHaveBeenCalledOnce();
  });

  test("a guest is sent to sign up", async () => {
    const {
      chooseUniversityAction,
      removeUniversityAction,
      typeUniversityAction,
    } = await actions();
    current.mockResolvedValue(guest);
    await expect(
      chooseUniversityAction(fields("universityId", "7")),
    ).rejects.toThrow("redirect:/sign-up");
    await expect(
      typeUniversityAction(fields("name", "Night School")),
    ).rejects.toThrow("redirect:/sign-up");
    await expect(removeUniversityAction()).rejects.toThrow("redirect:/sign-up");
    expect(setUniversity).not.toHaveBeenCalled();
    expect(setTypedUniversity).not.toHaveBeenCalled();
    expect(removeUniversity).not.toHaveBeenCalled();
  });
});
