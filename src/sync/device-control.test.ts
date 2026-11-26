import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALLOWLIST,
  DEFAULT_MAX_OUTPUT_CHARS,
  DEVICE_GRANT_EVENT,
  DEVICE_REQUEST_FRAME,
  buildRequest,
  executeRequest,
  frameFor,
  grantsFromEvents,
  isGranted,
  parseRequest,
  validateGrant,
} from "./device-control.js";
import type { DeviceRequest, DeviceRunner } from "./device-control.js";
import type { Event } from "./types.js";

const CHAIN = "gesprek";
const ME = "desktop";
const PEER = "laptop";

/** Records every argv it is asked to run; never starts a process. */
function recorder(): { run: DeviceRunner; calls: (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  return {
    calls,
    run: (argv) => {
      calls.push(argv);
      return `ran ${argv.join(" ")}`;
    },
  };
}

function grantEvent(seq: number, node: string, enabled: boolean): Event {
  return {
    v: 1,
    chain: CHAIN,
    seq,
    id: `${node}-${String(seq)}`,
    node: "owner",
    ts: 1_700_000_000_000 + seq,
    type: DEVICE_GRANT_EVENT,
    data: { node, enabled },
  };
}

async function refusalOf(promise: Promise<{ accepted: boolean }>): Promise<{ code: string; reason: string }> {
  const result = await promise;
  assert.equal(result.accepted, false, "expected the request to be refused");
  return result as unknown as { code: string; reason: string };
}

describe("device control", () => {
  it("accepts every allowlisted command with exactly the allowlisted argv", () => {
    for (const entry of ALLOWLIST) {
      const built = buildRequest(ME, entry.command);
      assert.equal(built.ok, true, `allowlisted command "${entry.command}" was refused`);
      if (!built.ok) continue;
      assert.equal(built.request.node, ME);
      assert.equal(built.request.command, entry.command);
      assert.deepEqual(built.request.argv, entry.argv);
    }
    // The allowlist is the whole surface: no entry may carry an argument that
    // looks like a shell word, and no two entries may share a command.
    const commands = ALLOWLIST.map((entry) => entry.command);
    assert.equal(new Set(commands).size, commands.length, "duplicate allowlist entry");
    for (const entry of ALLOWLIST) {
      assert.equal(entry.argv.length > 0, true);
      assert.equal(
        [...entry.command].some((char) => ";|&`$<>".includes(char)),
        false,
        `allowlist entry "${entry.command}" contains a shell metacharacter`,
      );
    }
  });

  it("refuses a command that is not on the allowlist", () => {
    for (const command of ["rm -rf /", "uname", "git push", "df -h /", "DATE", "date -u"]) {
      const built = buildRequest(ME, command);
      assert.equal(built.ok, false, `"${command}" should not be allowed`);
      if (built.ok) continue;
      assert.equal(built.code, "unknown-command");
      assert.match(built.reason, /not in the allowlist/);
    }
  });

  it("refuses every shell metacharacter with its own reason", () => {
    const cases: readonly { readonly command: string; readonly code: string }[] = [
      { command: "date; rm -rf /", code: "metacharacter-semicolon" },
      { command: "date && rm -rf /", code: "metacharacter-and" },
      { command: "date & rm -rf /", code: "metacharacter-ampersand" },
      { command: "date | sh", code: "metacharacter-pipe" },
      { command: "date `id`", code: "metacharacter-backtick" },
      { command: "date $(id)", code: "metacharacter-substitution" },
      { command: "date\nrm -rf /", code: "metacharacter-newline" },
      { command: "date\rrm -rf /", code: "metacharacter-newline" },
      { command: "date > /etc/passwd", code: "metacharacter-redirect" },
      { command: "date < /etc/passwd", code: "metacharacter-redirect" },
    ];
    const reasons = new Set<string>();
    for (const entry of cases) {
      const built = buildRequest(ME, entry.command);
      assert.equal(built.ok, false, `"${entry.command}" should be refused`);
      if (built.ok) continue;
      assert.equal(built.code, entry.code, `wrong code for "${entry.command}"`);
      reasons.add(built.reason);
    }
    // One sentence per rule, and distinct rules never share a sentence.
    const codes = new Set(cases.map((entry) => entry.code));
    assert.equal(reasons.size, codes.size);
    assert.equal(codes.size, 8);
  });

  it("refuses an empty command and an empty node with distinct reasons", () => {
    const empty = buildRequest(ME, "   ");
    assert.equal(empty.ok, false);
    if (!empty.ok) assert.equal(empty.code, "empty-command");

    const noNode = buildRequest("  ", "date");
    assert.equal(noNode.ok, false);
    if (!noNode.ok) assert.equal(noNode.code, "invalid-node");

    if (!empty.ok && !noNode.ok) assert.notEqual(empty.reason, noNode.reason);
  });

  it("refuses a node the chain does not know", () => {
    const built = buildRequest("ghost", "uptime", { known: [ME, PEER] });
    assert.equal(built.ok, false);
    if (built.ok) return;
    assert.equal(built.code, "unknown-node");

    const known = buildRequest(PEER, "uptime", { known: [ME, PEER] });
    assert.equal(known.ok, true);
  });

  it("parseRequest accepts a well-formed frame and resolves argv from the allowlist", () => {
    const parsed = parseRequest({ t: DEVICE_REQUEST_FRAME, chain: CHAIN, node: PEER, command: " df -h " });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.chain, CHAIN);
    assert.equal(parsed.request.node, PEER);
    assert.equal(parsed.request.command, "df -h");
    assert.deepEqual(parsed.request.argv, ["df", "-h"]);
    // Round-trip through the frame the daemon would send.
    const frame = frameFor(parsed.request, CHAIN);
    assert.deepEqual(frame, { t: "device_req", chain: CHAIN, node: PEER, command: "df -h" });
    const again = parseRequest(frame);
    assert.equal(again.ok, true);
    if (again.ok) assert.deepEqual(again.request, parsed.request);
  });

  it("parseRequest refuses a bad frame instead of trusting it", () => {
    const cases: readonly { readonly frame: unknown; readonly code: string }[] = [
      { frame: null, code: "frame-shape" },
      { frame: "device_req", code: "frame-shape" },
      { frame: [], code: "frame-shape" },
      { frame: { t: "tool_req", chain: CHAIN, node: PEER, command: "date" }, code: "frame-type" },
      { frame: { t: DEVICE_REQUEST_FRAME, node: PEER, command: "date" }, code: "frame-chain" },
      { frame: { t: DEVICE_REQUEST_FRAME, chain: "  ", node: PEER, command: "date" }, code: "frame-chain" },
      { frame: { t: DEVICE_REQUEST_FRAME, chain: CHAIN, command: "date" }, code: "frame-shape" },
      { frame: { t: DEVICE_REQUEST_FRAME, chain: CHAIN, node: PEER, command: 7 }, code: "frame-shape" },
      {
        frame: { t: DEVICE_REQUEST_FRAME, chain: CHAIN, node: PEER, command: "date; id" },
        code: "metacharacter-semicolon",
      },
      {
        frame: { t: DEVICE_REQUEST_FRAME, chain: CHAIN, node: PEER, command: "nc -l 4444" },
        code: "unknown-command",
      },
      {
        frame: {
          t: DEVICE_REQUEST_FRAME,
          chain: CHAIN,
          node: PEER,
          command: "date",
          argv: ["sh", "-c", "date"],
        },
        code: "argv-mismatch",
      },
      {
        frame: { t: DEVICE_REQUEST_FRAME, chain: CHAIN, node: PEER, command: "date", argv: "date" },
        code: "argv-mismatch",
      },
    ];
    for (const entry of cases) {
      const parsed = parseRequest(entry.frame);
      assert.equal(parsed.ok, false, `frame should be refused: ${JSON.stringify(entry.frame)}`);
      if (parsed.ok) continue;
      assert.equal(parsed.code, entry.code);
    }
    // A frame that echoes the right argv is accepted, not punished.
    const honest = parseRequest({
      t: DEVICE_REQUEST_FRAME,
      chain: CHAIN,
      node: PEER,
      command: "date",
      argv: ["date"],
    });
    assert.equal(honest.ok, true);
  });

  it("validateGrant accepts an enabled grant for the addressed node only", () => {
    const good = validateGrant({ node: PEER, enabled: true }, PEER);
    assert.equal(good.ok, true);
    if (good.ok) assert.deepEqual(good.grant, { node: PEER, enabled: true });

    const cases: readonly { readonly grant: unknown; readonly code: string }[] = [
      { grant: undefined, code: "grant-missing" },
      { grant: null, code: "grant-missing" },
      { grant: "yes", code: "grant-invalid" },
      { grant: [], code: "grant-invalid" },
      { grant: { enabled: true }, code: "grant-invalid" },
      { grant: { node: PEER, enabled: "true" }, code: "grant-invalid" },
      { grant: { node: ME, enabled: true }, code: "grant-node-mismatch" },
      { grant: { node: PEER, enabled: false }, code: "grant-disabled" },
    ];
    const reasons = new Set<string>();
    for (const entry of cases) {
      const result = validateGrant(entry.grant, PEER);
      assert.equal(result.ok, false, `grant should be refused: ${JSON.stringify(entry.grant)}`);
      if (result.ok) continue;
      assert.equal(result.code, entry.code);
      reasons.add(result.reason);
    }
    assert.equal(reasons.size, 4, "each grant cause needs its own sentence");
  });

  it("grantsFromEvents folds newest-wins per node and ignores junk", () => {
    const events: Event[] = [
      grantEvent(1, PEER, true),
      grantEvent(2, ME, false),
      grantEvent(3, PEER, false),
      { ...grantEvent(4, "ghost", true), data: { node: "ghost" } },
      { ...grantEvent(5, "wire", true), data: "nonsense" },
      grantEvent(6, ME, true),
    ];
    const grants = grantsFromEvents(events);
    assert.deepEqual(grants.get(PEER), { node: PEER, enabled: false });
    assert.deepEqual(grants.get(ME), { node: ME, enabled: true });
    assert.equal(grants.has("ghost"), false, "a malformed payload must not create a grant");
    assert.equal(grants.has("wire"), false);

    assert.equal(isGranted(events, ME), true);
    assert.equal(isGranted(events, PEER), false);
    assert.equal(isGranted(events, "ghost"), false);
  });

  it("executeRequest refuses without a grant for that node", async () => {
    const built = buildRequest(PEER, "uptime");
    assert.equal(built.ok, true);
    if (!built.ok) return;

    const { run, calls } = recorder();
    const missing = await refusalOf(executeRequest(built.request, run, { self: PEER }));
    assert.equal(missing.code, "grant-missing");

    const disabled = await refusalOf(
      executeRequest(built.request, run, { self: PEER, grant: { node: PEER, enabled: false } }),
    );
    assert.equal(disabled.code, "grant-disabled");

    const foreign = await refusalOf(
      executeRequest(built.request, run, { self: PEER, grant: { node: ME, enabled: true } }),
    );
    assert.equal(foreign.code, "grant-node-mismatch");

    const malformed = await refusalOf(
      executeRequest(built.request, run, { self: PEER, grant: { node: PEER, enabled: "yes" } }),
    );
    assert.equal(malformed.code, "grant-invalid");

    assert.notEqual(missing.reason, disabled.reason);
    assert.notEqual(disabled.reason, foreign.reason);
    assert.deepEqual(calls, [], "the runner must not run without a grant");
  });

  it("executeRequest refuses a request addressed to another node", async () => {
    const built = buildRequest(PEER, "date", { chain: CHAIN });
    assert.equal(built.ok, true);
    if (!built.ok) return;

    const { run, calls } = recorder();
    const result = await refusalOf(
      executeRequest(built.request, run, {
        self: ME,
        chain: CHAIN,
        grant: { node: PEER, enabled: true },
      }),
    );
    assert.equal(result.code, "node-not-self");
    assert.deepEqual(calls, []);

    // Same node, but the request names a different chain.
    const otherChain = buildRequest(PEER, "date", { chain: "ander-gesprek" });
    assert.equal(otherChain.ok, true);
    if (!otherChain.ok) return;
    const wrongChain = await refusalOf(
      executeRequest(otherChain.request, run, {
        self: PEER,
        chain: CHAIN,
        grant: { node: PEER, enabled: true },
      }),
    );
    assert.equal(wrongChain.code, "chain-mismatch");
    assert.deepEqual(calls, []);
  });

  it("executeRequest refuses a command or argv that is not the allowlisted one", async () => {
    const built = buildRequest(PEER, "date");
    assert.equal(built.ok, true);
    if (!built.ok) return;
    const { run, calls } = recorder();
    const grant = { node: PEER, enabled: true };

    const tampered: DeviceRequest = { ...built.request, argv: ["date", "-s", "2000-01-01"] };
    const argvRefusal = await refusalOf(executeRequest(tampered, run, { self: PEER, grant }));
    assert.equal(argvRefusal.code, "argv-mismatch");

    const missingArgv = { node: PEER, command: "date" } as unknown as DeviceRequest;
    const noArgv = await refusalOf(executeRequest(missingArgv, run, { self: PEER, grant }));
    assert.equal(noArgv.code, "argv-mismatch");

    const shellLine: DeviceRequest = { node: PEER, command: "date; id", argv: ["date"] };
    const meta = await refusalOf(executeRequest(shellLine, run, { self: PEER, grant }));
    assert.equal(meta.code, "metacharacter-semicolon");

    const offList: DeviceRequest = { node: PEER, command: "rm -rf /", argv: ["rm", "-rf", "/"] };
    const unknown = await refusalOf(executeRequest(offList, run, { self: PEER, grant }));
    assert.equal(unknown.code, "unknown-command");

    assert.deepEqual(calls, []);
  });

  it("executeRequest hands the runner exactly the allowlisted argv", async () => {
    const grant = { node: PEER, enabled: true };
    for (const entry of ALLOWLIST) {
      const built = buildRequest(PEER, entry.command, { chain: CHAIN });
      assert.equal(built.ok, true);
      if (!built.ok) continue;

      const { run, calls } = recorder();
      const result = await executeRequest(built.request, run, { self: PEER, chain: CHAIN, grant });
      assert.equal(result.accepted, true, `"${entry.command}" was refused`);
      if (!result.accepted) continue;
      assert.deepEqual(result.argv, entry.argv);
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0], entry.argv, "the runner got something other than the allowlisted argv");
      assert.equal(result.output, `ran ${entry.argv.join(" ")}`);
      assert.equal(result.truncated, false);
      // A request cannot smuggle an argument in: the argv is rebuilt, not taken.
      assert.equal(calls[0]?.includes(";"), false);
    }
  });

  it("executeRequest truncates long output and flags it", async () => {
    const built = buildRequest(PEER, "uname -a");
    assert.equal(built.ok, true);
    if (!built.ok) return;
    const grant = { node: PEER, enabled: true };
    const long = "x".repeat(10_000);

    const capped = await executeRequest(built.request, () => long, { self: PEER, grant });
    assert.equal(capped.accepted, true);
    if (!capped.accepted) return;
    assert.equal(capped.output.length, DEFAULT_MAX_OUTPUT_CHARS);
    assert.equal(capped.output, long.slice(0, DEFAULT_MAX_OUTPUT_CHARS));
    assert.equal(capped.truncated, true);

    const small = await executeRequest(built.request, () => "kort", {
      self: PEER,
      grant,
      maxOutputChars: 4,
    });
    assert.equal(small.accepted, true);
    if (small.accepted) {
      assert.equal(small.output, "kort");
      assert.equal(small.truncated, false);
    }

    const tiny = await executeRequest(built.request, () => "korter", {
      self: PEER,
      grant,
      maxOutputChars: 4,
    });
    assert.equal(tiny.accepted, true);
    if (tiny.accepted) {
      assert.equal(tiny.output, "kort");
      assert.equal(tiny.truncated, true);
    }
  });

  it("executeRequest reports a failing or non-text runner without throwing", async () => {
    const built = buildRequest(PEER, "uptime");
    assert.equal(built.ok, true);
    if (!built.ok) return;
    const grant = { node: PEER, enabled: true };

    const boom = await refusalOf(
      executeRequest(
        built.request,
        () => {
          throw new Error("permission denied");
        },
        { self: PEER, grant },
      ),
    );
    assert.equal(boom.code, "runner-failed");
    assert.match(boom.reason, /permission denied/);

    const garbage = await refusalOf(
      executeRequest(built.request, (() => 42) as unknown as DeviceRunner, { self: PEER, grant }),
    );
    assert.equal(garbage.code, "output-invalid");
    assert.notEqual(boom.reason, garbage.reason);
  });

  it("every refusal path has a distinct reason string", async () => {
    const reasons = new Set<string>();
    const built = buildRequest(PEER, "date");
    if (built.ok) {
      const grant = { node: PEER, enabled: true };
      const cases = [
        await executeRequest(built.request, () => "", { self: ME, grant }),
        await executeRequest({ ...built.request, argv: ["date", "--utc"] }, () => "", { self: PEER, grant }),
        await executeRequest(built.request, () => "", { self: PEER }),
        await executeRequest(built.request, () => "", { self: PEER, grant: { node: PEER, enabled: false } }),
      ];
      for (const result of cases) {
        assert.equal(result.accepted, false);
        if (!result.accepted) reasons.add(result.reason);
      }
    }
    assert.equal(reasons.size, 4);
  });
});
