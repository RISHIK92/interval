"use client";

import { useEffect, useRef, useState } from "react";

// P5-W31-S03 (Q-P5-10): Monaco, served by this app from /monaco/vs (copied from the
// pinned monaco-editor by `pnpm monaco`), loaded on the battle page only. Syntax
// highlighting, no language servers. It uses Monaco's prebuilt AMD bundle, which carries
// its own workers and needs no bundler setup; Monaco marks it deprecated, so an upgrade
// past 0.57 means moving to its ESM build.

type Model = { getValue(): string; setValue(value: string): void };
type Editor = {
  getModel(): Model | null;
  onDidChangeModelContent(listener: () => void): void;
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

// packages/lld's language names are Monaco's own ids.
export type CodeEditorProps = {
  language: string;
  value: string;
  onChange: (value: string) => void;
};

export function CodeEditor({ language, value, onChange }: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<{ editor: Editor; monaco: Monaco } | null>(null);
  const [failed, setFailed] = useState(false);
  // The latest props, for the editor's listener (attached once) and for its creation,
  // which can finish after the player has already switched language.
  const latest = useRef({ language, value, onChange });
  useEffect(() => {
    latest.current = { language, value, onChange };
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
        made.onDidChangeModelContent(() => {
          latest.current.onChange(made.getModel()?.getValue() ?? "");
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
