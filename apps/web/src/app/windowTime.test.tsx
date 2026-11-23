// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";
import { useWindowTime } from "./windowTime";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function When({ at }: { at: string }) {
  return <>{useWindowTime(at)}</>;
}

// One format with /play's ranked card: "Monday 9:00 PM", never "09:00".
test("a window's hour has no leading zero", () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => {
    root.render(<When at={new Date(2026, 10, 23, 9, 5).toISOString()} />);
  });
  expect(host.textContent).toMatch(/9:05/);
  expect(host.textContent).not.toMatch(/09:05/);
  act(() => {
    root.unmount();
  });
});
