/**
 * `roan` argument parsing, by hand and without dependencies.
 *
 * The CLI is the one surface that must run from a checkout with nothing but
 * Node installed, so it parses its own flags instead of pulling in a parser.
 * The rules it keeps:
 *
 * - A flag is `--name value` or `--name=value`; `--` ends flag parsing.
 * - Flags may sit before or after the subcommand. A flag a subcommand does not
 *   use is refused rather than ignored: a typo that silently does nothing is
 *   worse than an error at exit 2.
 * - Every failure here is a usage failure: nothing has been sent to the daemon.
 */

/** Loopback, matching `src/daemon/main.ts`; a bare `roan` points here. */
const DEFAULT_CONTROL_HOST = "127.0.0.1";
const DEFAULT_CONTROL_PORT = 7411;

/** Every option that takes a value. `--json` and `--help` are switches. */
const VALUE_FLAGS = ["--url", "--session", "--out", "--title"] as const;

interface BaseCommand {
  /** The control port this invocation talks to. */
  readonly url: string;
  /** Print the daemon's answer as JSON instead of a line of text. */
  readonly json: boolean;
}

export interface HelpCommand {
  readonly kind: "help";
}

export interface StateCommand extends BaseCommand {
  readonly kind: "state";
}

export interface SessionsCommand extends BaseCommand {
  readonly kind: "sessions";
}

export interface SendCommand extends BaseCommand {
  readonly kind: "send";
  readonly text: string;
  /** `null` when the daemon should pick the active conversation itself. */
  readonly session: string | null;
}

export interface NewCommand extends BaseCommand {
  readonly kind: "new";
  readonly title: string | null;
}

export interface ExportCommand extends BaseCommand {
  readonly kind: "export";
  /** `"chain"` or a conversation id. */
  readonly what: string;
  /** Where to put the copy; the daemon's own export file stays where it is. */
  readonly out: string;
}

export type Command = HelpCommand | StateCommand | SessionsCommand | SendCommand | NewCommand | ExportCommand;

export type ParseOutcome =
  | { readonly ok: true; readonly command: Command }
  | { readonly ok: false; readonly error: string };

/** Flags each subcommand accepts beyond `--url` and `--json`. */
const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  state: [],
  sessions: [],
  send: ["--session"],
  new: ["--title"],
  export: ["--out"],
};

export const USAGE = `roan — talk to the daemon's control port from a terminal.

Usage
  roan <command> [options]

Commands
  state                        Print the chain, node, head and model
  sessions                     List the conversations in this chain
  send <text> [--session id]   Append a message, then run the turn
  new [--title text]           Start a new conversation
  export <chain|session> --out <path>
                               Copy the chain or one conversation to <path>
  help                         Show this text

Options
  --url <ws-url>   The control port. Default ws://127.0.0.1:7411/, or
                   ROAN_CONTROL_URL, or ROAN_CONTROL_HOST + ROAN_CONTROL_PORT.
  --json           Print the daemon's answer as JSON.
  -h, --help       Show this text.

Exit codes
  0  the command did what it said
  1  the daemon refused, was not reachable, or something failed
  2  the arguments were wrong; nothing was sent

Examples
  roan state --json
  roan send "summarise TODO.md" --session 0b1c2d3e
  roan export chain --out ~/chain.jsonl
`;

function fail(error: string): ParseOutcome {
  return { ok: false, error };
}

function valueOf(token: string): string | null {
  return (VALUE_FLAGS as readonly string[]).includes(token) ? token : null;
}

function looksLikeFlag(value: string): boolean {
  return value.length > 1 && value.startsWith("-");
}

/**
 * Resolves the control url: the flag wins over `ROAN_CONTROL_URL`, which wins
 * over `ROAN_CONTROL_HOST`/`ROAN_CONTROL_PORT`, which default to loopback 7411.
 * Only `ws:` and `wss:` are accepted — an `http://` typo would otherwise hang
 * until the connect timeout instead of saying what is wrong.
 */
function resolveUrl(
  flag: string | undefined,
  env: Readonly<Record<string, string | undefined>>,
): { ok: true; url: string } | { ok: false; error: string } {
  const configured = flag ?? env["ROAN_CONTROL_URL"];
  let raw: string;
  if (configured !== undefined && configured.trim().length > 0) {
    raw = configured.trim();
  } else {
    const host = (env["ROAN_CONTROL_HOST"] ?? "").trim() || DEFAULT_CONTROL_HOST;
    const port = (env["ROAN_CONTROL_PORT"] ?? "").trim() || String(DEFAULT_CONTROL_PORT);
    const number = Number(port);
    if (!/^\d+$/.test(port) || !Number.isInteger(number) || number < 1 || number > 65_535) {
      return { ok: false, error: `ROAN_CONTROL_PORT must be a port number, got ${JSON.stringify(port)}` };
    }
    // A bare ipv6 literal needs brackets in a url; a bracketed one is left alone.
    const authority = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
    raw = `ws://${authority}:${String(number)}/`;
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: `the control url is not a url: ${JSON.stringify(raw)}` };
  }
  if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
    return {
      ok: false,
      error: `the control url must start with ws:// or wss://, got ${JSON.stringify(parsed.protocol.replace(/:$/, ""))}`,
    };
  }
  if (parsed.hostname.length === 0) {
    return { ok: false, error: `the control url has no host: ${JSON.stringify(raw)}` };
  }
  return { ok: true, url: parsed.toString() };
}

