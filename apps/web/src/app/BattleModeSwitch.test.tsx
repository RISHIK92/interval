// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { BattleModeSwitch } from "./BattleModeSwitch";

// §6.2 (ADR-0047): drawn as a segmented control, the mode choice is still a radio group
// named "Battle mode", each radio named by its mode and what it allows; the detail shown
// beneath repeats the chosen radio's name, so screen readers skip it.
test("a radio group named Battle mode, each radio named with its detail", () => {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    <BattleModeSwitch
      value="ai"
      details={{
        human: "no AI tools",
        ai: "any tools, bigger problems",
      }}
      disabled={false}
      onChange={() => undefined}
    />,
  );
  const group = host.querySelector("fieldset");
  expect(group?.querySelector("legend")?.textContent).toBe("Battle mode");
  const radios = [
    ...(group?.querySelectorAll<HTMLInputElement>('input[type="radio"]') ?? []),
  ];
  // A radio inside its label takes the label's text as its name.
  expect(radios.map((r) => r.closest("label")?.textContent)).toEqual([
    "Human mode: no AI tools",
    "AI mode: any tools, bigger problems",
  ]);
  expect(radios.map((r) => r.checked)).toEqual([false, true]);
  const shown = host.querySelector('[aria-hidden="true"]');
  expect(shown?.textContent).toBe("AI mode: any tools, bigger problems");
  expect(shown?.closest("label, fieldset")).toBeNull();
});
