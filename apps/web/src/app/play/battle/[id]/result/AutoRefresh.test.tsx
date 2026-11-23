// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { AutoRefresh } from "./AutoRefresh";

// A results page waiting on something reloads its data by itself, until it's gone.
const refresh = vi.fn<() => void>();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

test("refreshes every interval while shown, and stops once gone", () => {
  vi.useFakeTimers();
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => {
    root.render(<AutoRefresh everyMs={10_000} />);
  });
  act(() => {
    vi.advanceTimersByTime(25_000);
  });
  expect(refresh).toHaveBeenCalledTimes(2);
  act(() => {
    root.unmount();
  });
  vi.advanceTimersByTime(30_000);
  expect(refresh).toHaveBeenCalledTimes(2);
  vi.useRealTimers();
});