function joinArgs(words: readonly string[]): string {
  return words.join(" ");
}

/**
 * Parses one command line, `argv` without the `node` and script parts.
 *
 * `env` is passed in rather than read here so the tests can pin it.
 */
export function parseArgv(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>> = {},
): ParseOutcome {
  const words: string[] = [];
  const flags = new Map<string, string>();
  let json = false;
  let help = false;
  let literal = false;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] ?? "";
    if (literal) {
      words.push(token);
      continue;
    }
    if (token === "--") {
      literal = true;
      continue;
    }
    if (token === "--help" || token === "-h") {
      help = true;
      continue;
    }
    if (token === "--json") {
      json = true;
      continue;
    }
    // `--name=value` is the same flag with its value attached.
    const equals = token.indexOf("=");
    const inline = token.startsWith("--") && equals > 2 ? token.slice(0, equals) : null;
    const name = inline ?? token;
    if (valueOf(name) !== null) {
      if (flags.has(name)) return fail(`${name} is given twice`);
      const attached = inline !== null ? token.slice(equals + 1) : undefined;
      if (attached !== undefined) {
        if (attached.length === 0) return fail(`${name} needs a value`);
        flags.set(name, attached);
        continue;
      }
      const next = argv[i + 1];
      if (next === undefined) return fail(`${name} needs a value`);
      if (looksLikeFlag(next)) return fail(`${name} needs a value, got ${JSON.stringify(next)}`);
      flags.set(name, next);
      i += 1;
      continue;
    }
    if (looksLikeFlag(token)) return fail(`unknown option ${JSON.stringify(token)}`);
    words.push(token);
  }

  // `--help` wins over a half-written command, but not over a broken flag: the
  // loop above has already reported that.
  if (help) return { ok: true, command: { kind: "help" } };

  const what = words[0];
  if (what === undefined) return fail("no subcommand; run `roan --help`");
  const rest = words.slice(1);
  if (what === "help") return { ok: true, command: { kind: "help" } };
  const allowed = ALLOWED[what];
  if (allowed === undefined) return fail(`unknown subcommand ${JSON.stringify(what)}; run \`roan --help\``);

  for (const flag of flags.keys()) {
    // `--url` is the one flag every subcommand takes; the rest are per-verb.
    if (flag === "--url") continue;
    if (!allowed.includes(flag)) return fail(`${what} does not take ${flag}`);
  }

  const resolved = resolveUrl(flags.get("--url"), env);
  if (!resolved.ok) return fail(resolved.error);
  const base = { url: resolved.url, json };

  switch (what) {
    case "state":
    case "sessions": {
      if (rest.length > 0) return fail(`${what} takes no arguments, got ${JSON.stringify(rest[0])}`);
      return { ok: true, command: { kind: what, ...base } };
    }
    case "send": {
      if (rest.length === 0) return fail("send needs text: roan send <text> [--session id]");
      const text = joinArgs(rest);
      if (text.trim().length === 0) return fail("send needs non-empty text");
      const session = flags.get("--session") ?? null;
      return { ok: true, command: { kind: "send", text, session, ...base } };
    }
    case "new": {
      if (rest.length > 0) return fail(`new takes no arguments (use --title), got ${JSON.stringify(rest[0])}`);
      const title = flags.get("--title") ?? null;
      if (title !== null && title.trim().length === 0) return fail("--title needs non-empty text");
      return { ok: true, command: { kind: "new", title, ...base } };
    }
    case "export": {
      if (rest.length === 0) return fail("export needs a target: chain or a conversation id");
      if (rest.length > 1) return fail(`export takes one target, got ${JSON.stringify(rest[1])}`);
      const target = rest[0] ?? "";
      if (target.trim().length === 0) return fail("export needs a target: chain or a conversation id");
      const out = flags.get("--out");
      if (out === undefined) return fail("export needs --out <path>");
      return { ok: true, command: { kind: "export", what: target, out, ...base } };
    }
    default:
      // `ALLOWED` and this switch list the same names; a new subcommand must
      // be added to both.
      return fail(`unknown subcommand ${JSON.stringify(what)}; run \`roan --help\``);
  }
}
