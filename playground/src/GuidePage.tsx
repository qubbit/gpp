import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor, { type Monaco, type OnMount } from "@monaco-editor/react";
import type * as monacoTypes from "monaco-editor";

import { execute, type ExecuteResult } from "@gpp/gpp.js";
import { LANGUAGE_ID, registerGppLanguage } from "./gpp-language";
import { GUIDE, type GuideSnippet } from "./guide";

interface GuidePageProps {
  theme: "light" | "dark";
  // hands a program to the main playground, so a reader can keep working on it
  onOpenInPlayground: (source: string) => void;
}

export function GuidePage({ theme, onOpenInPlayground }: GuidePageProps) {
  const [active, setActive] = useState(GUIDE[0]!.id);

  // highlight the section currently on screen
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActive(visible.target.id);
      },
      // only count a section once its heading is near the top
      { rootMargin: "-80px 0px -60% 0px" },
    );

    for (const section of GUIDE) {
      const element = document.getElementById(section.id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <div className="guide">
      <nav className="guide-nav" aria-label="Guide sections">
        <div className="guide-nav-inner">
          <p className="guide-nav-title">Contents</p>
          <ol>
            {GUIDE.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className={active === section.id ? "current" : ""}
                >
                  {section.title}
                </a>
              </li>
            ))}
          </ol>
        </div>
      </nav>

      <main className="guide-body">
        <header className="guide-intro">
          <h1>The gpp guide</h1>
          <p>
            Every example below runs. Edit any of them and press Run — or Reset
            to put it back the way it was.
          </p>
        </header>

        {GUIDE.map((section) => (
          <section key={section.id} id={section.id} className="guide-section">
            <h2>{section.title}</h2>
            <p className="guide-blurb">{section.blurb}</p>

            {section.snippets.map((snippet) => (
              <Snippet
                key={snippet.title}
                snippet={snippet}
                theme={theme}
                onOpenInPlayground={onOpenInPlayground}
              />
            ))}
          </section>
        ))}

        <footer className="guide-footer">
          <p>
            That is the whole language. The playground has larger samples, an
            AST view and type checking.
          </p>
        </footer>
      </main>
    </div>
  );
}

interface SnippetProps {
  snippet: GuideSnippet;
  theme: "light" | "dark";
  onOpenInPlayground: (source: string) => void;
}

function Snippet({ snippet, theme, onOpenInPlayground }: SnippetProps) {
  const [source, setSource] = useState(snippet.source);
  const [result, setResult] = useState<ExecuteResult | null>(null);
  const editorRef = useRef<monacoTypes.editor.IStandaloneCodeEditor | null>(null);

  const edited = source !== snippet.source;

  const run = useCallback(() => {
    setResult(execute(source));
  }, [source]);

  const reset = () => {
    setSource(snippet.source);
    setResult(null);
  };

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      // read from the model rather than the closure, which may be stale
      setResult(execute(editor.getValue()));
    });
  };

  // size the editor to its content so every snippet shows in full
  const lineCount = useMemo(() => source.split("\n").length, [source]);
  const height = Math.min(Math.max(lineCount, 3) * 21 + 20, 520);

  return (
    <article className="snippet">
      <div className="snippet-head">
        <h3>{snippet.title}</h3>
        <div className="snippet-actions">
          {edited && (
            <button className="button small" onClick={reset} title="Restore the original example">
              Reset
            </button>
          )}
          <button
            className="button small"
            onClick={() => onOpenInPlayground(source)}
            title="Open this example in the full playground"
          >
            Open ↗
          </button>
          <button className="button small primary" onClick={run}>
            Run ▸
          </button>
        </div>
      </div>

      <p className="snippet-note">{snippet.note}</p>

      <div className="snippet-editor" style={{ height }}>
        <Editor
          language={LANGUAGE_ID}
          theme={theme === "dark" ? "gpp-dark" : "gpp-light"}
          value={source}
          onChange={(value) => setSource(value ?? "")}
          beforeMount={(monaco: Monaco) => registerGppLanguage(monaco)}
          onMount={handleMount}
          options={{
            fontFamily: '"SF Mono", "JetBrains Mono", Menlo, Consolas, monospace',
            fontSize: 13,
            lineHeight: 21,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            // the page scrolls, not each editor
            scrollbar: { alwaysConsumeMouseWheel: false, verticalScrollbarSize: 8 },
            padding: { top: 10, bottom: 10 },
            lineNumbersMinChars: 3,
            folding: false,
            renderLineHighlight: "none",
            overviewRulerLanes: 0,
            tabSize: 2,
            automaticLayout: true,
          }}
        />
      </div>

      {result && <SnippetResult result={result} />}
    </article>
  );
}

function SnippetResult({ result }: { result: ExecuteResult }) {
  return (
    <div className="snippet-result">
      {result.output.length > 0 && (
        <pre className="snippet-output">{result.output.join("\n")}</pre>
      )}

      {result.error && (
        <div className="snippet-error">
          <span className="error-stage">{result.error.stage} error</span>
          {result.error.message}
        </div>
      )}

      {result.typeErrors.length > 0 && (
        <ul className="snippet-types">
          {result.typeErrors.map((error, index) => (
            <li key={index}>
              <span className="type-error-position">
                {error.line}:{error.column}
              </span>{" "}
              {error.message}
            </li>
          ))}
        </ul>
      )}

      {!result.error &&
        result.typeErrors.length === 0 &&
        result.output.length === 0 && (
          <p className="snippet-output muted">ran without printing anything</p>
        )}
    </div>
  );
}
