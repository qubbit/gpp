import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor, { type Monaco, type OnMount } from "@monaco-editor/react";
import type * as monacoTypes from "monaco-editor";

import { execute, type ExecuteResult } from "@gpp/gpp.js";
import { LANGUAGE_ID, registerGppLanguage } from "./gpp-language";
import { AstView } from "./AstView";
import { DEFAULT_SAMPLE, SAMPLES } from "./samples";
import { buildShareUrl, readSourceFromUrl, updateUrl } from "./share";

type RightPane = "output" | "ast" | "types";
type Theme = "light" | "dark";

const THEME_KEY = "gpp-playground-theme";

export default function App() {
  // a shared link wins over the default sample
  const [source, setSource] = useState(
    () => readSourceFromUrl() ?? DEFAULT_SAMPLE.source,
  );
  const [result, setResult] = useState<ExecuteResult | null>(null);
  const [pane, setPane] = useState<RightPane>("output");
  const [theme, setTheme] = useState<Theme>(readStoredTheme);
  const [toast, setToast] = useState<string | null>(null);
  const [sampleId, setSampleId] = useState<string>(() =>
    readSourceFromUrl() ? "" : DEFAULT_SAMPLE.id,
  );

  const editorRef = useRef<monacoTypes.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  // a toast is transient; clear it after a moment
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(timer);
  }, [toast]);

  // keep the url in step with the editor, debounced so typing stays cheap
  useEffect(() => {
    const timer = setTimeout(() => updateUrl(source), 400);
    return () => clearTimeout(timer);
  }, [source]);

  const runProgram = useCallback(() => {
    const next = execute(source);
    setResult(next);
    // an error is easier to notice in the output pane
    if (next.error) setPane("output");
  }, [source]);

  // run once on load so the preloaded sample shows output immediately
  useEffect(() => {
    runProgram();
    // deliberately only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // opening a shared link in an already loaded tab only changes the hash, which
  // does not remount. pick the new program up rather than ignoring it.
  useEffect(() => {
    const onHashChange = () => {
      const shared = readSourceFromUrl();
      // ignore the hash we just wrote ourselves
      if (shared === null || shared === source) return;
      setSource(shared);
      setSampleId("");
      setResult(execute(shared));
    };

    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [source]);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    // cmd/ctrl+enter runs, matching every other playground
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, runProgram);
  };

  const beforeMount = (monaco: Monaco) => {
    registerGppLanguage(monaco);
  };

  // surface lex, parse and type errors as squiggles on the offending line
  useEffect(() => {
    const monaco = monacoRef.current;
    const editor = editorRef.current;
    if (!monaco || !editor) return;

    const model = editor.getModel();
    if (!model) return;

    const markers: monacoTypes.editor.IMarkerData[] = [];

    const error = result?.error;
    if (error && error.line > 0) {
      markers.push({
        severity: monaco.MarkerSeverity.Error,
        message: error.message,
        startLineNumber: error.line,
        startColumn: error.column,
        endLineNumber: error.line,
        endColumn: error.column + 1,
      });
    }

    // type errors are advisory, so they show as warnings rather than errors
    for (const typeError of result?.typeErrors ?? []) {
      markers.push({
        severity: monaco.MarkerSeverity.Warning,
        message: typeError.message,
        startLineNumber: typeError.line,
        startColumn: typeError.column,
        endLineNumber: typeError.line,
        endColumn: typeError.column + 1,
      });
    }

    monaco.editor.setModelMarkers(model, LANGUAGE_ID, markers);
  }, [result]);

  const selectSample = (id: string) => {
    const sample = SAMPLES.find((item) => item.id === id);
    if (!sample) return;
    setSampleId(id);
    setSource(sample.source);
    // run the new sample rather than leaving stale output on screen
    setResult(execute(sample.source));
    setPane("output");
  };

  const share = async () => {
    const url = buildShareUrl(source);
    try {
      await navigator.clipboard.writeText(url);
      setToast("Share link copied");
    } catch {
      // clipboard access can be denied; the url is in the address bar anyway
      updateUrl(source);
      setToast("Link is in the address bar");
    }
  };

  const revealPosition = (line: number, column: number) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.revealPositionInCenter({ lineNumber: line, column });
    editor.setPosition({ lineNumber: line, column });
    editor.focus();
  };

  const activeSample = useMemo(
    () => SAMPLES.find((item) => item.id === sampleId),
    [sampleId],
  );

  const typeErrorCount = result?.typeErrors.length ?? 0;

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <h1>gpp</h1>
          <span className="tagline">
            {activeSample?.description ?? "A small language, in your browser"}
          </span>
        </div>

        <div className="toolbar">
          <select
            className="select"
            value={sampleId}
            onChange={(event) => selectSample(event.target.value)}
            aria-label="Load a sample program"
          >
            {!sampleId && <option value="">Shared program</option>}
            {SAMPLES.map((sample) => (
              <option key={sample.id} value={sample.id}>
                {sample.name}
              </option>
            ))}
          </select>

          <button className="button" onClick={share}>
            Share
          </button>

          <button
            className="button icon"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          >
            {theme === "dark" ? "☀" : "☾"}
          </button>

          <button className="button primary" onClick={runProgram}>
            Run ▸
          </button>
        </div>
      </header>

      <main className="workspace">
        <section className="pane">
          <div className="pane-header">
            <span className="pane-title">Editor</span>
            <span className="ast-position">⌘/Ctrl + ↵</span>
          </div>
          <div className="pane-body">
            <div className="editor-host">
              <Editor
                language={LANGUAGE_ID}
                theme={theme === "dark" ? "gpp-dark" : "gpp-light"}
                value={source}
                onChange={(value) => setSource(value ?? "")}
                beforeMount={beforeMount}
                onMount={handleMount}
                options={{
                  fontFamily:
                    '"SF Mono", "JetBrains Mono", Menlo, Consolas, monospace',
                  fontSize: 13.5,
                  lineHeight: 1.7,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  smoothScrolling: true,
                  padding: { top: 14, bottom: 14 },
                  renderLineHighlight: "line",
                  tabSize: 2,
                  automaticLayout: true,
                  bracketPairColorization: { enabled: true },
                  scrollbar: { verticalScrollbarSize: 10 },
                }}
              />
            </div>
          </div>
        </section>

        <section className="pane">
          <div className="pane-header">
            <span className="pane-title">
              {pane === "output"
                ? "Output"
                : pane === "ast"
                  ? "Syntax tree"
                  : "Types"}
            </span>
            <div className="tabs" role="tablist">
              <button
                className="tab"
                role="tab"
                aria-selected={pane === "output"}
                onClick={() => setPane("output")}
              >
                Output
              </button>
              <button
                className="tab"
                role="tab"
                aria-selected={pane === "ast"}
                onClick={() => setPane("ast")}
              >
                AST
              </button>
              <button
                className="tab"
                role="tab"
                aria-selected={pane === "types"}
                onClick={() => setPane("types")}
              >
                Types
                {typeErrorCount > 0 && (
                  <span className="tab-badge">{typeErrorCount}</span>
                )}
              </button>
            </div>
          </div>

          <div className="pane-body">
            {pane === "output" ? (
              <OutputPane result={result} />
            ) : pane === "types" ? (
              <TypesPane result={result} onSelect={revealPosition} />
            ) : result?.ast ? (
              <AstView node={result.ast} onSelect={revealPosition} />
            ) : (
              <p className="placeholder">
                The program did not parse, so there is no tree to show.
              </p>
            )}
          </div>

          <StatusBar result={result} />
        </section>
      </main>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function OutputPane({ result }: { result: ExecuteResult | null }) {
  if (!result) {
    return <p className="placeholder">Press Run to execute the program.</p>;
  }

  return (
    <>
      {result.output.length > 0 && (
        <pre className="output">
          {result.output.map((line, index) => (
            <div className="output-line" key={index}>
              <span className="output-gutter">{index + 1}</span>
              <span>{line}</span>
            </div>
          ))}
        </pre>
      )}

      {result.error && (
        <div className="error-box">
          <div className="error-stage">{result.error.stage} error</div>
          {result.error.message}
        </div>
      )}

      {!result.error && result.output.length === 0 && (
        <p className="placeholder">
          The program ran without printing anything.
        </p>
      )}
    </>
  );
}

