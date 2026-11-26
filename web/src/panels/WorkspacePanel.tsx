import { useEffect, useMemo, useState, type ReactElement } from "react";
import type { ChainClient } from "../chain";

/**
 * The workspace as a library, not an editor bolted onto a sync loop.
 *
 * The panel owns no fetching: the listing, the preview and the download target
 * all arrive as props, and a click leaves through `onSelect`. That keeps it
 * renderable without a socket (the tests prove exactly that) and leaves the
 * single writer of the chain in the parent, where it belongs.
 */

/** One row in the library; the shape `listWorkspace` returns. */
export interface WorkspaceEntryView {
  path: string;
  bytes: number;
  kind: string;
}

/** What a preview of one file shows. */
export interface WorkspacePreview {
  path: string;
  text: string;
  /** Type the daemon reported, e.g. `text/csv`. */
  mime?: string;
  /** True when the file is not text: the panel says so instead of mojibake. */
  binary?: boolean;
  /** True when the read stopped at the size cap. */
  truncated?: boolean;
}

export interface WorkspacePanelProps {
  /** Everything the library holds, already sorted by the daemon. */
  files: readonly WorkspaceEntryView[];
  /** The open file's text, or null when nothing is open. */
  selected?: WorkspacePreview | null;
  /** Line from the parent, e.g. why a read was refused. */
  status?: string | null;
  /** A read is in flight; the list and the preview keep their last state. */
  busy?: boolean;
  /** A row was clicked. The parent reads the file and hands back `selected`. */
  onSelect: (path: string) => void;
  /** Ask for a fresh listing; omitted when the parent has nothing to refresh. */
  onRefresh?: () => void;
  /** Where an edited preview goes; without it the preview is read-only. */
  onSave?: (path: string, text: string) => void;
  /**
   * The download target for a path, or null when no target exists yet. A `data:`
   * or blob URL is enough; the panel only renders the link it is handed.
   */
  downloadHref?: (path: string) => string | null;
}

