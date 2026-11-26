import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { WebSocketServer, type WebSocket } from "ws";

import { parseArgv, USAGE } from "../cli/args.js";
import { expandHome } from "../cli/export.js";
import { EXIT_FAILED, EXIT_OK, EXIT_USAGE, main, type Io } from "../cli/roan.js";

/**
 * The CLI, end to end. Arguments are parsed here directly; everything that
 * touches a socket talks to a fake daemon on 127.0.0.1 that speaks the frame
 * shapes from `src/daemon/control.ts`. No real daemon, no port 6769, no chain.
 */

/* -------------------------------------------------------------------------- */
/* Fake daemon                                                                */
/* -------------------------------------------------------------------------- */

type Frame = Record<string, unknown>;

interface Fake {
  readonly url: string;
  readonly frames: Frame[];
  /** The state object the fake answers with; a test may mutate it. */
  readonly state: Record<string, unknown>;
}

interface FakeOptions {
  /** Start from this state instead of the default chain. */
  readonly state?: Record<string, unknown>;
  /** Handle a frame yourself; return false to let the default answer run. */
  readonly handle?: (frame: Frame, socket: WebSocket, fake: Fake) => boolean;
  /** Accept the socket and never answer anything (a hung daemon). */
  readonly mute?: boolean;
}

async function withFakeDaemon(options: FakeOptions, run: (fake: Fake) => Promise<void>): Promise<void> {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  const fake: Fake = {
    url: `ws://127.0.0.1:${String(port)}/`,
    frames: [],
    state: options.state ?? stateData(),
  };
  const sendState = (socket: WebSocket): void => {
    socket.send(JSON.stringify({ t: "state", data: fake.state }));
  };

  server.on("connection", (socket) => {
    // The real daemon greets every socket with a state frame; a muted fake says
    // nothing at all, so the client has to time out.
    if (options.mute !== true) sendState(socket);
    socket.on("message", (raw) => {
      const frame = JSON.parse(String(raw)) as Frame;
      fake.frames.push(frame);
      if (options.mute === true) return;
      if (options.handle?.(frame, socket, fake) === true) return;
      const type = frame["t"];
      if (type === "state") {
        sendState(socket);
        return;
      }
      if (type === "new_session") {
        // Append a conversation and push state, exactly as `onNewSession` does.
        const sessions = (fake.state["sessions"] as { id: string; title: string; messages: number }[]) ?? [];
        const created = { id: `s${String(sessions.length + 1)}`, title: "new chat", messages: 0 };
        fake.state["sessions"] = [...sessions, created];
        fake.state["activeSession"] = created.id;
        sendState(socket);
        return;
      }
      if (type === "export") {
        socket.send(JSON.stringify({ t: "reply", id: frame["req"], data: { ok: false, error: "unknown conversation" } }));
        return;
      }
      socket.send(JSON.stringify({ t: "reply", id: frame["req"], data: { ok: true } }));
    });
  });

  try {
    await run(fake);
  } finally {
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function stateData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    onboarding: false,
    chain: "chain-a",
    node: "node-a",
    head: 7,
    peers: ["node-b"],
    nodes: [{ node: "node-a", name: "laptop", host: "10.0.0.2", port: 7420, live: true }],
    invite: "code",
    model: "m1",
    provider: "p1",
    sessions: [
      { id: "s1", title: "first", messages: 2 },
      { id: "s2", title: "second", messages: 5 },
    ],
    activeSession: "s2",
    ...overrides,
  };
}

/**
 * Answers every `export` request with one fixed reply, so a test can decide
 * where the daemon "wrote" without repeating the frame shape.
 */
function exportReply(data: Record<string, unknown>) {
  return (frame: Frame, socket: WebSocket): boolean => {
    if (frame["t"] !== "export") return false;
    socket.send(JSON.stringify({ t: "reply", id: frame["req"], data }));
    return true;
  };
}

/* -------------------------------------------------------------------------- */
/* Harness                                                                    */
/* -------------------------------------------------------------------------- */

interface Recorder {
  readonly io: Io;
  readonly out: () => string;
  readonly err: () => string;
}

