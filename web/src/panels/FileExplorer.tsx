import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactElement } from "react";

/**
 * The workspace as a browser: two roots, one section per node, a breadcrumb,
 * rows with a sync state, and a preview of the file you opened.
 *
 * Props only. The listing is the orchestrator's (built by `buildTree`), the
 * file text arrives through `loadPreview` — in production that is the daemon's
 * `workspace_read`, in a test it is a function that answers with a string. The
 * component never fetches, never hashes and never decides what is safe to read:
 * `readWorkspaceFile` in the daemon is the only gate, and this panel must not
 * invent a second one that could disagree.
 *
 * Colours come from CSS custom properties on the chip classes, so the five
 * states are legible without this file knowing any hex value.
 */

export type ExplorerStatus = "synced" | "local" | "pending" | "conflict" | "remote";
export type ExplorerRoot = "workspace" | "synced";

/** One row: the shape `buildTree` returns. */
export interface ExplorerEntry {
  readonly path: string;
  readonly kind: "file" | "dir";
  readonly bytes: number;
  readonly status: ExplorerStatus;
}

export interface ExplorerFolder {
  readonly root: ExplorerRoot;
  readonly entries: readonly ExplorerEntry[];
  /** The daemon cannot list this root yet; an empty folder would be a lie. */
  readonly unavailable?: boolean;
}

/** A node and its folders; `name` is the display name when the chain has one. */
export interface ExplorerNodeView {
  readonly node: string;
  readonly name?: string;
  readonly folders: readonly ExplorerFolder[];
}

/** What one file's preview shows. Mirrors the daemon's `workspace_read` reply. */
export interface ExplorerPreview {
  readonly path: string;
  readonly text: string;
  readonly mime?: string;
  readonly binary?: boolean;
  readonly truncated?: boolean;
}

export interface PreviewRequest {
  readonly node: string;
  readonly root: ExplorerRoot;
  readonly path: string;
}

/** Where a preview comes from; may answer synchronously or with a promise. */
export type PreviewLoader = (request: PreviewRequest) => Promise<ExplorerPreview> | ExplorerPreview;

export interface FileExplorerProps {
  /** This device first, then every other node in the chain. */
  readonly nodes: readonly ExplorerNodeView[];
  /** Node whose section opens first; defaults to the first entry (this device). */
  readonly node?: string;
  /** This device's id, for the "this device" tag. */
  readonly self?: string;
  /** Root tab that opens first; defaults to the first folder the node has. */
  readonly root?: ExplorerRoot;
  readonly onNodeChange?: (node: string) => void;
  readonly onRootChange?: (root: ExplorerRoot) => void;
  /** Reads one file for the preview pane. */
  readonly loadPreview: PreviewLoader;
  /** A line from the parent, e.g. why a read was refused. */
  readonly status?: string | null;
  /** A read is in flight; the last preview keeps its place. */
  readonly busy?: boolean;
}

/** The root labels the host and the explorer both use. */
export const ROOT_LABELS: Readonly<Record<ExplorerRoot, string>> = {
  workspace: "workspace",
  synced: "workspace/synced",
};
const ROOT_LABEL = ROOT_LABELS;

type PreviewState =
  | { readonly state: "idle" }
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly value: ExplorerPreview }
  | { readonly state: "error"; readonly message: string };

function bytesLabel(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function nameOf(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

/** The folder a path sits in; "" is the root. */
function parentOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? "" : path.slice(0, cut);
}

/**
 * Direct children of `folder`, folders first and then by name. Sorting here
 * (not in the tree) keeps the flat path order the tree promises for diffing
 * while the pane reads the way a file manager does.
 */
export function childrenOf(entries: readonly ExplorerEntry[], folder: string): ExplorerEntry[] {
  return entries
    .filter((entry) => parentOf(entry.path) === folder)
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
      return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
    });
}

/** The host's summary line, counted from the same rows the explorer shows. */
export function summariseEntries(entries: readonly ExplorerEntry[]): {
  files: number;
  synced: number;
  conflicts: number;
} {
  let files = 0;
  let synced = 0;
  let conflicts = 0;
  for (const entry of entries) {
    // A conflict copy is a second copy of a file already counted at its base.
    if (entry.kind !== "file" || entry.path.includes(".conflict-")) continue;
    files += 1;
    if (entry.status === "synced") synced += 1;
    if (entry.status === "conflict") conflicts += 1;
  }
  return { files, synced, conflicts };
}

