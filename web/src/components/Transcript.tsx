import { useEffect, useMemo, useRef } from "react";
import type { ReactElement } from "react";
import type { ChainEvent, PendingMessage } from "../chain.js";
import { Markdown } from "./Markdown.js";

interface TranscriptProps {
  events: readonly ChainEvent[];
  pending: readonly PendingMessage[];
  /** This device's node name, used to tell "you" from other devices. */
  node: string;
}

/**
 * The conversation, drawn the way a person reads a chat: your words in a quiet
 * bubble on the right, Roan's answer as plain text on the left, a tool as one
 * small line that opens for the details. Node names, clocks and bookkeeping are
 * behind the details toggle, never in your face.
 */

type Row =
  | { kind: "user"; key: string; text: string }
  | { kind: "assistant"; key: string; text: string }
  | { kind: "tool"; key: string; name: string; args: string; output: string; ok: boolean | null }
  | { kind: "notice"; key: string; text: string }
  | { kind: "meta"; key: string; text: string };

interface OpenTool {
  key: string;
  name: string;
  args: string;
}

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
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function toolOf(data: unknown): { name: string; args: string } {
  if (!isRecord(data)) return { name: "tool", args: "" };
  const fn = isRecord(data["function"]) ? (data["function"] as Record<string, unknown>) : null;
  const name =
    pickString(data, ["name", "tool"]) ?? (fn ? pickString(fn, ["name"]) : null) ?? "tool";
  const args = data["args"] ?? data["arguments"] ?? data["input"] ?? (fn ? fn["arguments"] : undefined);
  return { name, args: show(args) };
}

function resultOk(data: unknown): boolean {
  if (!isRecord(data)) return true;
  if (typeof data["ok"] === "boolean") return data["ok"];
  return !("error" in data) || data["error"] === null || data["error"] === false;
}

function buildRows(events: readonly ChainEvent[], local: string): Row[] {
  const rows: Row[] = [];
  const open: OpenTool[] = [];

  // A tool call and its answer are one step to a reader, so an open call waits
  // for its result and they are drawn as one line.
  const flush = (): void => {
    for (const tool of open) {
      rows.push({ kind: "tool", key: tool.key, name: tool.name, args: tool.args, output: "", ok: null });
    }
    open.length = 0;
  };

  for (const event of events) {
    const data = event.data;
    switch (event.type) {
      case "message": {
        flush();
        rows.push({ kind: event.node === local ? "user" : "user", key: event.id, text: textOf(data) });
        break;
      }
      case "assistant": {
        flush();
        const text = textOf(data);
        const last = rows[rows.length - 1];
        // Streaming arrives as several assistant events in one turn; one block
        // reads better than a fragment per delta.
        if (last !== undefined && last.kind === "assistant") {
          last.text = last.text.length > 0 ? `${last.text}\n${text}` : text;
        } else {
          rows.push({ kind: "assistant", key: event.id, text });
        }
        break;
      }
      case "tool_call": {
        const tool = toolOf(data);
        open.push({ key: event.id, name: tool.name, args: tool.args });
        break;
      }
      case "tool_result": {
        const tool = toolOf(data);
        const output = isRecord(data)
          ? show(data["output"] ?? data["result"] ?? data["text"] ?? data["content"])
          : "";
        const ok = resultOk(data);
        const index = open.findIndex((item) => item.name === tool.name);
        if (index >= 0) {
          const call = open.splice(index, 1)[0] as OpenTool;
          rows.push({ kind: "tool", key: call.key, name: call.name, args: call.args, output, ok });
        } else {
          rows.push({ kind: "tool", key: event.id, name: tool.name, args: "", output, ok });
        }
        break;
      }
      case "error": {
        flush();
        const message = isRecord(data) ? pickString(data, ["message", "error", "text"]) : null;
        const text = message ?? (textOf(data) || "something went wrong");
        const last = rows[rows.length - 1];
        // A failed turn often writes the same error twice (the adapter and the
        // loop both report it). One line is the truth; two look like two bugs.
        if (last !== undefined && last.kind === "notice" && last.text === text) break;
        rows.push({ kind: "notice", key: event.id, text });
        break;
      }
      case "session": {
        flush();
        rows.push({ kind: "meta", key: event.id, text: "new chat" });
        break;
      }
      case "checkpoint": {
        flush();
        const label = isRecord(data) && typeof data["label"] === "string" ? data["label"] : "";
        rows.push({
          kind: "meta",
          key: event.id,
          text: label.length > 0 && label !== "checkpoint" ? `checkpoint · ${label}` : "checkpoint",
        });
        break;
      }
      case "workspace": {
        const path = isRecord(data) && typeof data["path"] === "string" ? data["path"] : "";
        if (path.length > 0) rows.push({ kind: "meta", key: event.id, text: path });
        break;
      }
      default:
        break;
    }
  }
  flush();
  return rows;
}

export function Transcript({ events, pending, node }: TranscriptProps): ReactElement {
  const rows = useMemo(() => buildRows(events, node), [events, node]);
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
      <div className="transcript__list" role="log" aria-label="Conversation" aria-live="polite">
        {empty ? (
          <div className="empty">
            <div className="empty__mark" aria-hidden="true" />
            <p className="empty__title">Where should we start?</p>
            <p className="empty__text">
              Ask anything, have Roan work in the workspace, or plan something for later. Everything
              you type here is on every device in the chain.
            </p>
          </div>
        ) : null}

        {rows.map((row) => (
          <RowView key={row.key} row={row} />
        ))}

        {pending.map((item) => (
          <div className="bubble bubble--out bubble--pending" key={item.id}>
            {item.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function RowView({ row }: { row: Row }): ReactElement {
  switch (row.kind) {
    case "user":
      return <div className="bubble bubble--out">{row.text}</div>;
    case "assistant":
      return (
        <div className="answer">
          {row.text.length === 0 ? (
            <span className="answer__caret" aria-label="Roan is answering" />
          ) : (
            <Markdown source={row.text} />
          )}
        </div>
      );
    case "tool":
      return (
        <details className="tool">
          <summary className="tool__line">
            <span className={`tool__dot${row.ok === false ? " tool__dot--bad" : ""}`} aria-hidden="true" />
            <span className="tool__name">{row.name}</span>
            <span
              className={`tool__state${
                row.ok === true ? " tool__state--ok" : row.ok === false ? " tool__state--bad" : ""
              }`}
            >
              {row.ok === null ? "running" : row.ok === true ? "done" : "failed"}
            </span>
          </summary>
          <div className="tool__detail">
            {row.args.length > 0 ? (
              <>
                <span className="tool__label">input</span>
                <pre className="tool__body">{row.args}</pre>
              </>
            ) : null}
            {row.output.length > 0 ? (
              <>
                <span className="tool__label">output</span>
                <pre className="tool__body">{row.output}</pre>
              </>
            ) : null}
          </div>
        </details>
      );
    case "notice":
      return (
        <p className="notice" role="alert">
          {row.text}
        </p>
      );
    case "meta":
      return <p className="chatmeta">{row.text}</p>;
  }
}
