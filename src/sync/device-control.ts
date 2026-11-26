/**
 * Device control between own nodes: one allowlisted command, asked for over
 * the peer connection and only run when the chain already granted that node.
 *
 * The rules this file enforces, in order:
 * - a request names one entry of `ALLOWLIST` and nothing else; the allowlist
 *   fixes the argv, so the wire never carries an argument list;
 * - a command with a shell metacharacter is refused before the allowlist is
 *   even consulted — there is no shell, so `;`, `&&`, `|`, backticks, `$(`
 *   and redirects only ever mean "someone is trying to get past this";
 * - a node runs a request only when the chain holds a grant for that node
 *   that says `enabled: true`, and only when the request is addressed to it;
 * - the process itself is never started here. `executeRequest` takes a
 *   runner, so the caller decides how (and whether) a command runs and tests
 *   never spawn anything.
 *
 * Grants travel as chain events (`DEVICE_GRANT_EVENT`) with the payload
 * `{ node, enabled }`; `grantsFromEvents` folds them newest-wins per node.
 * Requests travel as one `device_req` frame: `{ t, chain, node, command }`.
 * Wiring the frame and the event type into the protocol is the daemon's job;
 * this module only builds, parses and executes.
 */

import type { Event } from "./types.js";

/** Frame type for a device request. Must match the transport's frame union. */
export const DEVICE_REQUEST_FRAME = "device_req";

/** Chain event type that carries a grant. Must be a known event type. */
export const DEVICE_GRANT_EVENT = "device_grant";

/** Largest output kept by default; anything longer is cut, not streamed. */
export const DEFAULT_MAX_OUTPUT_CHARS = 4_000;

/** One command a node may be asked to run, with the argv it always runs as. */
export interface DeviceCommand {
  /** The exact text a request must carry. */
  readonly command: string;
  /** The argv handed to the runner; never built from the request. */
  readonly argv: readonly string[];
}

/**
 * The whole allowlist. Read-only commands only, each with a fixed argv:
 * nothing here can write a file, touch a service or take a path argument.
 */
export const ALLOWLIST: readonly DeviceCommand[] = [
  { command: "uname -a", argv: ["uname", "-a"] },
  { command: "df -h", argv: ["df", "-h"] },
  { command: "uptime", argv: ["uptime"] },
  { command: "date", argv: ["date"] },
  { command: "git status", argv: ["git", "status"] },
];

const BY_COMMAND: ReadonlyMap<string, DeviceCommand> = new Map(
  ALLOWLIST.map((entry) => [entry.command, entry]),
);

/** Why a request, a frame or a grant was refused. One code per cause. */
export type DeviceRefusalCode =
  | "invalid-node"
  | "empty-command"
  | "metacharacter-semicolon"
  | "metacharacter-and"
  | "metacharacter-ampersand"
  | "metacharacter-pipe"
  | "metacharacter-backtick"
  | "metacharacter-substitution"
  | "metacharacter-newline"
  | "metacharacter-redirect"
  | "unknown-node"
  | "unknown-command"
  | "frame-shape"
  | "frame-type"
  | "frame-chain"
  | "argv-mismatch"
  | "node-not-self"
  | "chain-mismatch"
  | "grant-missing"
  | "grant-invalid"
  | "grant-node-mismatch"
  | "grant-disabled"
  | "output-invalid"
  | "runner-failed";

/**
 * One sentence per cause. Distinct on purpose: a caller (and a test) can tell
 * exactly which rule said no.
 */