function TypesPane({
  result,
  onSelect,
}: {
  result: ExecuteResult | null;
  onSelect: (line: number, column: number) => void;
}) {
  if (!result) {
    return <p className="placeholder">Press Run to check the program.</p>;
  }

  if (!result.ast) {
    return (
      <p className="placeholder">
        The program did not parse, so it could not be checked.
      </p>
    );
  }

  if (result.typeErrors.length === 0) {
    return (
      <p className="placeholder">
        No type errors.
        <br />
        <span className="placeholder-hint">
          gpp is gradually typed: add annotations to check more.
        </span>
      </p>
    );
  }

  return (
    <ul className="type-errors">
      {result.typeErrors.map((error, index) => (
        <li key={index}>
          <button
            className="type-error"
            onClick={() => onSelect(error.line, error.column)}
          >
            <span className="type-error-position">
              {error.line}:{error.column}
            </span>
            <span>{error.message}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function StatusBar({ result }: { result: ExecuteResult | null }) {
  if (!result) return <div className="status">Ready</div>;

  return (
    <div className="status">
      <span className={result.error ? "bad" : "ok"}>
        {result.error ? `${result.error.stage} error` : "ran cleanly"}
      </span>
      <span>
        {result.output.length} line{result.output.length === 1 ? "" : "s"}
      </span>
      {result.typeErrors.length > 0 && (
        <span className="warn">
          {result.typeErrors.length} type{" "}
          {result.typeErrors.length === 1 ? "error" : "errors"}
        </span>
      )}
      {result.ast && <span>{result.ast.body.length} statements</span>}
    </div>
  );
}

function readStoredTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}
