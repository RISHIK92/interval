import { afterEach, expect, test, vi } from "vitest";

const flush = vi.fn(() => Promise.resolve());
vi.mock("./server/container", () => ({ events: () => ({ flush }) }));
const registerOTel = vi.fn();
vi.mock("@vercel/otel", () => ({ registerOTel }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  registerOTel.mockClear();
  for (const listener of process.listeners("SIGTERM").slice(baseline)) {
    process.removeListener("SIGTERM", listener);
  }
});

const baseline = process.listeners("SIGTERM").length;

// A stopping container (SIGTERM from ECS or compose) must not lose buffered events.
test("on SIGTERM the buffered events are flushed", async () => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  const before = new Set(process.listeners("SIGTERM"));
  const { register } = await import("./instrumentation");
  await register();
  const added = process.listeners("SIGTERM").filter((l) => !before.has(l));
  expect(added).toHaveLength(1);
  process.removeListener("SIGTERM", added[0] as NodeJS.SignalsListener);
  (added[0] as () => void)();
  expect(flush).toHaveBeenCalledOnce();
});

// OPS-2: traces from the web app; spans print only when asked (OTEL_TRACES_EXPORTER).
test.each([
  [undefined, false],
  ["console", true],
])(
  "OTEL_TRACES_EXPORTER=%s registers tracing, printing spans: %s",
  async (value, prints) => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    if (value !== undefined) vi.stubEnv("OTEL_TRACES_EXPORTER", value);
    const { register } = await import("./instrumentation");
    await register();
    expect(registerOTel).toHaveBeenCalledOnce();
    const options = registerOTel.mock.calls[0]?.[0] as {
      serviceName: string;
      spanProcessors: unknown[];
    };
    expect(options.serviceName).toBe("interval-web");
    expect(options.spanProcessors.length > 0).toBe(prints);
  },
);
