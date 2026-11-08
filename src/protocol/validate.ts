/**
 * Runtime validation for the frozen protocol contract.
 *
 * TypeScript types disappear at runtime, so everything that crosses a process
 * or network boundary is checked here first. Validators return a fresh,
 * normalised object with only the contract's fields; unknown properties are
 * dropped instead of leaking into the chain.
 */

import {
  PROTOCOL_VERSION,
  type AppendFrame,
  type Event,
  type EventType,
  type EventsFrame,
  type FrameType,
  type HelloFrame,
  type ProtocolVersion,
  type ToolRequestFrame,
  type ToolResultFrame,
  type TransportFrame,
} from "./types.js";

export type ProtocolErrorCode =
  | "invalid_json"
  | "unsupported_version"
  | "unknown_frame_type"
  | "invalid_event"
  | "invalid_frame";

/** Every rejection is one of these, with the path to the offending field. */
export class ProtocolError extends Error {
  readonly code: ProtocolErrorCode;
  readonly path: string;

  constructor(code: ProtocolErrorCode, path: string, detail: string) {
    super(`${path}: ${detail} (${code})`);
    this.name = "ProtocolError";
    this.code = code;
    this.path = path;
  }
}

/*
 * Completeness tables. The mapped `satisfies` type makes a missing member a
 * compile error: adding an EventType or a frame type forces these tables, and
 * therefore every switch that consumes them, to be updated.
 */
const EVENT_TYPES = {
  message: true,
  assistant: true,
  tool_call: true,
  tool_result: true,
  error: true,
  turn_start: true,
  turn_end: true,
  env: true,
} as const satisfies { readonly [K in EventType]: true };

const FRAME_TYPES = {
  hello: true,
  events: true,
  append: true,
  tool_req: true,
  tool_res: true,
} as const satisfies { readonly [K in FrameType]: true };

const EVENT_TYPE_SET: ReadonlySet<string> = new Set(Object.keys(EVENT_TYPES));
const FRAME_TYPE_SET: ReadonlySet<string> = new Set(Object.keys(FRAME_TYPES));

export function isEventType(value: unknown): value is EventType {
  return typeof value === "string" && EVENT_TYPE_SET.has(value);
}

export function isFrameType(value: unknown): value is FrameType {
  return typeof value === "string" && FRAME_TYPE_SET.has(value);
}

/**
 * Compile-time exhaustiveness check. A new union member that is not handled
 * above reaches this call and fails the typecheck.
 */
export function assertNever(value: never, path: string): never {
  throw new ProtocolError("invalid_frame", path, `unhandled protocol variant ${String(value)}`);
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `array(${value.length})`;
  switch (typeof value) {
    case "string": {
      const shown = value.length > 40 ? `${value.slice(0, 40)}...` : value;
      return `string ${JSON.stringify(shown)}`;
    }
    case "number":
      return `number ${String(value)}`;
    case "boolean":
      return `boolean ${String(value)}`;
    case "object":
      return "object";
    case "undefined":
      return "undefined";
    default:
      return typeof value;
  }
}

function fail(code: ProtocolErrorCode, path: string, expected: string, value: unknown): never {
  throw new ProtocolError(code, path, `expected ${expected}, got ${describe(value)}`);
}

function asRecord(
  value: unknown,
  path: string,
  code: ProtocolErrorCode,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(code, path, "an object", value);
  }
  return value as Record<string, unknown>;
}

function required(
  record: Record<string, unknown>,
  key: string,
  path: string,
  code: ProtocolErrorCode,
): unknown {
  if (!Object.hasOwn(record, key)) {
    throw new ProtocolError(code, `${path}.${key}`, "is required but missing");
  }
  return record[key];
}

function nonEmptyString(
  record: Record<string, unknown>,
  key: string,
  path: string,
  code: ProtocolErrorCode,
): string {
  const fieldPath = `${path}.${key}`;
  const value = required(record, key, path, code);
  if (typeof value !== "string") fail(code, fieldPath, "a string", value);
  if (value.trim().length === 0) {
    throw new ProtocolError(code, fieldPath, "must not be empty");
  }
  return value;
}

