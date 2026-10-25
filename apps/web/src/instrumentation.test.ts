import { afterEach, expect, test, vi } from "vitest";

const flush = vi.fn(() => Promise.resolve());
vi.mock("./server/container", () => ({ events: () => ({ flush }) }));

afterEach(() => {
  vi.unstubAllEnvs();
});

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
