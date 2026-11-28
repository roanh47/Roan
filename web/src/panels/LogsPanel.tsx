import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";

/**
 * Logs: what this device's Roan wrote while it worked.
 *
 * The one page about a single device: a log is what happened on this
 * machine. Filter it by a word, or show only the lines that report a problem.
 */
const PROBLEM = /error|failed|refused|unreachable|cannot|could not/i;

export function filterLog(text: string, query: string, problemsOnly: boolean): string[] {
  const needle = query.trim().toLowerCase();
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .filter((line) => (needle.length === 0 ? true : line.toLowerCase().includes(needle)))
    .filter((line) => (problemsOnly ? PROBLEM.test(line) : true));
}

export function LogsPanel({ url }: { url: string }): ReactElement {
  const [text, setText] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [problemsOnly, setProblemsOnly] = useState(false);

  const load = useCallback((): void => {
    void fetch(url)
      .then((response) => response.text())
      .then((body) => {
        setText(body);
        setStatus(null);
      })
      .catch((error: unknown) => {
        setStatus(`cannot read the log: ${error instanceof Error ? error.message : String(error)}`);
      });
  }, [url]);

  useEffect(() => {
    load();
  }, [load]);

  const lines = useMemo(() => filterLog(text ?? "", query, problemsOnly), [text, query, problemsOnly]);

  return (
    <section className="panel">
      <header className="panel__head">
        <h2 className="panel__title">Logs</h2>
      </header>
      <p className="panel__sub">What Roan on this device wrote while it worked. Newest at the bottom.</p>
      {status !== null ? <p className="panel__status">{status}</p> : null}
      <input
        className="panel__input"
        aria-label="Filter the log"
        placeholder="Filter by a word"
        value={query}
        spellCheck={false}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          className={problemsOnly ? "panel__primary" : "panel__secondary"}
          aria-pressed={problemsOnly}
          onClick={() => setProblemsOnly((value) => !value)}
        >
          Problems only
        </button>
        <button type="button" className="panel__secondary" onClick={load}>
          Refresh
        </button>
      </div>
      {text === null && status === null ? <p className="panel__sub">Loading…</p> : null}
      {text !== null && lines.length === 0 ? <p className="panel__empty">No lines match.</p> : null}
      {lines.length > 0 ? (
        <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0, fontSize: 12.5, lineHeight: 1.45 }}>
          {lines.slice(-400).join("\n")}
        </pre>
      ) : null}
    </section>
  );
}

export default LogsPanel;