function safeInteger(
  record: Record<string, unknown>,
  key: string,
  path: string,
  code: ProtocolErrorCode,
  min: number,
): number {
  const fieldPath = `${path}.${key}`;
  const value = required(record, key, path, code);
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    fail(code, fieldPath, `a safe integer >= ${min}`, value);
  }
  if (value < min) {
    throw new ProtocolError(code, fieldPath, `must be >= ${min}, got ${String(value)}`);
  }
  return value;
}

function booleanField(
  record: Record<string, unknown>,
  key: string,
  path: string,
  code: ProtocolErrorCode,
): boolean {
  const fieldPath = `${path}.${key}`;
  const value = required(record, key, path, code);
  if (typeof value !== "boolean") fail(code, fieldPath, "a boolean", value);
  return value;
}

/** True for values that survive `JSON.stringify` without loss. */
function isJsonValue(value: unknown, seen: Set<object>): boolean {
  if (value === null) return true;
  switch (typeof value) {
    case "string":
    case "boolean":
      return true;
    case "number":
      return Number.isFinite(value);
    case "object": {
      const object = value as object;
      if (seen.has(object)) return false;
      seen.add(object);
      let ok: boolean;
      if (Array.isArray(object)) {
        ok = object.every((item) => isJsonValue(item, seen));
      } else {
        const prototype = Object.getPrototypeOf(object);
        ok =
          (prototype === Object.prototype || prototype === null) &&
          Object.values(object as Record<string, unknown>).every((item) =>
            isJsonValue(item, seen),
          );
      }
      seen.delete(object);
      return ok;
    }
    default:
      return false;
  }
}

/** Reject a protocol version other than the one this build speaks. */
export function assertProtocolVersion(
  value: unknown,
  path = "v",
): asserts value is ProtocolVersion {
  if (value !== PROTOCOL_VERSION) {
    throw new ProtocolError(
      "unsupported_version",
      path,
      `unsupported protocol version ${describe(value)}; this build speaks version ${PROTOCOL_VERSION}`,
    );
  }
}

/**
 * Validate one chain event. Returns a normalised copy; throws `ProtocolError`
 * with the exact path of the first malformed field.
 */
export function validateEvent(value: unknown, path = "event"): Event {
  const record = asRecord(value, path, "invalid_event");
  assertProtocolVersion(record.v, `${path}.v`);

  const chain = nonEmptyString(record, "chain", path, "invalid_event");
  const seq = safeInteger(record, "seq", path, "invalid_event", 1);
  const id = nonEmptyString(record, "id", path, "invalid_event");
  const node = nonEmptyString(record, "node", path, "invalid_event");
  const ts = safeInteger(record, "ts", path, "invalid_event", 0);

  const type = required(record, "type", path, "invalid_event");
  if (!isEventType(type)) {
    fail("invalid_event", `${path}.type`, "a known event type", type);
  }

  if (!Object.hasOwn(record, "data")) {
    throw new ProtocolError("invalid_event", `${path}.data`, "is required but missing");
  }
  const data = record.data;
  if (!isJsonValue(data, new Set<object>())) {
    throw new ProtocolError("invalid_event", `${path}.data`, "must be a JSON value");
  }

  return { v: PROTOCOL_VERSION, chain, seq, id, node, ts, type, data };
}

function validateHelloFrame(value: unknown, path: string): HelloFrame {
  const record = asRecord(value, path, "invalid_frame");
  assertProtocolVersion(record.v, `${path}.v`);
  return {
    t: "hello",
    v: PROTOCOL_VERSION,
    chain: nonEmptyString(record, "chain", path, "invalid_frame"),
    node: nonEmptyString(record, "node", path, "invalid_frame"),
    haveSeq: safeInteger(record, "haveSeq", path, "invalid_frame", 0),
  };
}

