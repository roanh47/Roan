import { PROTOCOL_VERSION, type Event, type Frame, type ParseOptions, type ParseResult } from "./protocol.js";

const MAX_TEXT = 512;
const DEFAULT_MAX_EVENTS = 1_000;
const utf8 = new TextDecoder();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_TEXT) return null;
  return value;
}

function readInteger(source: Record<string, unknown>, key: string, min: number): number | null {
  const value = source[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < min) return null;
  return value;
}

/** Validate one event. Returns null when anything about it is off. */
export function parseEvent(value: unknown): Event | null {
  if (!isRecord(value)) return null;
  if (value["v"] !== PROTOCOL_VERSION) return null;

  const chain = readText(value, "chain");
  const seq = readInteger(value, "seq", 0);
  const id = readText(value, "id");
  const node = readText(value, "node");
  const type = readText(value, "type");
  const ts = value["ts"];
  if (chain === null || seq === null || id === null || node === null || type === null) return null;
  if (typeof ts !== "number" || !Number.isFinite(ts)) return null;
  if (!("data" in value)) return null;

  return { v: PROTOCOL_VERSION, chain, seq, id, node, ts, type, data: value["data"] };
}

function eventList(value: unknown, maxEvents: number): Event[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxEvents) return null;
  const events: Event[] = [];
  for (const candidate of value) {
    const event = parseEvent(candidate);
    if (event === null) return null;
    events.push(event);
  }
  return events;
}

/**
 * Parse a frame. Never throws: malformed input becomes `{ ok: false }` with a
 * reason that is safe to log and safe to put in a close frame.
 */
export function parseFrame(raw: string, options: ParseOptions = {}): ParseResult {
  const maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "invalid JSON" };
  }
  if (!isRecord(value)) return { ok: false, reason: "frame is not a JSON object" };

  const kind = value["t"];
  if (typeof kind !== "string") return { ok: false, reason: "missing frame type" };

  switch (kind) {
    case "hello": {
      if (value["v"] !== PROTOCOL_VERSION) {
        return { ok: false, reason: `unsupported version ${String(value["v"])}` };
      }
      const chain = readText(value, "chain");
      const node = readText(value, "node");
      const haveSeq = readInteger(value, "haveSeq", 0);
      if (chain === null || node === null || haveSeq === null) {
        return { ok: false, reason: "malformed hello" };
      }
      return { ok: true, frame: { t: "hello", v: PROTOCOL_VERSION, chain, node, haveSeq } };
    }
    case "events": {
      const events = eventList(value["events"], maxEvents);
      if (events === null) return { ok: false, reason: "malformed events frame" };
      return { ok: true, frame: { t: "events", events } };
    }
    case "append": {
      const event = parseEvent(value["event"]);
      if (event === null) return { ok: false, reason: "malformed append frame" };
      return { ok: true, frame: { t: "append", event } };
    }
    case "tool_req": {
      const call = readText(value, "call");
      const node = readText(value, "node");
      const tool = readText(value, "tool");
      if (call === null || node === null || tool === null) {
        return { ok: false, reason: "malformed tool_req" };
      }
      return { ok: true, frame: { t: "tool_req", call, node, tool, args: value["args"] } };
    }
    case "tool_res": {
      const call = readText(value, "call");
      const ok = value["ok"];
      const output = value["output"];
      if (call === null || typeof ok !== "boolean" || typeof output !== "string") {
        return { ok: false, reason: "malformed tool_res" };
      }
      return { ok: true, frame: { t: "tool_res", call, ok, output } };
    }
    default:
      return { ok: false, reason: `unknown frame type "${kind.slice(0, 32)}"` };
  }
}

/**
 * Turn anything a WebSocket hands us into text, or null when it is binary
 * junk. Invalid UTF-8 decodes to replacement characters and then fails JSON
 * parsing downstream, which is the behaviour we want.
 */
export function decodeFrameData(data: unknown): string | null {
  if (typeof data === "string") return data;
  if (data instanceof Uint8Array) return utf8.decode(data);
  if (data instanceof ArrayBuffer) return utf8.decode(new Uint8Array(data));
  if (Array.isArray(data)) {
    const parts: Uint8Array[] = [];
    for (const part of data) {
      if (!(part instanceof Uint8Array)) return null;
      parts.push(part);
    }
    return utf8.decode(Buffer.concat(parts));
  }
  return null;
}

/**
 * Cheap version check for input that failed `parseFrame`: a well-formed frame
 * from another protocol version deserves "version mismatch", not "bad frame".
 */
export function detectVersionMismatch(raw: string): string | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const version = value["v"];
  if (typeof version === "number" && version !== PROTOCOL_VERSION) {
    return `version mismatch: expected ${PROTOCOL_VERSION}, peer sent ${version}`;
  }
  return null;
}

/** True when every event belongs to `chain`. */
export function eventsBelongTo(events: readonly Event[], chain: string): boolean {
  return events.every((event) => event.chain === chain);
}

/**
 * Human-readable chain mismatch for a frame, or null when it is consistent.
 * Frames without a chain (tool_req, tool_res, hello) always pass.
 */
export function frameChainMismatch(frame: Frame, chain: string): string | null {
  if (frame.t === "append") {
    return frame.event.chain === chain
      ? null
      : `event chain "${frame.event.chain}" does not match expected "${chain}"`;
  }
  if (frame.t === "events") {
    const wrong = frame.events.find((event) => event.chain !== chain);
    return wrong === undefined
      ? null
      : `event ${wrong.id} chain "${wrong.chain}" does not match expected "${chain}"`;
  }
  return null;
}
