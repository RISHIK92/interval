// @vitest-environment jsdom
import type { BattleState } from "@interval/game-client";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";
import { BattleView } from "./BattlePlay";
import { type CodeEditorProps, showLine } from "./CodeEditor";

// Q-WD-17: "Jump to line" moves the editor's cursor to the failing line, shows it and
// highlights it until the next edit or run.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const editor: {
  jump: CodeEditorProps["jump"];
  onChange: (value: string) => void;
} = { jump: null, onChange: () => undefined };
function Editor({ jump, onChange }: CodeEditorProps) {
  useEffect(() => {
    editor.jump = jump;
    editor.onChange = onChange;
  });
  return <textarea aria-label="code" readOnly />;
}

const failing: BattleState = {
  phase: "playing",
  you: "ada",
  endsAt: 60_000,
  practice: false,
  extension: null,
  best: { ada: 0 },
  progress: {},
  hints: null,
  ran: [{ passed: false, verdict: "ok", name: "Test 1" }],
  submitted: null,
  failing: { name: "Test 1", message: "call 1 (get): got 2", line: 14 },
  running: false,
  submitting: false,
  notice: null,
};

test("the link jumps to the line, and an edit or a run clears it", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const render = (state: BattleState) => {
    root.render(view(state));
  };
  const view = (state: BattleState) => (
    <BattleView
      resultHref="/play/battle/m1/result"
      heading={<h1>LRU cache</h1>}
      signatures={[]}
      state={state}
      failed={false}
      statement="# LRU cache"
      examples={[]}
      languages={["python"]}
      language="python"
      code="class LRUCache: ..."
      now={1_000}
      Editor={Editor}
      onLanguage={() => undefined}
      onCode={() => undefined}
      onPaste={() => undefined}
      onSend={() => undefined}
    />
  );
  act(() => {
    render(failing);
  });
  const link = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === "Jump to line 14",
  );
  if (link === undefined) throw new Error("no Jump to line");
  expect(link.getAttribute("aria-label")).toBe("Jump to line 14 of your code");
  expect(editor.jump).toBeNull();
  act(() => {
    link.click();
  });
  expect(editor.jump?.line).toBe(14);
  act(() => {
    editor.onChange("class LRUCache: pass");
  });
  expect(editor.jump).toBeNull();
  act(() => {
    link.click();
  });
  expect(editor.jump?.line).toBe(14);
  // A Run out (by its button or Ctrl+Enter) clears it, even one then refused; its
  // answer has a failing test of its own, not yet jumped to.
  act(() => {
    render({ ...failing, running: true });
  });
  expect(editor.jump).toBeNull();
  act(() => {
    render({ ...failing, notice: "wait 5 s" });
  });
  expect(editor.jump).toBeNull();
  act(() => {
    render({
      ...failing,
      failing: { name: "Test 1", message: "call 1 (get): got 3", line: 14 },
    });
  });
  expect(editor.jump).toBeNull();
  act(() => {
    root.unmount();
  });
  host.remove();
});

test("showLine puts the cursor on the line, shows it, highlights it, and focuses", () => {
  const calls: string[] = [];
  let cleared = false;
  const fake = {
    getModel: () => ({
      getLineCount: () => 20,
      getLineFirstNonWhitespaceColumn: (line: number) => (line === 14 ? 5 : 0),
    }),
    setPosition: (p: { lineNumber: number; column: number }) => {
      calls.push(`position ${String(p.lineNumber)}:${String(p.column)}`);
    },
    revealLineInCenter: (line: number) => {
      calls.push(`reveal ${String(line)}`);
    },
    createDecorationsCollection: (
      d: { range: unknown; options: { isWholeLine: boolean } }[],
    ) => {
      calls.push(`highlight ${JSON.stringify(d[0]?.range)}`);
      return {
        clear: () => {
          cleared = true;
        },
      };
    },
    focus: () => {
      calls.push("focus");
    },
  };
  class Range {
    constructor(
      readonly startLineNumber: number,
      readonly startColumn: number,
      readonly endLineNumber: number,
      readonly endColumn: number,
    ) {}
  }
  const shown = showLine(fake, Range, 14);
  expect(calls).toEqual([
    "position 14:5",
    "reveal 14",
    'highlight {"startLineNumber":14,"startColumn":1,"endLineNumber":14,"endColumn":1}',
    "focus",
  ]);
  shown?.clear();
  expect(cleared).toBe(true);
  // A line past the code (it has changed since the run): its last line.
  calls.length = 0;
  showLine(fake, Range, 99);
  expect(calls[0]).toBe("position 20:1");
});

test("the link shows only while the editor has the language that was judged", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const view = (state: BattleState, language: string) => (
    <BattleView
      resultHref="/play/battle/m1/result"
      heading={<h1>LRU cache</h1>}
      signatures={[]}
      state={state}
      failed={false}
      statement="# LRU cache"
      examples={[]}
      languages={["python", "go"]}
      language={language}
      code=""
      now={1_000}
      Editor={Editor}
      onLanguage={() => undefined}
      onCode={() => undefined}
      onPaste={() => undefined}
      onSend={() => undefined}
    />
  );
  act(() => {
    root.render(view({ ...failing, failing: null, running: true }, "python"));
  });
  act(() => {
    root.render(view(failing, "python"));
  });
  expect(host.textContent).toContain("Jump to line 14");
  act(() => {
    root.render(view(failing, "go"));
  });
  expect(host.textContent).toContain("Test 1");
  expect(host.textContent).not.toContain("Jump to line");
  act(() => {
    root.unmount();
  });
  host.remove();
});
