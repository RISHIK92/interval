import { expect, test, vi } from "vitest";
import { DEVICE_TOKEN, fetchStatus } from "./api";
import { readSite, type Site } from "./site";

const TOKEN = `ivd_${"a".repeat(43)}`;
const setting = readSite("https://interval.example");
if (setting.kind !== "ok") throw new Error("the test site is refused");
const site: Site = setting.site;

const running = {
  task: {
    state: "running",
    startedAt: "2026-11-27T10:00:00.000Z",
    seconds: 130,
  },
  chip: "3-8",
  suggestions: [
    {
      title: "Why consensus",
      minutes: 2,
      url: "https://interval.example/read/10",
    },
  ],
};

function answering(response: Response) {
  return vi.fn<typeof fetch>(() => Promise.resolve(response));
}

test("the token shape is the CLI's", () => {
  expect(DEVICE_TOKEN.test(TOKEN)).toBe(true);
  expect(DEVICE_TOKEN.test(`ivd_${"-_A9".repeat(10)}abc`)).toBe(true);
  expect(DEVICE_TOKEN.test(`ivd_${"a".repeat(42)}`)).toBe(false);
  expect(DEVICE_TOKEN.test(`ivd_${"a".repeat(44)}`)).toBe(false);
  expect(DEVICE_TOKEN.test(`ivx_${"a".repeat(43)}`)).toBe(false);
  expect(DEVICE_TOKEN.test(`ivd_${"a".repeat(42)}=`)).toBe(false);
});

test("the only request is a GET of the status with the token, redirects not followed", async () => {
  const fetchFn = answering(Response.json(running));
  await fetchStatus(fetchFn, site, TOKEN, "1-3");
  expect(fetchFn).toHaveBeenCalledTimes(1);
  const [url, init] = fetchFn.mock.calls[0] ?? [];
  expect(url).toBe("https://interval.example/api/agent/status?chip=1-3");
  expect(init?.method ?? "GET").toBe("GET");
  expect(init?.body).toBeUndefined();
  expect(init?.redirect).toBe("manual");
  expect(init?.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
});

test("without a chip the site picks the user's break length", async () => {
  const fetchFn = answering(Response.json(running));
  await fetchStatus(fetchFn, site, TOKEN, undefined);
  expect(fetchFn.mock.calls[0]?.[0]).toBe(
    "https://interval.example/api/agent/status",
  );
});

test("a status parses with the API's schema", async () => {
  const result = await fetchStatus(
    answering(Response.json(running)),
    site,
    TOKEN,
    undefined,
  );
  expect(result).toEqual({ kind: "ok", status: running });
});

test("an answer that isn't a status fails instead of showing nonsense", async () => {
  for (const body of [
    "not json",
    JSON.stringify({
      task: { state: "sleeping" },
      chip: "3-8",
      suggestions: [],
    }),
    JSON.stringify({
      ...running,
      suggestions: Array(4).fill(running.suggestions[0]),
    }),
    JSON.stringify({ ...running, filler: "x".repeat(70 * 1024) }),
  ]) {
    const result = await fetchStatus(
      answering(new Response(body)),
      site,
      TOKEN,
      undefined,
    );
    expect(result).toEqual({
      kind: "failed",
      detail: "Interval's answer wasn't a status",
    });
  }
});

test("each refusal is told apart", async () => {
  const cases: [Response, unknown][] = [
    [new Response(null, { status: 401 }), { kind: "refused" }],
    [new Response(null, { status: 403 }), { kind: "plan" }],
    [
      new Response(null, { status: 429, headers: { "Retry-After": "60" } }),
      { kind: "rateLimited", retryAfterSeconds: 60 },
    ],
    [
      new Response(null, { status: 429, headers: { "Retry-After": "120" } }),
      { kind: "rateLimited", retryAfterSeconds: 120 },
    ],
    [
      new Response(null, { status: 429 }),
      { kind: "rateLimited", retryAfterSeconds: 60 },
    ],
    [
      new Response(null, {
        status: 308,
        headers: { Location: "https://elsewhere.example/" },
      }),
      { kind: "redirect" },
    ],
    [new Response(null, { status: 302 }), { kind: "redirect" }],
    [
      new Response(null, { status: 500 }),
      { kind: "failed", detail: "Interval answered 500" },
    ],
    [
      new Response(null, { status: 400 }),
      { kind: "failed", detail: "Interval answered 400" },
    ],
  ];
  for (const [response, expected] of cases) {
    expect(
      await fetchStatus(answering(response), site, TOKEN, undefined),
    ).toEqual(expected);
  }
});

test("a huge Retry-After is capped at an hour, so the timer stays in range", async () => {
  for (const header of ["99999999999", "9".repeat(400), "3601"]) {
    const result = await fetchStatus(
      answering(
        new Response(null, { status: 429, headers: { "Retry-After": header } }),
      ),
      site,
      TOKEN,
      undefined,
    );
    expect(result, header).toEqual({
      kind: "rateLimited",
      retryAfterSeconds: 3600,
    });
  }
});

test("the body limit counts bytes and trusts a declared length", async () => {
  // 40k three-byte characters: under 64 KiB in UTF-16 units, over it in bytes.
  const wide = JSON.stringify({ ...running, filler: "€".repeat(40_000) });
  expect(wide.length).toBeLessThan(64 * 1024);
  expect(
    await fetchStatus(answering(new Response(wide)), site, TOKEN, undefined),
  ).toEqual({
    kind: "failed",
    detail: "Interval's answer wasn't a status",
  });
  const declared = new Response(JSON.stringify(running), {
    headers: { "Content-Length": String(1024 * 1024) },
  });
  expect(
    await fetchStatus(answering(declared), site, TOKEN, undefined),
  ).toEqual({
    kind: "failed",
    detail: "Interval's answer wasn't a status",
  });
  const fine = JSON.stringify({
    ...running,
    suggestions: [{ ...running.suggestions[0], title: "Ünïcödé €" }],
  });
  expect(
    (await fetchStatus(answering(new Response(fine)), site, TOKEN, undefined))
      .kind,
  ).toBe("ok");
});

test("an unreachable site fails with why", async () => {
  const fetchFn = vi.fn<typeof fetch>(() =>
    Promise.reject(new TypeError("fetch failed")),
  );
  expect(await fetchStatus(fetchFn, site, TOKEN, undefined)).toEqual({
    kind: "failed",
    detail: "couldn't reach Interval (fetch failed)",
  });
});
