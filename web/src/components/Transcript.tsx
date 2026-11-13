import { useEffect, useMemo, useRef } from "react";
import type { ReactElement } from "react";
import type { ChainEvent, PendingMessage } from "../chain";

interface TranscriptProps {
  events: readonly ChainEvent[];
  pending: readonly PendingMessage[];
  /** This device's node name, used to tell "you" from other devices. */
  node: string;
}

type Row =
  | { kind: "message"; key: string; node: string; ts: number; text: string }
  | { kind: "assistant"; key: string; node: string; ts: number; text: string }
  | { kind: "tool_call"; key: string; name: string; body: string }
  | { kind: "tool_result"; key: string; name: string; body: string; ok: boolean }
  | { kind: "error"; key: string; text: string }
  | { kind: "meta"; key: string; label: string }
  | { kind: "raw"; key: string; label: string; body: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function pickString(source: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string") return value;
  }
  return null;
}

function textOf(data: unknown): string {
  if (typeof data === "string") return data;
  if (isRecord(data)) {
    return pickString(data, ["text", "content", "message", "delta"]) ?? "";
  }
  return "";
}

function show(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function toolOf(data: unknown): { name: string; body: string } {
  if (!isRecord(data)) return { name: "tool", body: show(data) };
  const fn = isRecord(data.function) ? data.function : null;
  const name =
    pickString(data, ["name", "tool"]) ?? (fn ? pickString(fn, ["name"]) : null) ?? "tool";
  const args = data.args ?? data.arguments ?? data.input ?? (fn ? fn.arguments : undefined);
  return { name, body: show(args) };
}

function resultOk(data: unknown): boolean {
  if (!isRecord(data)) return true;
  if (typeof data.ok === "boolean") return data.ok;
  return !("error" in data) || data.error === null || data.error === false;
}

function labelFor(event: ChainEvent): string {
  if (event.type === "turn_start") return `turn started · ${event.node}`;
  if (event.type === "turn_end") {
    const steps = isRecord(event.data) ? event.data.steps : undefined;
    return typeof steps === "number"
      ? `turn ended · ${steps} ${steps === 1 ? "step" : "steps"}`
      : "turn ended";
  }
  return event.type;
}

function buildRows(events: readonly ChainEvent[]): Row[] {
  const rows: Row[] = [];
  for (const event of events) {
    switch (event.type) {
      case "message": {
        rows.push({
          kind: "message",
          key: event.id,
          node: event.node,
          ts: event.ts,
          text: textOf(event.data),
        });
        break;
      }
      case "assistant": {
        const last = rows[rows.length - 1];
        const text = textOf(event.data);
        // Streaming arrives as several assistant events in one turn; keep them
        // as one block so the transcript does not fragment per delta.
        if (last && last.kind === "assistant" && last.node === event.node) {
          last.text = last.text.length > 0 ? `${last.text}\n${text}` : text;
        } else {
          rows.push({ kind: "assistant", key: event.id, node: event.node, ts: event.ts, text });
        }
        break;
      }
      case "tool_call": {
        const tool = toolOf(event.data);
        rows.push({ kind: "tool_call", key: event.id, name: tool.name, body: tool.body });
        break;
      }
      case "tool_result": {
        const tool = toolOf(event.data);
        const output =
          isRecord(event.data)
            ? pickString(event.data, ["output", "result", "text", "content"]) ?? show(event.data)
            : show(event.data);
        rows.push({
          kind: "tool_result",
          key: event.id,
          name: tool.name,
          body: output,
          ok: resultOk(event.data),
        });
        break;
      }
      case "error": {
        const message =
          isRecord(event.data) ? pickString(event.data, ["message", "error", "text"]) : null;
        rows.push({
          kind: "error",
          key: event.id,
          text: message ?? (textOf(event.data) || "Error"),
        });
        break;
      }
      case "session": {
        const title = isRecord(event.data) ? pickString(event.data, ["title"]) : null;
        rows.push({ kind: "meta", key: event.id, label: `nieuw gesprek · ${title ?? ""}`.trim() });
        break;
      }
      case "checkpoint": {
        const label = isRecord(event.data) ? pickString(event.data, ["label"]) : null;
        rows.push({ kind: "meta", key: event.id, label: `checkpoint · ${label ?? ""}`.trim() });
        break;
      }
      case "workspace": {
        const path = isRecord(event.data) ? pickString(event.data, ["path"]) : null;
        const op = isRecord(event.data) ? pickString(event.data, ["op"]) : null;
        rows.push({
          kind: "meta",
          key: event.id,
          label: `${op === "delete" ? "verwijderd" : "bijgewerkt"} · ${path ?? ""}`.trim(),
        });
        break;
      }
      // Bookkeeping the eye should never have to read: the turn spinner in the
      // status panel already says a turn is running, and the env is not a message.
      case "env":
      case "turn_start":
      case "turn_end": {
        break;
      }
      default: {
        rows.push({
          kind: "meta",
          key: event.id,
          label: labelFor(event),
        });
      }
    }
  }
  return rows;
}

function clock(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function Transcript({ events, pending, node }: TranscriptProps): ReactElement {
  const rows = useMemo(() => buildRows(events), [events]);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    if (stick.current) element.scrollTop = element.scrollHeight;
  }, [rows, pending.length]);

  function onScroll(): void {
    const element = scroller.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    stick.current = distance < 56;
  }

  const empty = rows.length === 0 && pending.length === 0;

  return (
    <div className="transcript" ref={scroller} onScroll={onScroll}>
      <div
        className="transcript__list"
        role="log"
        aria-label="Conversation transcript"
        aria-live="polite"
        aria-relevant="additions text"
      >
        {empty ? (
          <p className="empty">
            Nothing here yet. Say something — every device on this chain sees it.
          </p>
        ) : null}

        {rows.map((row) => (
          <RowView key={row.key} row={row} local={node} />
        ))}

        {pending.map((item) => (
          <article className="bubble bubble--out bubble--pending" key={item.id}>
            <div className="bubble__meta">
              <span>you</span>
              <span className="bubble__state">sending…</span>
            </div>
            <p className="bubble__text">{item.text}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

function RowView({ row, local }: { row: Row; local: string }): ReactElement {
  switch (row.kind) {
    case "message": {
      const mine = row.node === local;
      return (
        <article className={`bubble ${mine ? "bubble--out" : "bubble--in"}`}>
          <div className="bubble__meta">
            <span>{mine ? "you" : row.node}</span>
            <time dateTime={new Date(row.ts).toISOString()}>{clock(row.ts)}</time>
          </div>
          <p className="bubble__text">{row.text || <span className="muted">empty message</span>}</p>
        </article>
      );
    }
    case "assistant": {
      return (
        <article className="bubble bubble--assistant">
          <div className="bubble__meta">
            <span>Roan</span>
            <span>{row.node}</span>
          </div>
          <p className="bubble__text">{row.text}</p>
        </article>
      );
    }
    case "tool_call": {
      return (
        <details className="trace">
          <summary>
            <span className="trace__kind">tool call</span>
            <span className="trace__name">{row.name}</span>
          </summary>
          <pre className="trace__body">{row.body || "no arguments"}</pre>
        </details>
      );
    }
    case "tool_result": {
      return (
        <details className="trace">
          <summary>
            <span className="trace__kind">tool result</span>
            <span className="trace__name">{row.name}</span>
            <span className={`trace__flag ${row.ok ? "is-ok" : "is-bad"}`}>
              {row.ok ? "ok" : "failed"}
            </span>
          </summary>
          <pre className="trace__body">{row.body || "no output"}</pre>
        </details>
      );
    }
    case "error": {
      return (
        <div className="bubble bubble--error" role="alert">
          <div className="bubble__meta">
            <span>error</span>
          </div>
          <p className="bubble__text">{row.text}</p>
        </div>
      );
    }
    case "meta": {
      return (
        <div className="divider">
          <span>{row.label}</span>
        </div>
      );
    }
    case "raw": {
      return (
        <details className="trace trace--raw">
          <summary>
            <span className="trace__kind">{row.label}</span>
          </summary>
          <pre className="trace__body">{row.body}</pre>
        </details>
      );
    }
  }
}