const REASONS: Readonly<Record<DeviceRefusalCode, string>> = {
  "invalid-node": "device control: a node id is required",
  "empty-command": "device control: a command is required",
  "metacharacter-semicolon":
    "device control: refused ';' — a request is one allowlisted command, never a shell line",
  "metacharacter-and":
    "device control: refused '&&' — a request is one allowlisted command, never a chain of them",
  "metacharacter-ampersand": "device control: refused '&' — a request is one command, not a job",
  "metacharacter-pipe": "device control: refused '|' — a request is one command, never a pipeline",
  "metacharacter-backtick":
    "device control: refused a backtick — nothing is expanded in an allowlisted command",
  "metacharacter-substitution":
    "device control: refused '$(' — nothing is expanded in an allowlisted command",
  "metacharacter-newline": "device control: refused a line break — one command per request",
  "metacharacter-redirect": "device control: refused a redirect — an allowlisted command reads only",
  "unknown-node": "device control: that node is not in this chain",
  "unknown-command": "device control: that command is not in the allowlist",
  "frame-shape": "device control: the frame is not a device request",
  "frame-type": "device control: the frame type is not device_req",
  "frame-chain": "device control: the frame does not say which chain it belongs to",
  "argv-mismatch": "device control: the request's argv is not the argv of the allowlisted command",
  "node-not-self": "device control: the request is addressed to another node",
  "chain-mismatch": "device control: the request comes from another chain",
  "grant-missing": "device control: there is no grant for that node",
  "grant-invalid": "device control: the grant is not a device grant",
  "grant-node-mismatch": "device control: the grant belongs to a different node",
  "grant-disabled": "device control: the grant for that node is disabled",
  "output-invalid": "device control: the runner returned something that is not text",
  "runner-failed": "device control: the runner failed",
};

/** A refusal: the code says which rule, the reason says it in a sentence. */
export interface Refusal {
  readonly ok: false;
  readonly code: DeviceRefusalCode;
  readonly reason: string;
}

function refuse(code: DeviceRefusalCode): Refusal {
  return { ok: false, code, reason: REASONS[code] };
}

/** A validated request: what a node may run, and for whom. */
export interface DeviceRequest {
  /** Node that should run the command. */
  readonly node: string;
  /** The allowlisted command, exactly as it appears in `ALLOWLIST`. */
  readonly command: string;
  /** The argv the runner will get, copied from the allowlist. */
  readonly argv: readonly string[];
  /** Chain this request belongs to; absent means "this connection's chain". */
  readonly chain?: string;
}

/** The frame form of a request, as the transport carries it. */
export interface DeviceRequestFrame {
  readonly t: typeof DEVICE_REQUEST_FRAME;
  readonly chain: string;
  readonly node: string;
  readonly command: string;
}

/** A grant as it appears in chain event data. */
export interface GrantPayload {
  readonly node: string;
  readonly enabled: boolean;
}

/** Runs one command. Injected: this module never spawns a process. */
export type DeviceRunner = (argv: readonly string[]) => string | Promise<string>;

export type BuildResult =
  | { readonly ok: true; readonly request: DeviceRequest }
  | Refusal;

export type ParseResult =
  | { readonly ok: true; readonly request: DeviceRequest; readonly chain: string }
  | Refusal;

export type GrantResult = { readonly ok: true; readonly grant: GrantPayload } | Refusal;

export interface BuildOptions {
  /** Chain the request is meant for, kept so the receiver can compare. */
  readonly chain?: string;
  /** Nodes of this chain; a request to any other node is refused. */
  readonly known?: readonly string[];
}

export interface ExecuteOptions {
  /** Grant payload for the addressed node; missing means "not granted". */
  readonly grant?: unknown;
  /** This node; a request addressed to anyone else is refused. */
  readonly self?: string;
  /** This node's chain; a request that names another chain is refused. */
  readonly chain?: string;
  /** Output cap in characters; defaults to `DEFAULT_MAX_OUTPUT_CHARS`. */
  readonly maxOutputChars?: number;
}

export type ExecuteResult =
  | {
      readonly accepted: true;
      /** Runner output, cut to the cap when `truncated` is true. */
      readonly output: string;
      readonly truncated: boolean;
      /** The argv the runner was given; always the allowlisted one. */
      readonly argv: readonly string[];
    }
  | { readonly accepted: false; readonly code: DeviceRefusalCode; readonly reason: string };

/**
 * Metacharacters, longest first where one contains another (`&&` before `&`,
 * `$(` before nothing else). The first hit decides the refusal code.
 */
