import { useEffect, useMemo, useState, type ReactElement } from "react";
import type { ChainClient } from "../chain";

interface FileRow {
  path: string;
  bytes: number;
  hash: string;
}

interface Props {
  client: ChainClient;
}

/**
 * The files every device shares. Not a viewer bolted on: saving here writes the
 * same event the sync loop writes, so the other machines get it the usual way.
 */
export function WorkspacePanel({ client }: Props): ReactElement {
  const [files, setFiles] = useState<FileRow[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh(): Promise<void> {
    const answer = await client.request<{ files?: FileRow[]; error?: string }>("workspace_list");
    if (answer.error !== undefined) setStatus(answer.error);
    setFiles(answer.files ?? []);
  }

  useEffect(() => {
    void refresh();
  }, []);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return files;
    return files.filter((file) => file.path.toLowerCase().includes(needle));
  }, [files, query]);

  async function openFile(path: string): Promise<void> {
    setBusy(true);
    setStatus(null);
    const answer = await client.request<{ content?: string; error?: string }>("workspace_read", { path });
    setBusy(false);
    if (answer.error !== undefined) {
      setStatus(answer.error);
      return;
    }
    setOpen(path);
    setContent(answer.content ?? "");
  }

  async function save(): Promise<void> {
    if (open === null) return;
    setBusy(true);
    const answer = await client.request<{ ok?: boolean; error?: string }>("workspace_write", {
      path: open,
      content,
    });
    setBusy(false);
    setStatus(answer.error ?? "saved — the other devices get it within seconds");
    await refresh();
  }

  return (
    <section className="panel">
      <header className="panel__head">
        <h2 className="panel__title">Workspace</h2>
        <button type="button" className="rail__button" onClick={() => void refresh()}>
          Refresh
        </button>
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
          {shown.length === 0 ? <li className="panel__empty">No files yet.</li> : null}
          {shown.map((file) => (
            <li key={file.path}>
              <button
                type="button"
                className={file.path === open ? "panel__row panel__row--active" : "panel__row"}
                onClick={() => void openFile(file.path)}
              >
                <span className="panel__path">{file.path}</span>
                <span className="panel__size">{Math.max(1, Math.round(file.bytes / 1024))} kB</span>
              </button>
            </li>
          ))}
        </ul>

        {open !== null ? (
          <div className="panel__editor">
            <div className="panel__file">{open}</div>
            <textarea
              className="panel__code"
              value={content}
              spellCheck={false}
              onChange={(event) => setContent(event.target.value)}
            />
            <button type="button" className="panel__primary" disabled={busy} onClick={() => void save()}>
              Save
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
