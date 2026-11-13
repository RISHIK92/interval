import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type {
  Actor,
  BattleSnapshots,
  FileStore,
} from "../../../../../server/ports";

// P5-W31-S04b (§6.9, Q-P5-17): a flagged battle player's snapshots, for admin.review.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const can = vi.fn<(userId: string, capability: string) => Promise<boolean>>();
const forFlag = vi.fn<BattleSnapshots["forFlag"]>();
const get = vi.fn<FileStore["get"]>();
vi.mock("../../../../../server/container", () => ({
  sessionReader: () => ({ current }),
  entitlements: () => ({ can }),
  battleSnapshots: () => ({ forFlag }),
  files: () => ({ get }),
}));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
}));

const admin: Actor = { userId: "a1", isGuest: false, betaGroup: "developer" };

afterEach(() => {
  vi.clearAllMocks();
});

async function page(flag = "7"): Promise<string> {
  const { default: SnapshotsPage } = await import("./page");
  return renderToStaticMarkup(
    await SnapshotsPage({ params: Promise.resolve({ flag }) }),
  );
}

const stored = (code: string) => ({
  body:
    new Response(JSON.stringify({ language: "python", code })).body ??
    new ReadableStream<Uint8Array>(),
  etag: null,
  size: null,
});

test("only admin.review sees it", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(false);
  await expect(page()).rejects.toThrow("notFound");
  expect(forFlag).not.toHaveBeenCalled();
});

test("each snapshot's time, language and code; a missing one says so", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(true);
  forFlag.mockResolvedValue({
    player: "ada_l",
    snapshots: [
      {
        takenAt: new Date("2026-11-13T10:00:30Z"),
        language: "python",
        key: "k1",
      },
      {
        takenAt: new Date("2026-11-13T10:01:00Z"),
        language: "python",
        key: "k2",
      },
      {
        takenAt: new Date("2026-11-13T10:01:30Z"),
        language: "python",
        key: "k3",
      },
    ],
  });
  get.mockImplementation((key) =>
    Promise.resolve(
      key === "k1"
        ? stored("class Cache: <ok>")
        : key === "k3"
          ? {
              body:
                new Response("{trunc").body ?? new ReadableStream<Uint8Array>(),
              etag: null,
              size: null,
            }
          : null,
    ),
  );
  const html = await page();
  expect(forFlag).toHaveBeenCalledWith("7");
  expect(html).toContain("ada_l");
  expect(html).toContain("10:00:30 UTC · python");
  expect(html).toContain("class Cache: &lt;ok&gt;");
  // k2 isn't there, k3 is unreadable: both said, the rest still shown.
  expect(html.split("The stored code is missing.")).toHaveLength(3);
});

test("no such flag, or not an id: not found", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(true);
  forFlag.mockResolvedValue(null);
  await expect(page()).rejects.toThrow("notFound");
  await expect(page("x1")).rejects.toThrow("notFound");
});