const METACHARACTERS: readonly { readonly text: string; readonly code: DeviceRefusalCode }[] = [
  { text: "&&", code: "metacharacter-and" },
  { text: ";", code: "metacharacter-semicolon" },
  { text: "&", code: "metacharacter-ampersand" },
  { text: "|", code: "metacharacter-pipe" },
  { text: "`", code: "metacharacter-backtick" },
  { text: "$(", code: "metacharacter-substitution" },
  { text: "\n", code: "metacharacter-newline" },
  { text: "\r", code: "metacharacter-newline" },
  { text: ">", code: "metacharacter-redirect" },
  { text: "<", code: "metacharacter-redirect" },
];

function metacharacter(command: string): Refusal | null {
  for (const entry of METACHARACTERS) {
    if (command.includes(entry.text)) return refuse(entry.code);
  }
  return null;
}

function sameArgv(left: readonly string[] | undefined, right: readonly string[]): boolean {
  if (left === undefined || left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

/**
 * Turns a node and a command into a request, or refuses.
 *
 * `command` is matched against the allowlist byte for byte after trimming
 * outer whitespace: no case folding, no alias, no extra arguments. The argv in
 * the request always comes from the allowlist entry, never from the input.
 */
export function buildRequest(node: string, command: string, options: BuildOptions = {}): BuildResult {
  const wantedNode = typeof node === "string" ? node.trim() : "";
  if (wantedNode.length === 0) return refuse("invalid-node");

  if (options.known !== undefined && !options.known.includes(wantedNode)) {
    return refuse("unknown-node");
  }

  const text = typeof command === "string" ? command.trim() : "";
  if (text.length === 0) return refuse("empty-command");

  const bad = metacharacter(text);
  if (bad !== null) return bad;

  const entry = BY_COMMAND.get(text);
  if (entry === undefined) return refuse("unknown-command");

  return {
    ok: true,
    request: {
      node: wantedNode,
      command: entry.command,
      argv: [...entry.argv],
      ...(options.chain !== undefined ? { chain: options.chain } : {}),
    },
  };
}

/**
 * Validates a frame that arrived on the wire.
 *
 * The argv is not read from the frame: it is resolved from the allowlist. A
 * frame that carries its own argv is only accepted when that argv is exactly
 * the allowlisted one, so a tampered frame is refused rather than ignored.
 */
export function parseRequest(frame: unknown): ParseResult {
  if (typeof frame !== "object" || frame === null || Array.isArray(frame)) {
    return refuse("frame-shape");
  }
  const record = frame as Record<string, unknown>;
  if (record["t"] !== DEVICE_REQUEST_FRAME) return refuse("frame-type");

  const chain = record["chain"];
  if (typeof chain !== "string" || chain.trim().length === 0) return refuse("frame-chain");

  const node = record["node"];
  const command = record["command"];
  if (typeof node !== "string" || typeof command !== "string") return refuse("frame-shape");

  const built = buildRequest(node, command, { chain });
  if (!built.ok) return built;

  const claimed = record["argv"];
  if (claimed !== undefined) {
    if (!Array.isArray(claimed)) return refuse("argv-mismatch");
    const argv = claimed.filter((value): value is string => typeof value === "string");
    if (argv.length !== claimed.length) return refuse("argv-mismatch");
    if (!sameArgv(argv, built.request.argv)) return refuse("argv-mismatch");
  }

  return { ok: true, request: built.request, chain };
}

/** Frame for a request, so the daemon does not hand-assemble one. */
export function frameFor(request: DeviceRequest, chain: string): DeviceRequestFrame {
  return {
    t: DEVICE_REQUEST_FRAME,
    chain,
    node: request.node,
    command: request.command,
  };
}

/**
 * Validates one grant payload for one node. A grant that names another node
 * is not a grant for this one, and a disabled grant is a grant to say no.
 */
export function validateGrant(grant: unknown, node: string): GrantResult {
  const wanted = typeof node === "string" ? node.trim() : "";
  if (wanted.length === 0) return refuse("invalid-node");

  if (grant === undefined || grant === null) return refuse("grant-missing");
  if (typeof grant !== "object" || Array.isArray(grant)) return refuse("grant-invalid");

  const record = grant as Record<string, unknown>;
  const granted = record["node"];
  if (typeof granted !== "string" || granted.trim().length === 0) return refuse("grant-invalid");
  if (granted.trim() !== wanted) return refuse("grant-node-mismatch");

  const enabled = record["enabled"];
  if (typeof enabled !== "boolean") return refuse("grant-invalid");
  if (!enabled) return refuse("grant-disabled");

  return { ok: true, grant: { node: granted.trim(), enabled } };
}

/**
 * Folds the chain into the latest grant per node. Order is the chain's order
 * (ascending seq), so the last event for a node wins; a malformed payload is
 * skipped instead of wiping a grant that was already given.
 */
export function grantsFromEvents(events: readonly Event[]): Map<string, GrantPayload> {
  const grants = new Map<string, GrantPayload>();
  for (const event of events) {
    if (event.type !== DEVICE_GRANT_EVENT) continue;
    const data = event.data;
    if (typeof data !== "object" || data === null || Array.isArray(data)) continue;
    const record = data as Record<string, unknown>;
    const node = record["node"];
    const enabled = record["enabled"];
    if (typeof node !== "string" || node.trim().length === 0) continue;
    if (typeof enabled !== "boolean") continue;
    grants.set(node.trim(), { node: node.trim(), enabled });
  }
  return grants;
}

/** Whether the chain grants this node device control right now. */
export function isGranted(events: readonly Event[], node: string): boolean {
  const grant = grantsFromEvents(events).get(node);
  return grant !== undefined && grant.enabled;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer, got ${String(value)}`);
  }
  return value;
}

/**
 * Runs one validated request through the injected runner.
 *
 * Everything is checked again here, because this is the side that spends the
 * permission: the request must still name an allowlisted command, its argv
 * must be that command's argv, the node must be this node, the chain must be
 * this chain and the grant must be enabled for that node. Only then is the
 * runner called, and it is called with a copy of the allowlisted argv and
 * nothing else.
 */
export async function executeRequest(
  request: DeviceRequest,
  run: DeviceRunner,
  options: ExecuteOptions = {},
): Promise<ExecuteResult> {
  if (typeof request !== "object" || request === null) {
    return { accepted: false, ...toFailure(refuse("frame-shape")) };
  }

  const node = typeof request.node === "string" ? request.node.trim() : "";
  if (node.length === 0) return { accepted: false, ...toFailure(refuse("invalid-node")) };

  const command = typeof request.command === "string" ? request.command.trim() : "";
  if (command.length === 0) return { accepted: false, ...toFailure(refuse("empty-command")) };

  const bad = metacharacter(command);
  if (bad !== null) return { accepted: false, ...toFailure(bad) };

  const entry = BY_COMMAND.get(command);
  if (entry === undefined) return { accepted: false, ...toFailure(refuse("unknown-command")) };
  if (!sameArgv(request.argv, entry.argv)) {
    return { accepted: false, ...toFailure(refuse("argv-mismatch")) };
  }

  if (options.self !== undefined && node !== options.self) {
    return { accepted: false, ...toFailure(refuse("node-not-self")) };
  }
  if (options.chain !== undefined && request.chain !== undefined && request.chain !== options.chain) {
    return { accepted: false, ...toFailure(refuse("chain-mismatch")) };
  }

  const grant = validateGrant(options.grant, node);
  if (!grant.ok) return { accepted: false, ...toFailure(grant) };

  const cap = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
  positiveInteger(cap, "maxOutputChars");

  let output: unknown;
  try {
    output = await run([...entry.argv]);
  } catch (error: unknown) {
    return {
      accepted: false,
      code: "runner-failed",
      reason: `${REASONS["runner-failed"]}: ${messageOf(error)}`,
    };
  }
  if (typeof output !== "string") {
    return { accepted: false, ...toFailure(refuse("output-invalid")) };
  }

  const truncated = output.length > cap;
  return {
    accepted: true,
    output: truncated ? output.slice(0, cap) : output,
    truncated,
    argv: [...entry.argv],
  };
}

/** Drops the `ok` discriminant so a refusal fits an `ExecuteResult`. */
function toFailure(refusal: Refusal): { readonly code: DeviceRefusalCode; readonly reason: string } {
  return { code: refusal.code, reason: refusal.reason };
}