function validateEventsFrame(value: unknown, path: string): EventsFrame {
  const record = asRecord(value, path, "invalid_frame");
  const raw = required(record, "events", path, "invalid_frame");
  if (!Array.isArray(raw)) fail("invalid_frame", `${path}.events`, "an array", raw);

  const events: Event[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    events.push(validateEvent(raw[index], `${path}.events[${index}]`));
  }

  let chain: string | undefined;
  let previousSeq = 0;
  for (const event of events) {
    if (chain === undefined) {
      chain = event.chain;
    } else if (event.chain !== chain) {
      throw new ProtocolError(
        "invalid_frame",
        `${path}.events`,
        `mixes chains ${JSON.stringify(chain)} and ${JSON.stringify(event.chain)}`,
      );
    }
    if (event.seq <= previousSeq) {
      throw new ProtocolError(
        "invalid_frame",
        `${path}.events`,
        `sequence numbers must strictly increase, got ${String(previousSeq)} then ${String(event.seq)}`,
      );
    }
    previousSeq = event.seq;
  }

  return { t: "events", events };
}

function validateAppendFrame(value: unknown, path: string): AppendFrame {
  const record = asRecord(value, path, "invalid_frame");
  const event = validateEvent(
    required(record, "event", path, "invalid_frame"),
    `${path}.event`,
  );
  return { t: "append", event };
}

function validateToolRequestFrame(value: unknown, path: string): ToolRequestFrame {
  const record = asRecord(value, path, "invalid_frame");
  const call = nonEmptyString(record, "call", path, "invalid_frame");
  const node = nonEmptyString(record, "node", path, "invalid_frame");
  const tool = nonEmptyString(record, "tool", path, "invalid_frame");
  const argsPath = `${path}.args`;
  const args = asRecord(required(record, "args", path, "invalid_frame"), argsPath, "invalid_frame");
  if (!isJsonValue(args, new Set<object>())) {
    throw new ProtocolError("invalid_frame", argsPath, "must be a JSON object");
  }
  return { t: "tool_req", call, node, tool, args };
}

function validateToolResultFrame(value: unknown, path: string): ToolResultFrame {
  const record = asRecord(value, path, "invalid_frame");
  const call = nonEmptyString(record, "call", path, "invalid_frame");
  const ok = booleanField(record, "ok", path, "invalid_frame");
  const output = required(record, "output", path, "invalid_frame");
  if (typeof output !== "string") fail("invalid_frame", `${path}.output`, "a string", output);
  return { t: "tool_res", call, ok, output };
}

/**
 * Validate one transport frame. Returns a normalised copy; the exhaustive
 * switch means a new `TransportFrame` member cannot be silently ignored.
 */
export function validateFrame(value: unknown, path = "frame"): TransportFrame {
  const record = asRecord(value, path, "invalid_frame");
  const type = required(record, "t", path, "invalid_frame");
  if (!isFrameType(type)) {
    throw new ProtocolError(
      "unknown_frame_type",
      `${path}.t`,
      `unknown transport frame type ${describe(type)}`,
    );
  }

  switch (type) {
    case "hello":
      return validateHelloFrame(record, path);
    case "events":
      return validateEventsFrame(record, path);
    case "append":
      return validateAppendFrame(record, path);
    case "tool_req":
      return validateToolRequestFrame(record, path);
    case "tool_res":
      return validateToolResultFrame(record, path);
    default:
      return assertNever(type, `${path}.t`);
  }
}

export function isEvent(value: unknown): value is Event {
  try {
    validateEvent(value);
    return true;
  } catch (error: unknown) {
    if (error instanceof ProtocolError) return false;
    throw error;
  }
}

export function isFrame(value: unknown): value is TransportFrame {
  try {
    validateFrame(value);
    return true;
  } catch (error: unknown) {
    if (error instanceof ProtocolError) return false;
    throw error;
  }
}
