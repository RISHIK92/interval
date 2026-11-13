"use client";

import { useEffect, useRef, useState } from "react";

// P5-W31-S03 (Q-P5-10): Monaco, served by this app from /monaco/vs (copied from the
// pinned monaco-editor by `pnpm monaco`), loaded on the battle page only. Syntax
// highlighting, no language servers. It uses Monaco's prebuilt AMD bundle, which carries
// its own workers and needs no bundler setup; Monaco marks it deprecated, so an upgrade
// past 0.57 means moving to its ESM build.

type Position = { lineNumber: number; column: number };
type Range = {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
};
type Model = {
  getValue(): string;
  setValue(value: string): void;
  getOffsetAt(position: Position): number;
};
type Editor = {
  getModel(): Model | null;
  onDidChangeModelContent(
    listener: (e: {
      changes: { rangeOffset: number; rangeLength: number }[];
    }) => void,
  ): void;
  onDidPaste(listener: (e: { range: Range }) => void): void;
  dispose(): void;
};
type Monaco = {
  editor: {
    create(el: HTMLElement, options: Record<string, unknown>): Editor;
    setModelLanguage(model: Model, language: string): void;
  };
};
type AmdRequire = {
  (deps: string[], ready: (monaco: Monaco) => void): void;
  config(options: { paths: Record<string, string> }): void;
};

let loading: Promise<Monaco> | null = null;

function loadMonaco(): Promise<Monaco> {
  loading ??= new Promise<Monaco>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/monaco/vs/loader.js";
    script.onload = () => {
      const amd = (window as unknown as { require?: AmdRequire }).require;
      if (amd === undefined) {
        reject(new Error("monaco: no loader"));
        return;
      }
      amd.config({ paths: { vs: "/monaco/vs" } });
      amd(["vs/editor/editor.main"], resolve);
    };
    script.onerror = () => {
      script.remove();
      reject(new Error("monaco: not served; run pnpm monaco"));
    };
    document.head.appendChild(script);
  });
  // A failed load is tried again by the next editor, not cached for the page's life.
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

// The text a content change took out of `before` (a cut, a delete, a replaced
// selection): Monaco's changes give only where and how long.
export function removedBy(
  before: string,
  changes: { rangeOffset: number; rangeLength: number }[],
): string[] {
  return changes
    .filter((c) => c.rangeLength > 0)
    .map((c) => before.slice(c.rangeOffset, c.rangeOffset + c.rangeLength));
}

// packages/lld's language names are Monaco's own ids.
export type CodeEditorProps = {
  language: string;
  value: string;
  onChange: (value: string) => void;
  // P5-W31-S04a: what was pasted, and what the editor already had: its content without
  // the paste, and the text recently cut or deleted from it (a move within the code).
  onPaste?: (pasted: string, had: string[]) => void;
};

export function CodeEditor({
  language,
  value,
  onChange,
  onPaste,
}: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<{ editor: Editor; monaco: Monaco } | null>(null);
  const [failed, setFailed] = useState(false);
  // The latest props, for the editor's listener (attached once) and for its creation,
  // which can finish after the player has already switched language.
  const latest = useRef({ language, value, onChange, onPaste });
  useEffect(() => {
    latest.current = { language, value, onChange, onPaste };
  });

  useEffect(() => {
    let disposed = false;
    loadMonaco()
      .then((monaco) => {
        if (disposed || host.current === null) return;
        const made = monaco.editor.create(host.current, {
          value: latest.current.value,
          language: latest.current.language,
          automaticLayout: true,
          minimap: { enabled: false },
          fontSize: 14,
          scrollBeyondLastLine: false,
        });
        // The content before each change, to keep what a change removed.
        let before = latest.current.value;
        const removed: string[] = [];
        made.onDidChangeModelContent(({ changes }) => {
          removed.push(...removedBy(before, changes));
          // shortcut: the last 20 removals only; a move from further back counts as a paste.
          removed.splice(0, Math.max(0, removed.length - 20));
          before = made.getModel()?.getValue() ?? "";
          latest.current.onChange(before);
        });
        made.onDidPaste(({ range }) => {
          const model = made.getModel();
          if (model === null) return;
          const all = model.getValue();
          const from = model.getOffsetAt({
            lineNumber: range.startLineNumber,
            column: range.startColumn,
          });
          const to = model.getOffsetAt({
            lineNumber: range.endLineNumber,
            column: range.endColumn,
          });
          latest.current.onPaste?.(all.slice(from, to), [
            all.slice(0, from) + all.slice(to),
            ...removed,
          ]);
        });
        editor.current = { editor: made, monaco };
      })
      .catch((error: unknown) => {
        console.error("battle: editor not loaded", error);
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
      editor.current?.editor.dispose();
      editor.current = null;
    };
    // The editor is made once; language and value changes go to its model below.
  }, []);

  useEffect(() => {
    const current = editor.current;
    const model = current?.editor.getModel();
    if (current === null || model === null || model === undefined) return;
    current.monaco.editor.setModelLanguage(model, language);
    if (model.getValue() !== value) model.setValue(value);
  }, [language, value]);

  if (failed)
    return (
      <p role="alert" className="text-ink-muted">
        The editor didn&apos;t load. Reload the page: your code is kept.
      </p>
    );
  return (
    <div
      ref={host}
      className="h-[60vh] min-h-80 w-full overflow-hidden rounded-md border border-line"
      aria-label={`Code editor (${language})`}
    />
  );
}