function recorder(): Recorder {
  const outLines: string[] = [];
  const errLines: string[] = [];
  return {
    io: {
      out: (text) => outLines.push(text),
      err: (text) => errLines.push(text),
    },
    out: () => outLines.join("\n"),
    err: () => errLines.join("\n"),
  };
}

/** Runs one command line against a fake daemon (or a given url). */
async function runCli(argv: readonly string[], timeoutMs = 2_000): Promise<{ code: number; out: string; err: string }> {
  const record = recorder();
  const code = await main(argv, record.io, {}, { timeoutMs });
  return { code, out: record.out(), err: record.err() };
}

/** Appends are fire-and-forget, so the far side may still be reading when `main` returns. */
async function waitForFrames(frames: Frame[], wanted: number): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (frames.length < wanted) {
    if (Date.now() > deadline) {
      throw new Error(`the fake daemon saw ${String(frames.length)} frames, expected ${String(wanted)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/* -------------------------------------------------------------------------- */
/* Arguments                                                                  */
/* -------------------------------------------------------------------------- */

describe("parseArgv", () => {
  it("defaults to the loopback port the daemon serves everything on", () => {
    const parsed = parseArgv(["state"], {});
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.command, { kind: "state", url: "ws://127.0.0.1:6769/", json: false });
  });

  it("prefers --url, then ROAN_CONTROL_URL, then host and port", () => {
    const fromFlag = parseArgv(["state", "--url", "ws://10.0.0.9:9000/"], {
      ROAN_CONTROL_URL: "ws://127.0.0.1:8000/",
    });
    assert.equal(fromFlag.ok && fromFlag.command.kind === "state" ? fromFlag.command.url : "", "ws://10.0.0.9:9000/");

    const fromEnv = parseArgv(["state"], { ROAN_CONTROL_URL: "ws://127.0.0.1:8000/" });
    assert.equal(fromEnv.ok && fromEnv.command.kind === "state" ? fromEnv.command.url : "", "ws://127.0.0.1:8000/");

    const fromParts = parseArgv(["state"], { ROAN_CONTROL_HOST: "100.64.0.5", ROAN_CONTROL_PORT: "7420" });
    assert.equal(fromParts.ok && fromParts.command.kind === "state" ? fromParts.command.url : "", "ws://100.64.0.5:7420/");

    const fromV6 = parseArgv(["state"], { ROAN_CONTROL_HOST: "::1" });
    assert.equal(fromV6.ok && fromV6.command.kind === "state" ? fromV6.command.url : "", "ws://[::1]:6769/");
  });

  it("refuses a port that is not a port, under the new name and the old one", () => {
    const parsed = parseArgv(["state"], { ROAN_PORT: "soon" });
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.match(parsed.error, /ROAN_PORT must be a port number, got "soon"/);

    const legacy = parseArgv(["state"], { ROAN_CONTROL_PORT: "soon" });
    assert.equal(legacy.ok, false);
  });

  it("reads ROAN_PORT before the deprecated ROAN_CONTROL_PORT", () => {
    const parsed = parseArgv(["state"], { ROAN_PORT: "8000", ROAN_CONTROL_PORT: "9000" });
    assert.equal(parsed.ok && parsed.command.kind === "state" ? parsed.command.url : "", "ws://127.0.0.1:8000/");
  });

  it("refuses a control url that is not a websocket", () => {
    const parsed = parseArgv(["state", "--url", "http://127.0.0.1:6769/"], {});
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.match(parsed.error, /must start with ws:\/\/ or wss:\/\//);
  });

  it("reads a value attached with =", () => {
    const parsed = parseArgv(["send", "hi", "--session=s1"], {});
    assert.equal(parsed.ok, true);
    if (!parsed.ok || parsed.command.kind !== "send") return assert.fail("expected a send command");
    assert.equal(parsed.command.session, "s1");
    assert.equal(parsed.command.text, "hi");
  });

  it("keeps the rest of the line as the message text", () => {
    const parsed = parseArgv(["send", "summarise", "the", "TODO", "file", "--json"], {});
    assert.equal(parsed.ok, true);
    if (!parsed.ok || parsed.command.kind !== "send") return assert.fail("expected a send command");
    assert.equal(parsed.command.text, "summarise the TODO file");
    assert.equal(parsed.command.json, true);
    assert.equal(parsed.command.session, null);
  });

  it("takes a literal that starts with a dash after --", () => {
    const parsed = parseArgv(["send", "--", "--not-a-flag"], {});
    assert.equal(parsed.ok, true);
    if (!parsed.ok || parsed.command.kind !== "send") return assert.fail("expected a send command");
    assert.equal(parsed.command.text, "--not-a-flag");
  });

  it("refuses an unknown option, a missing value and a repeated flag", () => {
    const unknown = parseArgv(["state", "--colour"], {});
    assert.equal(unknown.ok, false);
    if (!unknown.ok) assert.match(unknown.error, /unknown option "--colour"/);

    const missing = parseArgv(["state", "--url"], {});
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.match(missing.error, /--url needs a value/);

    const swallowed = parseArgv(["state", "--url", "--json"], {});
    assert.equal(swallowed.ok, false);
    if (!swallowed.ok) assert.match(swallowed.error, /--url needs a value, got "--json"/);

    const doubled = parseArgv(["state", "--url", "ws://a/", "--url", "ws://b/"], {});
    assert.equal(doubled.ok, false);
    if (!doubled.ok) assert.match(doubled.error, /--url is given twice/);

    const empty = parseArgv(["state", "--url="], {});
    assert.equal(empty.ok, false);
    if (!empty.ok) assert.match(empty.error, /--url needs a value/);
  });

  it("refuses a flag the subcommand does not use", () => {
    const parsed = parseArgv(["state", "--session", "s1"], {});
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.match(parsed.error, /state does not take --session/);
  });

  it("needs an export target and --out", () => {
    const noTarget = parseArgv(["export"], {});
    assert.equal(noTarget.ok, false);
    if (!noTarget.ok) assert.match(noTarget.error, /export needs a target/);

    const noOut = parseArgv(["export", "chain"], {});
    assert.equal(noOut.ok, false);
    if (!noOut.ok) assert.match(noOut.error, /export needs --out <path>/);

    const two = parseArgv(["export", "chain", "extra", "--out", "/tmp/x"], {});
    assert.equal(two.ok, false);
    if (!two.ok) assert.match(two.error, /export takes one target/);

    const ok = parseArgv(["export", "s1", "--out", "/tmp/x.json"], {});
    assert.equal(ok.ok, true);
    if (!ok.ok || ok.command.kind !== "export") return assert.fail("expected an export command");
    assert.equal(ok.command.what, "s1");
    assert.equal(ok.command.out, "/tmp/x.json");
  });

  it("refuses a send without text, and a new with a stray argument", () => {
    const empty = parseArgv(["send"], {});
    assert.equal(empty.ok, false);
    if (!empty.ok) assert.match(empty.error, /send needs text/);

    const blank = parseArgv(["send", "   "], {});
    assert.equal(blank.ok, false);
    if (!blank.ok) assert.match(blank.error, /non-empty text/);

    const stray = parseArgv(["new", "planning"], {});
    assert.equal(stray.ok, false);
    if (!stray.ok) assert.match(stray.error, /new takes no arguments/);
  });

  it("lets --help win over a half-written command", () => {
    const parsed = parseArgv(["send", "--help"], {});
    assert.deepEqual(parsed, { ok: true, command: { kind: "help" } });
    const short = parseArgv(["-h"], {});
    assert.deepEqual(short, { ok: true, command: { kind: "help" } });
  });

  it("refuses an unknown subcommand and an empty command line", () => {
    const unknown = parseArgv(["teleport"], {});
    assert.equal(unknown.ok, false);
    if (!unknown.ok) assert.match(unknown.error, /unknown subcommand "teleport"/);

    const none = parseArgv([], {});
    assert.equal(none.ok, false);
    if (!none.ok) assert.match(none.error, /no subcommand/);
  });

  it("documents every subcommand and every exit code in --help", () => {
    for (const word of ["state", "sessions", "send", "new", "export", "--json", "--url", "Exit codes"]) {
      assert.ok(USAGE.includes(word), `usage does not mention ${word}`);
    }
    assert.ok(USAGE.includes("2  the arguments were wrong"), "usage must say what exit 2 means");
  });
});

/* -------------------------------------------------------------------------- */
/* Commands over the socket                                                   */
/* -------------------------------------------------------------------------- */

describe("roan", () => {
  it("prints state as lines and as json", async () => {
    await withFakeDaemon({}, async (fake) => {
      const human = await runCli(["state", "--url", fake.url]);
      assert.equal(human.code, EXIT_OK);
      assert.match(human.out, /chain: {4}chain-a/);
      assert.match(human.out, /node: {5}laptop \(node-a\)/);
      assert.match(human.out, /head: {5}7/);
      assert.match(human.out, /peers: {4}node-b/);
      assert.match(human.out, /active: {3}second \(s2\)/);
      assert.equal(human.err, "");

      const json = await runCli(["state", "--json", "--url", fake.url]);
      assert.equal(json.code, EXIT_OK);
      const data = JSON.parse(json.out) as Record<string, unknown>;
      assert.equal(data["chain"], "chain-a");
      assert.deepEqual(data["sessions"], fake.state["sessions"]);
    });
  });

  it("says so when the daemon is onboarding", async () => {
    await withFakeDaemon({ state: stateData({ onboarding: true, chain: null, sessions: [], activeSession: null }) }, async (fake) => {
      const result = await runCli(["state", "--url", fake.url]);
      assert.equal(result.code, EXIT_OK);
      assert.match(result.out, /onboarding: no chain on this machine yet/);
    });
  });

  it("lists conversations", async () => {
    await withFakeDaemon({}, async (fake) => {
      const human = await runCli(["sessions", "--url", fake.url]);
      assert.equal(human.code, EXIT_OK);
      assert.match(human.out, /^2 conversations$/m);
      assert.match(human.out, /^s1 +2 +first$/m);
      assert.match(human.out, /^s2 +5 +second \(active\)$/m);

      const json = await runCli(["sessions", "--json", "--url", fake.url]);
      assert.equal(json.code, EXIT_OK);
      assert.deepEqual(JSON.parse(json.out), fake.state["sessions"]);
    });
  });

  it("prints one conversation in the singular", async () => {
    const only = [{ id: "s1", title: "first", messages: 2 }];
    await withFakeDaemon({ state: stateData({ sessions: only, activeSession: "s1" }) }, async (fake) => {
      const result = await runCli(["sessions", "--url", fake.url]);
      assert.match(result.out, /^1 conversation$/m);
    });
  });

  it("sends a message into the active conversation", async () => {
    await withFakeDaemon({}, async (fake) => {
      const result = await runCli(["send", "hello", "there", "--url", fake.url]);
      assert.equal(result.code, EXIT_OK);
      assert.match(result.out, /^sent .* to s2$/);
      await waitForFrames(fake.frames, 2);
      const append = fake.frames.find((frame) => frame["t"] === "append");
      const event = append?.["event"] as { id: string; data: { text: string; session?: string } } | undefined;
      assert.ok(event !== undefined, "the CLI never sent an append");
      assert.equal(event.data.text, "hello there");
      assert.equal(event.data.session, undefined);
    });
  });

  it("sends into a named conversation, and reports it as json", async () => {
    await withFakeDaemon({}, async (fake) => {
      const result = await runCli(["send", "hi", "--session", "s1", "--json", "--url", fake.url]);
      assert.equal(result.code, EXIT_OK);
      const printed = JSON.parse(result.out) as { id: string; session: string };
      assert.equal(printed.session, "s1");
      assert.ok(printed.id.length > 0);
      await waitForFrames(fake.frames, 2);
      const event = fake.frames.find((frame) => frame["t"] === "append")?.["event"] as {
        id: string;
        data: { text: string; session?: string };
      };
      assert.equal(event.id, printed.id);
      assert.equal(event.data.session, "s1");
    });
  });

  it("refuses to send into a conversation that is not there", async () => {
    await withFakeDaemon({}, async (fake) => {
      const result = await runCli(["send", "hi", "--session", "nope", "--url", fake.url]);
      assert.equal(result.code, EXIT_FAILED);
      assert.match(result.err, /no conversation "nope" in this chain/);
      assert.equal(fake.frames.some((frame) => frame["t"] === "append"), false);
    });
  });

  it("refuses to send with no chain", async () => {
    await withFakeDaemon({ state: stateData({ onboarding: true, chain: null }) }, async (fake) => {
      const result = await runCli(["send", "hi", "--url", fake.url]);
      assert.equal(result.code, EXIT_FAILED);
      assert.match(result.err, /no chain yet/);
      assert.equal(fake.frames.some((frame) => frame["t"] === "append"), false);
    });
  });

  it("starts a new conversation and names it", async () => {
    await withFakeDaemon({}, async (fake) => {
      const result = await runCli(["new", "--title", "planning", "--url", fake.url]);
      assert.equal(result.code, EXIT_OK);
      assert.equal(result.out, "started s3");
      const types = fake.frames.map((frame) => frame["t"]);
      assert.deepEqual(types.slice(0, 2), ["state", "new_session"]);
      assert.ok(types.slice(2).every((type) => type === "state"), `unexpected frames: ${types.join(", ")}`);
      assert.deepEqual(fake.frames[1], { t: "new_session", title: "planning" });
    });
  });

  it("starts a new conversation without a title, as json", async () => {
    await withFakeDaemon({}, async (fake) => {
      const result = await runCli(["new", "--json", "--url", fake.url]);
      assert.equal(result.code, EXIT_OK);
      assert.deepEqual(JSON.parse(result.out), { session: "s3" });
      assert.deepEqual(fake.frames[1], { t: "new_session" });
    });
  });

  it("says so when the daemon never reports the new conversation", async () => {
    await withFakeDaemon(
      {
        // Swallow the request and keep answering with the roster from before it.
        handle: (frame, socket, fake) => {
          if (frame["t"] === "new_session") return true;
          if (frame["t"] !== "state") return false;
          socket.send(JSON.stringify({ t: "state", data: fake.state }));
          return true;
        },
      },
      async (fake) => {
        const result = await runCli(["new", "--url", fake.url]);
        assert.equal(result.code, EXIT_FAILED);
        assert.match(result.err, /did not report a new conversation/);
      },
    );
  });

  it("refuses a new conversation with no chain", async () => {
    await withFakeDaemon({ state: stateData({ onboarding: true, chain: null }) }, async (fake) => {
      const result = await runCli(["new", "--url", fake.url]);
      assert.equal(result.code, EXIT_FAILED);
      assert.match(result.err, /no chain yet/);
      assert.equal(fake.frames.some((frame) => frame["t"] === "new_session"), false);
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Export                                                                     */
/* -------------------------------------------------------------------------- */

describe("roan export", () => {
  let scratch = "";

  before(async () => {
    scratch = await mkdtemp(join(tmpdir(), "roan-cli-"));
  });

  after(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it("copies the chain the daemon wrote to --out", async () => {
    const source = join(scratch, "chain-export.jsonl");
    await writeFile(source, '{"seq":1}\n{"seq":2}\n', "utf8");
    const out = join(scratch, "nested", "chain.jsonl");

    await withFakeDaemon(
      { handle: exportReply({ ok: true, path: source, shared: null, count: 2 }) },
      async (fake) => {
        const result = await runCli(["export", "chain", "--out", out, "--url", fake.url]);
        assert.equal(result.code, EXIT_OK);
        assert.equal(result.out, `exported 2 to ${out}`);
        assert.equal(await readFile(out, "utf8"), '{"seq":1}\n{"seq":2}\n');
        // The daemon's own copy stays where it was.
        assert.equal(await readFile(source, "utf8"), '{"seq":1}\n{"seq":2}\n');
        const request = fake.frames.find((frame) => frame["t"] === "export");
        assert.equal(request?.["what"], "chain");
      },
    );
  });

  it("puts the file inside an existing directory", async () => {
    const source = join(scratch, "session.md");
    await writeFile(source, "# first\n", "utf8");
    const outDir = join(scratch, "downloads");
    await mkdir(outDir, { recursive: true });

    await withFakeDaemon(
      { handle: exportReply({ ok: true, path: source, shared: null, count: 1 }) },
      async (fake) => {
        const result = await runCli(["export", "s1", "--out", outDir, "--json", "--url", fake.url]);
        assert.equal(result.code, EXIT_OK);
        const printed = JSON.parse(result.out) as { path: string; source: string };
        assert.equal(printed.path, join(outDir, "session.md"));
        assert.equal(printed.source, source);
        assert.equal(await readFile(join(outDir, "session.md"), "utf8"), "# first\n");
      },
    );
  });

  it("copies a session folder with its attachments", async () => {
    const source = join(scratch, "s2-folder");
    await mkdir(join(source, "images"), { recursive: true });
    await writeFile(join(source, "session.md"), "hi\n", "utf8");
    await writeFile(join(source, "images", "1.png"), "png", "utf8");
    const out = join(scratch, "copied-folder");

    await withFakeDaemon(
      { handle: exportReply({ ok: true, path: source, shared: null, count: 2 }) },
      async (fake) => {
        const result = await runCli(["export", "s2", "--out", out, "--url", fake.url]);
        assert.equal(result.code, EXIT_OK);
        assert.equal(await readFile(join(out, "images", "1.png"), "utf8"), "png");
      },
    );
  });

  it("reports a refusal from the daemon and writes nothing", async () => {
    const out = join(scratch, "never.jsonl");
    await withFakeDaemon({}, async (fake) => {
      const result = await runCli(["export", "ghost", "--out", out, "--url", fake.url]);
      assert.equal(result.code, EXIT_FAILED);
      assert.match(result.err, /export refused: unknown conversation/);
      await assert.rejects(() => readFile(out, "utf8"));
    });
  });

  it("reports an export the daemon named but did not write", async () => {
    const missing = join(scratch, "vanished.jsonl");
    await withFakeDaemon(
      { handle: exportReply({ ok: true, path: missing, shared: null, count: 1 }) },
      async (fake) => {
        const result = await runCli(["export", "chain", "--out", join(scratch, "x.jsonl"), "--url", fake.url]);
        assert.equal(result.code, EXIT_FAILED);
        assert.match(result.err, /said it exported to .* but nothing is there/);
      },
    );
  });

  it("expands a home-relative --out", () => {
    assert.equal(expandHome("~"), homedir());
    assert.equal(expandHome("~/x"), join(homedir(), "x"));
    assert.equal(expandHome("/tmp/x"), "/tmp/x");
  });
});

/* -------------------------------------------------------------------------- */
/* Failures                                                                   */
/* -------------------------------------------------------------------------- */

describe("roan failures", () => {
  it("exits 1 with one line when no daemon answers", async () => {
    // A port nobody listens on: bound once to learn a free one, then released.
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;
    await new Promise<void>((resolve) => server.close(() => resolve()));

    const result = await runCli(["state", "--url", `ws://127.0.0.1:${String(port)}/`], 1_000);
    assert.equal(result.code, EXIT_FAILED);
    assert.match(result.err, /^roan: /);
    assert.equal(result.err.split("\n").length, 1, `stderr must be one line, got: ${result.err}`);
    assert.equal(result.err.includes("    at "), false, "no stack trace on stderr");
    assert.equal(result.out, "");
  });

  it("exits 1 when the daemon accepts and never answers", async () => {
    await withFakeDaemon({ mute: true }, async (fake) => {
      const result = await runCli(["state", "--url", fake.url], 200);
      assert.equal(result.code, EXIT_FAILED);
      assert.match(result.err, /did not answer a state request/);
    });
  });

  it("exits 2 on bad arguments without touching the network", async () => {
    const result = await runCli(["state", "--url", "ws://127.0.0.1:1/", "--nope"]);
    assert.equal(result.code, EXIT_USAGE);
    assert.match(result.err, /unknown option "--nope"/);
    assert.match(result.err, /run `roan --help` for usage/);
    assert.equal(result.out, "");
  });

  it("prints usage to stdout for --help", async () => {
    const result = await runCli(["--help"]);
    assert.equal(result.code, EXIT_OK);
    assert.equal(result.out, USAGE);
    assert.equal(result.err, "");
  });
});
