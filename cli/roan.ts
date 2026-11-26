#!/usr/bin/env node
/**
 * `roan` — the headless face of the app, over the daemon's control port.
 *
 * Five verbs, no dependencies, one socket. It is deliberately thin: the daemon
 * owns the chain and the turn, so the CLI can only read state, append a
 * message, start a conversation, list them and export one. Nothing here
 * re-implements protocol — `sdk/client.ts` speaks it.
 *
 * The shape a script relies on:
 *
 *   exit 0  the command did what it said
 *   exit 1  the daemon refused, was not reachable, or the export did not land
 *   exit 2  the arguments were wrong; nothing was sent
 *
 * Everything it reports goes to stdout, every failure to stderr as one line —
 * no stack traces, because a script reads the exit code and a person reads the
 * line.
 */

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { DaemonState } from "../sdk/client.js";
import { parseArgv, USAGE, type Command } from "./args.js";
import { copyExport } from "./export.js";
import { openLink, type Link } from "./link.js";

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_USAGE = 2;

export interface Io {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}

export interface MainDeps {
  /** Shortens the request timeout; the tests use it, the CLI leaves it alone. */
  readonly timeoutMs?: number;
}

/* -------------------------------------------------------------------------- */
/* Human output                                                               */
/* -------------------------------------------------------------------------- */

function formatState(state: DaemonState): string {
  if (state.onboarding) return "onboarding: no chain on this machine yet";
  const sessions = state.sessions ?? [];
  const active = sessions.find((entry) => entry.id === state.activeSession);
  const node = state.nodes.find((entry) => entry.node === state.node);
  const lines = [
    `chain:    ${state.chain ?? "-"}`,
    `node:     ${node === undefined ? (state.node ?? "-") : `${node.name} (${node.node})`}`,
    `head:     ${String(state.head)}`,
    `peers:    ${state.peers.length === 0 ? "none" : state.peers.join(", ")}`,
    `model:    ${state.model ?? "-"}${state.provider !== undefined ? ` via ${state.provider}` : ""}`,
    `sessions: ${String(sessions.length)}`,
    `active:   ${active === undefined ? "-" : `${active.title} (${active.id})`}`,
  ];
  return lines.join("\n");
}

function formatSessions(state: DaemonState): string {
  const sessions = state.sessions ?? [];
  if (sessions.length === 0) return "no conversations yet";
  const idWidth = Math.max(...sessions.map((entry) => entry.id.length));
  const lines = sessions.map((entry) => {
    const marker = entry.id === state.activeSession ? " (active)" : "";
    const title = entry.title.length > 0 ? entry.title : "(untitled)";
    return `${entry.id.padEnd(idWidth)}  ${String(entry.messages).padStart(3)}  ${title}${marker}`;
  });
  return [`${String(sessions.length)} conversation${sessions.length === 1 ? "" : "s"}`, ...lines].join("\n");
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requireChain(state: DaemonState): void {
  if (state.onboarding || state.chain === null) {
    throw new Error("this daemon has no chain yet; create or join one in the app first");
  }
}

/**
 * Finds the conversation that `new_session` just started.
 *
 * `new_session` is fire-and-forget and a `state` request carries no id, so the
 * sdk hands every state frame to the oldest waiter: the greeting the daemon
 * sends on connect takes the first slot, which leaves the next reading one
 * frame behind. So a single read right after the mutation can still show the
 * roster from before it. Read until the roster actually gained a conversation,
 * and fail plainly rather than report a conversation that was never created.
 */
async function confirmNewSession(link: Link, known: ReadonlySet<string>): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const after = await link.state();
    const added = (after.sessions ?? []).find((entry) => !known.has(entry.id));
    if (added !== undefined) return added.id;
  }
  throw new Error("the daemon did not report a new conversation");
}

/* -------------------------------------------------------------------------- */
/* Commands                                                                   */
/* -------------------------------------------------------------------------- */

async function run(command: Exclude<Command, { kind: "help" }>, io: Io, deps: MainDeps): Promise<number> {
  const link: Link = openLink(command.url, deps.timeoutMs !== undefined ? { timeoutMs: deps.timeoutMs } : {});
  try {
    switch (command.kind) {
      case "state": {
        const state = await link.state();
        io.out(command.json ? JSON.stringify(state, null, 2) : formatState(state));
        return EXIT_OK;
      }
      case "sessions": {
        const state = await link.state();
        io.out(command.json ? JSON.stringify(state.sessions ?? [], null, 2) : formatSessions(state));
        return EXIT_OK;
      }
      case "send": {
        const state = await link.state();
        requireChain(state);
        const sessions = state.sessions ?? [];
        if (command.session !== null && !sessions.some((entry) => entry.id === command.session)) {
          throw new Error(
            `no conversation ${JSON.stringify(command.session)} in this chain; \`roan sessions\` lists them`,
          );
        }
        // Where it lands, so the answer is useful even without --session: the
        // daemon appends to the active conversation when none is named.
        const target = command.session ?? state.activeSession ?? null;
        const id = await link.send(command.text, command.session ?? undefined);
        if (command.json) {
          io.out(JSON.stringify({ id, session: target }, null, 2));
        } else {
          io.out(`sent ${id}${target === null ? "" : ` to ${target}`}`);
        }
        return EXIT_OK;
      }
      case "new": {
        const before = await link.state();
        requireChain(before);
        const known = new Set((before.sessions ?? []).map((entry) => entry.id));
        await link.newSession(command.title ?? undefined);
        // The daemon pushes a state frame instead of replying; the roster has
        // to be read back to name the conversation that was not there before.
        const id = await confirmNewSession(link, known);
        io.out(command.json ? JSON.stringify({ session: id }, null, 2) : `started ${id}`);
        return EXIT_OK;
      }
      case "export": {
        const reply = await link.export(command.what);
        if (!reply.ok) throw new Error(`export refused: ${reply.error}`);
        const path = await copyExport(reply.path, command.out);
        if (command.json) {
          io.out(JSON.stringify({ path, source: reply.path, count: reply.count, shared: reply.shared }, null, 2));
        } else {
          io.out(`exported ${String(reply.count)} to ${path}`);
        }
        return EXIT_OK;
      }
    }
  } finally {
    link.close();
  }
}

/**
 * One run: parse, then either print usage or talk to the daemon once.
 *
 * `env` is a parameter so the tests can pin the control url; `process.env` is
 * what the binary passes.
 */
export async function main(
  argv: readonly string[],
  io: Io,
  env: Readonly<Record<string, string | undefined>> = process.env,
  deps: MainDeps = {},
): Promise<number> {
  const parsed = parseArgv(argv, env);
  if (!parsed.ok) {
    io.err(`roan: ${parsed.error}`);
    io.err("run `roan --help` for usage");
    return EXIT_USAGE;
  }
  if (parsed.command.kind === "help") {
    io.out(USAGE);
    return EXIT_OK;
  }
  try {
    return await run(parsed.command, io, deps);
  } catch (error) {
    // One line, no stack: a daemon refusal and a broken socket read the same
    // to a script, and neither is a crash in this program.
    io.err(`roan: ${messageOf(error)}`);
    return EXIT_FAILED;
  }
}

/* -------------------------------------------------------------------------- */

/** True when this file was started directly (`node cli/roan.ts`), not imported. */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return resolve(entry) === fileURLToPath(import.meta.url);
  }
}

if (isEntryPoint()) {
  const code = await main(process.argv.slice(2), {
    out: (text) => process.stdout.write(`${text}\n`),
    err: (text) => process.stderr.write(`${text}\n`),
  });
  process.exitCode = code;
}
