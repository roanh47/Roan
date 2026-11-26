import { useEffect, useMemo, useState, useSyncExternalStore, type ReactElement } from "react";
import type { ChainClient } from "../chain";
import { buildTree } from "../../../src/workspace/tree.js";
import {
  FileExplorer,
  ROOT_LABELS,
  summariseEntries,
  type ExplorerEntry,
  type ExplorerNodeView,
  type ExplorerRoot,
  type PreviewLoader,
} from "./FileExplorer.js";

/**
 * The workspace as a library, not an editor bolted onto a sync loop.
 *
 * Two shapes live here:
 *
 *   `WorkspaceHost` — the real screen. It owns the frame around the explorer:
 *   the two roots, the summary line and the node sections. Every input is a
 *   prop, so the shell decides where the tree and the preview come from.
 *
 *   `WorkspacePanelView` — the original flat list. It stays because it is the
 *   props contract other callers already use, and because a list is still the
 *   right answer when there is no chain to group by.
 *
 * The connector asks the daemon for the synced listing and one file's text.
 * All of the safety lives in the daemon's own reads (`listWorkspace` /
 * `readWorkspaceFile`); this layer adds no second path check that could
 * disagree with the first.
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

/**
 * The host's contract: the tree `buildTree` returns, plus the one way to read
 * a file. Everything else is optional, so a shell can mount it with a `client`
 * and no state of its own.
 */
export interface WorkspaceHostProps {
  /** `buildTree(...).nodes`: this device first, then every node in the chain. */
  nodes: readonly ExplorerNodeView[];
  /** Node to open first; defaults to the first section (this device). */
  node?: string;
  /** This device's node id, for the "this device" tag. */
  self?: string;
  /** Root tab to open first. */
  root?: ExplorerRoot;
  onNodeChange?: (node: string) => void;
  onRootChange?: (root: ExplorerRoot) => void;
  /** Reads one file for the preview pane; the daemon's `workspace_read`. */
  loadPreview: PreviewLoader;
  status?: string | null;
  busy?: boolean;
  /** Ask for a fresh listing. */
  onRefresh?: () => void;
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

/**
 * The real workspace screen: the two roots, one honest line about the whole
 * library, and the explorer. The summary is counted from the same rows the
 * explorer renders — no second accounting that can drift.
 */
export function WorkspaceHost({
  nodes,
  node,
  self,
  root,
  onNodeChange,
  onRootChange,
  loadPreview,
  status = null,
  busy = false,
  onRefresh,
}: WorkspaceHostProps): ReactElement {
  const summaryNode = nodes.find((entry) => entry.node === (self ?? node)) ?? nodes[0] ?? null;
  const entries = summaryNode?.folders.flatMap((folder) => folder.entries) ?? [];
  const summary = summariseEntries(entries);

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

      <p className="panel__sub explorer__summary">
        {String(summary.files)} files · {String(summary.synced)} synced · {String(summary.conflicts)} conflicts
      </p>

      {summaryNode !== null ? (
        <p className="explorer__summaryroots">
          {summaryNode.folders.map((folder) => (
            <span key={folder.root} className="explorer__summaryroot">
              <span className="explorer__summaryrootname">{ROOT_LABELS[folder.root]}</span>
              <span className="explorer__count">
                {String(folder.entries.filter((entry) => entry.kind === "file").length)} files
              </span>
            </span>
          ))}
        </p>
      ) : null}

      <FileExplorer
        nodes={nodes}
        {...(node !== undefined ? { node } : {})}
        {...(self !== undefined ? { self } : {})}
        {...(root !== undefined ? { root } : {})}
        {...(onNodeChange !== undefined ? { onNodeChange } : {})}
        {...(onRootChange !== undefined ? { onRootChange } : {})}
        loadPreview={loadPreview}
        status={status}
        busy={busy}
      />
    </section>
  );
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
 * The connector the app mounts. It asks for the synced listing (the only root
 * this daemon lists today) and for one file's text, folds the chain's workspace
 * events into the tree with `buildTree`, and hands the result to the host.
 *
 * `workspace/` is marked unavailable rather than empty: this daemon has no
 * frame that lists it, and an empty folder would claim it holds nothing.
 */
export function WorkspacePanelConnected({ client }: ConnectedProps): ReactElement {
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const [listed, setListed] = useState<ListedFile[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setBusy(true);
    void client
      .request<{ files?: ListedFile[]; error?: string }>("workspace_list")
      .then((answer) => {
        if (!live) return;
        if (answer.error !== undefined) setStatus(answer.error);
        else setStatus(null);
        setListed(answer.files ?? []);
      })
      .catch((error: unknown) => {
        if (live) setStatus(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [client]);
  // Only `workspace` events matter, and the tree is expensive to build: filter
  // on every snapshot (cheap) but rebuild only when the chain's file events —
  // or the node ids — actually change, not on every streamed token.
  const workspaceEvents = useMemo(
    () => snapshot.events.filter((event) => event.type === "workspace"),
    [snapshot.events],
  );
  const workspaceStamp = useMemo(() => {
    let newest = 0;
    for (const event of workspaceEvents) if (event.seq > newest) newest = event.seq;
    return `${String(workspaceEvents.length)}:${String(newest)}`;
  }, [workspaceEvents]);

  const nodes = useMemo<ExplorerNodeView[]>(() => {
    const built = buildTree({
      workspace: [],
      synced: listed.map((file) => ({
        path: file.path,
        kind: file.kind === "dir" ? "dir" : "file",
        bytes: file.bytes,
      })),
      chainEvents: workspaceEvents,
      self: snapshot.node,
    });
    const names = new Map(snapshot.nodes.map((entry) => [entry.node, entry.name]));
    return built.nodes.map((entry) => ({
      node: entry.node,
      name: names.get(entry.node) ?? entry.node,
      folders: entry.folders.map((folder) =>
        folder.root === "workspace" && entry.node === snapshot.node
          ? { root: folder.root, entries: [], unavailable: true }
          : { root: folder.root, entries: folder.entries },
      ),
    }));
    // `workspaceStamp` stands in for `workspaceEvents`: same content, cheaper key.
  }, [listed, workspaceStamp, snapshot.node, snapshot.nodes]);

  const loadPreview: PreviewLoader = async ({ root, path }) => {
    if (root !== "synced") throw new Error("This daemon only reads workspace/synced.");
    const answer = await client.request<{
      content?: string;
      mime?: string;
      path?: string;
      error?: string;
    }>("workspace_read", { path });
    if (answer.error !== undefined) throw new Error(answer.error);
    const mime = answer.mime ?? "application/octet-stream";
    return {
      path: answer.path ?? path,
      text: answer.content ?? "",
      mime,
      binary: !mime.startsWith("text/") && mime !== "application/json",
    };
  };

  return (
    <WorkspaceHost
      nodes={nodes}
      self={snapshot.node}
      node={snapshot.node}
      loadPreview={loadPreview}
      status={status}
      busy={busy}
    />
  );
}

/**
 * The mounted panel. Given a `client` it connects itself (the app's current
 * mount, kept so the shell needs no change); given `nodes` it renders the host
 * with the data it was handed; given the flat `files` props it renders the
 * original list.
 */
export function WorkspacePanel(
  props: WorkspacePanelProps | WorkspaceHostProps | ConnectedProps,
): ReactElement {
  if ("client" in props) return <WorkspacePanelConnected client={props.client} />;
  if ("nodes" in props) return <WorkspaceHost {...props} />;
  return <WorkspacePanelView {...props} />;
}

export type { ExplorerEntry, ExplorerNodeView, ExplorerRoot, PreviewLoader };