/** The type-and-size line above a preview, or null when nothing is in hand. */
function previewMeta(preview: PreviewState, busy: boolean): string | null {
  if (preview.state === "ready") {
    const size = new TextEncoder().encode(preview.value.text).length;
    return `${preview.value.mime ?? "unknown type"} · ${bytesLabel(size)}`;
  }
  if (busy || preview.state === "loading") return "reading…";
  return null;
}

export function FileExplorer({
  nodes,
  node,
  self,
  root,
  onNodeChange,
  onRootChange,
  loadPreview,
  status = null,
  busy = false,
}: FileExplorerProps): ReactElement {
  const [pickedNode, setPickedNode] = useState<string | null>(null);
  const [pickedRoot, setPickedRoot] = useState<ExplorerRoot | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [cwd, setCwd] = useState("");
  const [cursor, setCursor] = useState(0);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState>({ state: "idle" });
  const requestToken = useRef(0);

  const wantedNode = pickedNode ?? node;
  const activeNodeId = nodes.some((entry) => entry.node === wantedNode)
    ? (wantedNode as string)
    : (nodes[0]?.node ?? "");
  const activeNode = nodes.find((entry) => entry.node === activeNodeId) ?? null;
  const folders = activeNode?.folders ?? [];
  // The synced root is the shared one; open there unless the caller asked for
  // the local desk or the node only has that.
  const activeFolder =
    folders.find((entry) => entry.root === (pickedRoot ?? root)) ??
    folders.find((entry) => entry.root === "synced") ??
    folders[0] ??
    null;
  const activeRoot: ExplorerRoot = activeFolder?.root ?? "synced";
  const entries = activeFolder?.entries ?? [];
  const rows = childrenOf(entries, cwd);
  const activeCursor = Math.min(cursor, Math.max(rows.length - 1, 0));

  // A different node or root is a different folder: no stale path or preview.
  useEffect(() => {
    setCwd("");
    setCursor(0);
    setOpenPath(null);
    setPreview({ state: "idle" });
    requestToken.current += 1;
  }, [activeNodeId, activeRoot]);

  function chooseRoot(next: ExplorerRoot): void {
    if (next === activeRoot) return;
    setPickedRoot(next);
    onRootChange?.(next);
  }

  function chooseNode(next: string): void {
    if (next === activeNodeId) {
      setCollapsed((current) => !current);
      return;
    }
    setPickedNode(next);
    setCollapsed(false);
    onNodeChange?.(next);
  }

  function goTo(folder: string): void {
    setCwd(folder);
    setCursor(0);
    setOpenPath(null);
    setPreview({ state: "idle" });
    requestToken.current += 1;
  }

  async function open(entry: ExplorerEntry): Promise<void> {
    if (entry.kind === "dir") {
      goTo(entry.path);
      return;
    }
    setOpenPath(entry.path);
    setPreview({ state: "loading" });
    const token = (requestToken.current += 1);
    try {
      const value = await loadPreview({ node: activeNodeId, root: activeRoot, path: entry.path });
      if (token === requestToken.current) setPreview({ state: "ready", value });
    } catch (error) {
      if (token !== requestToken.current) return;
      setPreview({ state: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (rows.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((current) => Math.min(current + 1, rows.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      // A focused row button activates itself; this is the container's Enter.
      if (event.target !== event.currentTarget) return;
      event.preventDefault();
      const entry = rows[activeCursor];
      if (entry !== undefined) void open(entry);
    }
  }

  const crumbs = cwd.length === 0 ? [] : cwd.split("/");
  const emptyText =
    activeFolder?.unavailable === true
      ? "This daemon does not list this root yet."
      : "Empty folder.";

  return (
    <div className="explorer">
      {status !== null ? <p className="panel__status">{status}</p> : null}

      {nodes.length === 0 ? <p className="explorer__empty">No nodes in this chain yet.</p> : null}

      {nodes.map((entry) => {
        const isActive = entry.node === activeNodeId;
        const isOpen = isActive && !collapsed;
        const label = entry.name ?? entry.node;
        const fileCount = entry.folders.reduce(
          (sum, folder) => sum + folder.entries.filter((file) => file.kind === "file").length,
          0,
        );
        return (
          <section
            key={entry.node}
            className={isOpen ? "explorer__node explorer__node--open" : "explorer__node"}
          >
            <button
              type="button"
              className="explorer__nodehead"
              aria-expanded={isOpen}
              aria-label={`${isOpen ? "Collapse" : "Open"} ${label}`}
              onClick={() => {
                chooseNode(entry.node);
              }}
            >
              <span className="explorer__nodename">{label}</span>
              {entry.node === self ? <span className="explorer__tag">this device</span> : null}
              <span className="explorer__count">
                {String(fileCount)} {fileCount === 1 ? "file" : "files"}
              </span>
            </button>

            {isOpen ? (
              <div className="explorer__body">
                <div className="explorer__browse">
                  <div className="explorer__roots" role="tablist" aria-label="Roots">
                    {folders.map((folder) => (
                      <button
                        key={folder.root}
                        type="button"
                        role="tab"
                        aria-selected={folder.root === activeRoot}
                        className={
                          folder.root === activeRoot
                            ? "explorer__root explorer__root--active"
                            : "explorer__root"
                        }
                        onClick={() => {
                          chooseRoot(folder.root);
                        }}
                      >
                        {ROOT_LABEL[folder.root]}
                        <span className="explorer__count">
                          {String(folder.entries.filter((file) => file.kind === "file").length)}
                        </span>
                      </button>
                    ))}
                  </div>

                  <nav className="explorer__crumb" aria-label="Path">
                    <button
                      type="button"
                      className={cwd.length === 0 ? "explorer__crumbstep explorer__crumbstep--current" : "explorer__crumbstep"}
                      onClick={() => {
                        goTo("");
                      }}
                    >
                      {ROOT_LABEL[activeRoot]}
                    </button>
                    {crumbs.map((segment, index) => {
                      const target = crumbs.slice(0, index + 1).join("/");
                      const current = index === crumbs.length - 1;
                      return (
                        <span key={target} className="explorer__crumbwrap">
                          <span className="explorer__crumbsep" aria-hidden="true">
                            /
                          </span>
                          <button
                            type="button"
                            className={current ? "explorer__crumbstep explorer__crumbstep--current" : "explorer__crumbstep"}
                            aria-current={current ? "page" : undefined}
                            onClick={() => {
                              goTo(target);
                            }}
                          >
                            {segment}
                          </button>
                        </span>
                      );
                    })}
                  </nav>

                  <div
                    className="explorer__rows"
                    role="group"
                    aria-label={`Files in ${cwd.length === 0 ? ROOT_LABEL[activeRoot] : cwd}`}
                    tabIndex={0}
                    onKeyDown={onKeyDown}
                  >
                    {rows.length === 0 ? <p className="explorer__empty">{emptyText}</p> : null}
                    <ul className="explorer__list">
                      {rows.map((row, index) => {
                        const classes = ["explorer__row"];
                        if (row.path === openPath) classes.push("explorer__row--selected");
                        if (index === activeCursor) classes.push("explorer__row--cursor");
                        return (
                          <li key={row.path}>
                            <button
                              type="button"
                              className={classes.join(" ")}
                              aria-label={row.kind === "dir" ? `Open folder ${row.path}` : `Open ${row.path}`}
                              onClick={() => {
                                setCursor(index);
                                void open(row);
                              }}
                            >
                              <span className="explorer__name">
                                {row.kind === "dir" ? `${nameOf(row.path)}/` : nameOf(row.path)}
                              </span>
                              <span className="explorer__meta">
                                {row.kind === "dir" ? null : (
                                  <span className="explorer__size">{bytesLabel(row.bytes)}</span>
                                )}
                                <span className={`explorer__chip explorer__chip--${row.status}`}>
                                  {row.status}
                                </span>
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>

                {openPath !== null ? (
                  <aside className="explorer__preview" aria-label={`Preview of ${openPath}`}>
                    <div className="explorer__previewhead">
                      <span className="explorer__path">{openPath}</span>
                      <span className="explorer__size">{previewMeta(preview, busy)}</span>
                    </div>

                    {preview.state === "loading" ? <p className="explorer__empty">Reading…</p> : null}
                    {preview.state === "error" ? <p className="explorer__status">{preview.message}</p> : null}
                    {preview.state === "ready" ? (
                      preview.value.binary === true ? (
                        <p className="explorer__empty">Binary file — each device keeps its own copy.</p>
                      ) : preview.value.truncated === true ? (
                        <p className="explorer__empty">Preview stopped at the size cap.</p>
                      ) : (
                        <pre className="explorer__pre">{preview.value.text}</pre>
                      )
                    ) : null}
                  </aside>
                ) : null}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