function bytesLabel(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function textBytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

function fileName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

export function WorkspacePanelView({
  files,
  selected = null,
  status = null,
  busy = false,
  onSelect,
  onRefresh,
  onSave,
  downloadHref,
}: WorkspacePanelProps): ReactElement {
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<string | null>(null);

  // A different file opens a different draft; no stale text carries over.
  useEffect(() => {
    setDraft(null);
  }, [selected?.path]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return files;
    return files.filter((file) => file.path.toLowerCase().includes(needle));
  }, [files, query]);

  const editable = selected !== null && onSave !== undefined && selected.binary !== true;
  const href = selected !== null && downloadHref !== undefined ? downloadHref(selected.path) : null;

  return (
    <section className="panel">
      <header className="panel__head">
        <h2 className="panel__title">Workspace</h2>
        {onRefresh !== undefined ? (
          <button type="button" className="rail__button" onClick={onRefresh}>
            Refresh
          </button>
        ) : null}
      </header>

      <input
        className="panel__input"
        placeholder="Search files"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      {status !== null ? <p className="panel__status">{status}</p> : null}

      <div className="panel__split">
        <ul className="panel__list">
          {shown.length === 0 ? (
            <li className="panel__empty">{busy ? "Loading the workspace…" : "No files yet."}</li>
          ) : null}
          {shown.map((file) =>
            file.kind === "dir" ? (
              <li key={file.path} className="panel__row panel__row--static">
                <div>
                  <div className="panel__path">{file.path}/</div>
                  <div className="panel__sub">folder</div>
                </div>
              </li>
            ) : (
              <li key={file.path}>
                <button
                  type="button"
                  className={file.path === selected?.path ? "panel__row panel__row--active" : "panel__row"}
                  aria-label={`Open ${file.path}`}
                  onClick={() => onSelect(file.path)}
                >
                  <span className="panel__path">{file.path}</span>
                  <span className="panel__size">{bytesLabel(file.bytes)}</span>
                </button>
              </li>
            ),
          )}
        </ul>

        {selected !== null ? (
          <div className="panel__editor">
            <div className="panel__file">{selected.path}</div>
            <div className="panel__sub">
              {selected.mime ?? "unknown type"} · {bytesLabel(textBytes(selected.text))}
            </div>

            {href !== null ? (
              <a className="panel__link" href={href} download={fileName(selected.path)}>
                Download {fileName(selected.path)}
              </a>
            ) : null}

            {selected.binary === true ? (
              <p className="panel__sub">Binary file — download it to open.</p>
            ) : selected.truncated === true ? (
              <p className="panel__sub">Preview stopped at the size cap.</p>
            ) : null}

            {selected.binary === true ? null : editable ? (
              <>
                <textarea
                  className="panel__code"
                  value={draft ?? selected.text}
                  spellCheck={false}
                  aria-label={`Edit ${selected.path}`}
                  onChange={(event) => setDraft(event.target.value)}
                />
                <button
                  type="button"
                  className="panel__primary"
                  disabled={busy}
                  onClick={() => onSave(selected.path, draft ?? selected.text)}
                >
                  Save
                </button>
              </>
            ) : (
              <pre className="panel__code">{selected.text}</pre>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}

interface ConnectedProps {
  client: ChainClient;
}

interface ListedFile {
  path: string;
  bytes: number;
  kind?: string;
}

/**
 * The connector the app mounts: it asks the daemon for the listing and one
 * file's text, and hands both to the props-only panel above. All of the safety
 * lives in the daemon's own reads (`listWorkspace`/`readWorkspaceFile`); this
 * layer adds no second path check that could disagree with the first.
 */
export function WorkspacePanelConnected({ client }: ConnectedProps): ReactElement {
  const [files, setFiles] = useState<ListedFile[]>([]);
  const [selected, setSelected] = useState<WorkspacePreview | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh(): Promise<void> {
    const answer = await client.request<{ files?: ListedFile[]; error?: string }>("workspace_list");
    if (answer.error !== undefined) setStatus(answer.error);
    setFiles(answer.files ?? []);
  }

  useEffect(() => {
    void refresh();
  }, [client]);

  async function open(path: string): Promise<void> {
    setBusy(true);
    setStatus(null);
    const answer = await client.request<{ content?: string; mime?: string; error?: string }>("workspace_read", { path });
    setBusy(false);
    if (answer.error !== undefined) {
      setStatus(answer.error);
      return;
    }
    const mime = answer.mime ?? "application/octet-stream";
    setSelected({
      path,
      text: answer.content ?? "",
      mime,
      binary: !mime.startsWith("text/") && mime !== "application/json",
    });
  }

  async function save(path: string, text: string): Promise<void> {
    setBusy(true);
    const answer = await client.request<{ ok?: boolean; error?: string }>("workspace_write", { path, content: text });
    setBusy(false);
    setStatus(answer.error ?? "saved — the other devices get it within seconds");
    setSelected((current) => (current === null ? current : { ...current, text }));
    await refresh();
  }

  // Only text already in hand can be offered for download; anything else has no
  // honest target until the daemon serves one.
  function downloadHref(path: string): string | null {
    if (selected === null || selected.path !== path || selected.binary === true) return null;
    return `data:${selected.mime ?? "text/plain"};charset=utf-8,${encodeURIComponent(selected.text)}`;
  }

  return (
    <WorkspacePanelView
      files={files.map((file) => ({ path: file.path, bytes: file.bytes, kind: file.kind ?? "file" }))}
      selected={selected}
      status={status}
      busy={busy}
      onSelect={(path) => void open(path)}
      onRefresh={() => void refresh()}
      onSave={(path, text) => void save(path, text)}
      downloadHref={downloadHref}
    />
  );
}

/**
 * The mounted panel. Given a `client` it connects itself (the app's current
 * mount, kept so the shell needs no change); given data it renders the same
 * component with no socket at all, which is the shape new callers should use.
 */
export function WorkspacePanel(props: WorkspacePanelProps | ConnectedProps): ReactElement {
  if ("client" in props) return <WorkspacePanelConnected client={props.client} />;
  return <WorkspacePanelView {...props} />;
}
