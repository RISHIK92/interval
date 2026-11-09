import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type { Actor, AdminTts, TtsRun } from "../../../server/ports";

// P4-W22-S03 (TTS-1): the blind test, for admin.review only; providers shown only once
// every script has a pick; each voice's audio served to admins only.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const can = vi.fn<(userId: string, capability: string) => Promise<boolean>>();
const latest = vi.fn<AdminTts["latest"]>(() => Promise.resolve(null));
const pick = vi.fn<AdminTts["pick"]>(() => Promise.resolve(true));
const fileKey = vi.fn<AdminTts["fileKey"]>(() =>
  Promise.resolve("tts-blind/r/1-A.mp3"),
);
const get = vi.fn(() =>
  Promise.resolve({
    body: new Blob([new Uint8Array([1, 2, 3])]).stream(),
    etag: null,
    size: 3,
  }),
);
vi.mock("../../../server/container", () => ({
  sessionReader: () => ({ current }),
  entitlements: () => ({ can }),
  adminTts: () => ({ latest, pick, fileKey }),
  files: () => ({ get }),
}));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

const admin: Actor = { userId: "a1", isGuest: false, betaGroup: "developer" };
const hidden: TtsRun = {
  run: "r",
  newerStopped: false,
  revealed: false,
  tally: [],
  scripts: [
    {
      scriptNo: 1,
      voices: [
        { id: "11", label: "A", picked: false, provider: null },
        { id: "12", label: "B", picked: false, provider: null },
      ],
    },
  ],
};
afterEach(() => {
  vi.clearAllMocks();
});
const page = async () => {
  const { default: TtsPage } = await import("./page");
  return renderToStaticMarkup(
    await TtsPage({ searchParams: Promise.resolve({}) }),
  );
};

test("before every pick: voices A and B with players, no provider named", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(true);
  latest.mockResolvedValue(hidden);
  const html = await page();
  expect(html).toContain('src="/api/admin/tts/11"');
  expect(html).toContain("Pick A");
  expect(html).not.toMatch(/ElevenLabs|Inworld|Polly/);
  expect(html).toContain("The providers show once every script has a pick.");
});

test("after: each voice's provider and the tally", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(true);
  latest.mockResolvedValue({
    ...hidden,
    revealed: true,
    tally: [
      { provider: "inworld", picks: 1 },
      { provider: "elevenlabs", picks: 0 },
    ],
    scripts: [
      {
        scriptNo: 1,
        voices: [
          { id: "11", label: "A", picked: true, provider: "inworld" },
          { id: "12", label: "B", picked: false, provider: "elevenlabs" },
        ],
      },
    ],
  });
  const html = await page();
  expect(html).toContain("Voice A · Inworld · your pick");
  expect(html).toContain("Inworld: 1");
  expect(html).not.toContain("Pick A");
});

test("a pick is recorded by whom; a second for the script is said", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(true);
  const { pickVoiceAction } = await import("./actions");
  const form = new FormData();
  form.set("sampleId", "11");
  await expect(pickVoiceAction(form)).rejects.toThrow(
    "redirect:/admin/tts?saved=1",
  );
  expect(pick).toHaveBeenCalledWith("11", "a1");
  pick.mockResolvedValueOnce(false);
  await expect(pickVoiceAction(form)).rejects.toThrow(
    "redirect:/admin/tts?error=picked",
  );
});

test("the audio is the admin's only", async () => {
  const { GET } = await import("../../api/admin/tts/[id]/route");
  const call = () =>
    GET(new Request("http://localhost:3100/api/admin/tts/11"), {
      params: Promise.resolve({ id: "11" }),
    });
  current.mockResolvedValue(admin);
  can.mockResolvedValue(true);
  const ok = await call();
  expect(ok.status).toBe(200);
  expect(ok.headers.get("content-type")).toBe("audio/mpeg");
  expect(ok.headers.get("cache-control")).toBe("private, no-store");
  expect(get).toHaveBeenCalledWith("tts-blind/r/1-A.mp3");
  can.mockResolvedValue(false);
  expect((await call()).status).toBe(404);
  current.mockResolvedValue(null);
  expect((await call()).status).toBe(404);
});

test("a newer run that stopped part way is said", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(true);
  latest.mockResolvedValue({ ...hidden, newerStopped: true });
  expect(await page()).toContain("The latest test stopped part way");
});
