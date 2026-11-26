import assert from "node:assert/strict";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { createComputerActions } from "./actions.js";
import {
  buildPlan,
  createLinuxDriver,
  detectTools,
  NO_TOOL_REASON,
  pathProbe,
  selectBackend,
  type ComputerRequest,
  type ExecResult,
  type Executor,
  type Invocation,
  type LinuxBackend,
} from "./driver-linux.js";
import { createGrantStore } from "./grant.js";
import { withTempDir } from "../testing/temp-dir.js";

/**
 * Rules under test here:
 *
 *  - argv is built, not executed: `buildPlan` is pure, so every shape is
 *    asserted without a display server;
 *  - presence detection only reads the filesystem — a probe that ran the tool
 *    would move the pointer as a side effect of a health check;
 *  - a machine with neither tool says so, in words a human can act on, and
 *    never pretends an action happened.
 *
 * Every execution path below goes through an injected `run`, so this suite
 * cannot inject input into the machine that runs it.
 */

const YDOTOOL: LinuxBackend = { tool: "ydotool", bin: "ydotool", screenshotBin: "grim" };
const XDOTOOL: LinuxBackend = { tool: "xdotool", bin: "xdotool", screenshotBin: "import" };

/** A run function that records what it was asked to run and never runs it. */
function recorder(answer: (invocation: Invocation) => ExecResult = () => ok()): {
  run: Executor;
  seen: Invocation[];
} {
  const seen: Invocation[] = [];
  return {
    seen,
    run: async (invocation) => {
      seen.push(invocation);
      return answer(invocation);
    },
  };
}

function ok(stdout = ""): ExecResult {
  return { ok: true, stdout: Buffer.from(stdout), stderr: "", message: "" };
}

describe("driver-linux: argv for xdotool", () => {
  it("moves the pointer with --sync so the position is settled", () => {
    assert.deepEqual(buildPlan(XDOTOOL, { kind: "move", x: 640, y: 480 }), {
      ok: true,
      invocations: [{ bin: "xdotool", args: ["mousemove", "--sync", "640", "480"] }],
    });
  });

  it("clicks in one invocation, at the target, not at wherever the pointer was", () => {
    assert.deepEqual(buildPlan(XDOTOOL, { kind: "click", x: 10, y: 20 }), {
      ok: true,
      invocations: [
        { bin: "xdotool", args: ["mousemove", "--sync", "10", "20", "click", "1"] },
      ],
    });
  });

  it("puts text after -- so a leading dash stays text", () => {
    assert.deepEqual(buildPlan(XDOTOOL, { kind: "type", text: "--version" }), {
      ok: true,
      invocations: [{ bin: "xdotool", args: ["type", "--", "--version"] }],
    });
  });

  it("passes a key combo as one argument", () => {
    assert.deepEqual(buildPlan(XDOTOOL, { kind: "key", combo: "ctrl+shift+t" }), {
      ok: true,
      invocations: [{ bin: "xdotool", args: ["key", "ctrl+shift+t"] }],
    });
  });

  it("captures the screen with ImageMagick's import on X11", () => {
    assert.deepEqual(buildPlan(XDOTOOL, { kind: "screenshot" }), {
      ok: true,
      invocations: [{ bin: "import", args: ["-window", "root", "png:-"] }],
    });
  });
});

describe("driver-linux: argv for ydotool", () => {
  it("moves absolutely, because relative moves mean nothing without a pointer origin", () => {
    assert.deepEqual(buildPlan(YDOTOOL, { kind: "move", x: 640, y: 480 }), {
      ok: true,
      invocations: [
        { bin: "ydotool", args: ["mousemove", "--absolute", "-x", "640", "-y", "480"] },
      ],
    });
  });

  it("clicks in two invocations, because ydotool runs one command per process", () => {
    assert.deepEqual(buildPlan(YDOTOOL, { kind: "click", x: 1, y: 2 }), {
      ok: true,
      invocations: [
        { bin: "ydotool", args: ["mousemove", "--absolute", "-x", "1", "-y", "2"] },
        { bin: "ydotool", args: ["click", "1"] },
      ],
    });
  });

  it("types and presses keys with the same shapes as xdotool", () => {
    assert.deepEqual(buildPlan(YDOTOOL, { kind: "type", text: "héllo" }), {
      ok: true,
      invocations: [{ bin: "ydotool", args: ["type", "--", "héllo"] }],
    });
    assert.deepEqual(buildPlan(YDOTOOL, { kind: "key", combo: "super+Return" }), {
      ok: true,
      invocations: [{ bin: "ydotool", args: ["key", "super+Return"] }],
    });
  });

  it("captures the screen with grim on Wayland", () => {
    assert.deepEqual(buildPlan(YDOTOOL, { kind: "screenshot" }), {
      ok: true,
      invocations: [{ bin: "grim", args: ["-t", "png", "-"] }],
    });
  });
});

describe("driver-linux: planning refuses what it cannot do", () => {
  it("says a screenshot is unsupported when no capture helper exists", () => {
    const backend: LinuxBackend = { tool: "xdotool", bin: "xdotool", screenshotBin: null };

    const plan = buildPlan(backend, { kind: "screenshot" });

    assert.equal(plan.ok, false);
    if (plan.ok) assert.fail("unreachable");
    assert.equal(plan.reason, "unsupported");
    assert.match(plan.detail, /ImageMagick/);
  });

  it("refuses coordinates that are not finite non-negative integers", () => {
    for (const request of [
      { kind: "move", x: 1.5, y: 0 },
      { kind: "click", x: 0, y: Number.NaN },
      { kind: "move", x: -1, y: 0 },
      { kind: "click", x: 0, y: Number.POSITIVE_INFINITY },
    ] as ComputerRequest[]) {
      const plan = buildPlan(XDOTOOL, request);
      assert.equal(plan.ok, false, `expected a refusal for ${JSON.stringify(request)}`);
    }
  });

  it("refuses empty text, a NUL byte and an unusable combo", () => {
    const requests: ComputerRequest[] = [
      { kind: "type", text: "" },
      { kind: "type", text: "a\0b" },
      { kind: "key", combo: "" },
      { kind: "key", combo: "--delay" },
      { kind: "key", combo: "ctrl+" },
    ];
    for (const request of requests) {
      assert.equal(buildPlan(YDOTOOL, request).ok, false, JSON.stringify(request));
    }
  });
});

describe("driver-linux: presence detection is read-only", () => {
  it("finds an executable on PATH without running it", async () => {
    await withTempDir(async (dir) => {
      const binDir = path.join(dir, "bin");
      const marker = path.join(dir, "ran-marker");
      const fake = path.join(binDir, "ydotool");
      await mkdir(binDir, { recursive: true });
      // If anything ever executes this, it leaves evidence.
      await writeFile(fake, `#!/bin/sh\ntouch ${JSON.stringify(marker)}\n`, "utf8");
      await chmod(fake, 0o755);

      const probe = pathProbe({ PATH: [binDir, "/nonexistent"].join(path.delimiter) });

      assert.equal(probe("ydotool"), true);
      assert.equal(probe("xdotool"), false);

      // Presence only: the marker must not exist, because nothing ran the file.
      await assert.rejects(readFile(marker, "utf8"), /ENOENT/);
    }, "roan-computer-");
  });

  it("does not treat a non-executable file as a tool", async () => {
    await withTempDir(async (dir) => {
      const fake = path.join(dir, "xdotool");
      await writeFile(fake, "not a program", "utf8");
      await chmod(fake, 0o644);

      const probe = pathProbe({ PATH: dir });

      assert.equal(probe("xdotool"), false);
    }, "roan-computer-");
  });

  it("reports which tools are installed, including the capture helpers", () => {
    const installed = new Set(["xdotool", "import"]);
    const tools = detectTools((bin) => installed.has(bin));

    assert.deepEqual(tools, {
      ydotool: false,
      xdotool: true,
      grim: false,
      imagemagickImport: true,
    });
  });
});

describe("driver-linux: backend selection", () => {
  it("returns null when neither input tool is installed", () => {
    assert.equal(selectBackend(() => false), null);
  });

  it("picks ydotool on a Wayland session even when xdotool is also present", () => {
    const backend = selectBackend(() => true, { sessionType: "wayland" });

    assert.equal(backend?.tool, "ydotool");
    assert.equal(backend?.bin, "ydotool");
    assert.equal(backend?.screenshotBin, "grim");
  });

  it("picks xdotool on an X11 session", () => {
    const backend = selectBackend((bin) => bin === "xdotool" || bin === "import", {
      sessionType: "x11",
    });

    assert.equal(backend?.tool, "xdotool");
    assert.equal(backend?.screenshotBin, "import");
  });

  it("falls back to the one tool that is installed", () => {
    const backend = selectBackend((bin) => bin === "xdotool", { sessionType: "wayland" });

    assert.equal(backend?.tool, "xdotool");
    assert.equal(backend?.screenshotBin, null);
  });

  it("honours an explicit preference", () => {
    const backend = selectBackend(() => true, { prefer: "xdotool" });

    assert.equal(backend?.tool, "xdotool");
  });

  it("ignores a preference for a tool that is not installed", () => {
    const backend = selectBackend((bin) => bin === "ydotool", { prefer: "xdotool" });

    assert.equal(backend, null);
  });
});

describe("driver-linux: availability is honest", () => {
  it("is unavailable, with a reason naming both tools, when neither exists", async () => {
    const rec = recorder();
    const driver = createLinuxDriver({ probe: () => false, run: rec.run });

    const availability = driver.available();

    assert.equal(availability.available, false);
    if (availability.available) assert.fail("unreachable");
    assert.match(availability.reason, /ydotool/);
    assert.match(availability.reason, /xdotool/);
    assert.equal(availability.reason, NO_TOOL_REASON);
  });

  it("is available when only xdotool exists", () => {
    const driver = createLinuxDriver({
      probe: (bin) => bin === "xdotool",
      run: recorder().run,
    });

    assert.deepEqual(driver.available(), { available: true });
  });

  it("never runs anything when it is unavailable, and refuses each action", async () => {
    const rec = recorder();
    const driver = createLinuxDriver({ probe: () => false, run: rec.run });

    const results = [
      await driver.screenshot(),
      await driver.move(1, 1),
      await driver.click(1, 1),
      await driver.type("hello"),
      await driver.key("ctrl+c"),
    ];

    for (const result of results) {
      assert.equal(result.ok, false);
      if (result.ok) assert.fail("unreachable");
      assert.equal(result.reason, "unavailable");
      assert.equal(result.detail, NO_TOOL_REASON);
    }
    assert.deepEqual(rec.seen, []);
  });

  it("reaches the gated layer as a refusal, not as a silent no-op", async () => {
    const grants = createGrantStore({ now: () => 0 });
    const driver = createLinuxDriver({ probe: () => false, run: recorder().run });
    const actions = createComputerActions({
      sessionId: "session-1",
      driver,
      screen: { width: 800, height: 600 },
      grants,
    });
    grants.grantSession("session-1");

    const result = await actions.click(10, 10);

    assert.equal(result.ok, false);
    if (result.ok) assert.fail("unreachable");
    assert.equal(result.reason, "driver-unavailable");
    assert.equal(result.detail, NO_TOOL_REASON);
  });
});

describe("driver-linux: the driver runs exactly the planned argv", () => {
  it("runs one invocation for an xdotool click and reports success", async () => {
    const rec = recorder();
    const driver = createLinuxDriver({
      probe: (bin) => bin === "xdotool" || bin === "import",
      sessionType: "x11",
      run: rec.run,
    });

    assert.deepEqual(await driver.click(30, 40), { ok: true });
    assert.deepEqual(rec.seen, [
      { bin: "xdotool", args: ["mousemove", "--sync", "30", "40", "click", "1"] },
    ]);
  });

  it("runs both ydotool invocations, in order, for a click", async () => {
    const rec = recorder();
    const driver = createLinuxDriver({ backend: YDOTOOL, run: rec.run });

    assert.deepEqual(await driver.click(7, 8), { ok: true });
    assert.deepEqual(rec.seen, [
      { bin: "ydotool", args: ["mousemove", "--absolute", "-x", "7", "-y", "8"] },
      { bin: "ydotool", args: ["click", "1"] },
    ]);
  });

  it("stops at the first failing invocation and reports the tool's own words", async () => {
    const rec = recorder((invocation) =>
      invocation.args[0] === "mousemove"
        ? {
            ok: false,
            stdout: Buffer.alloc(0),
            stderr: "failed to connect to ydotoold",
            message: "ydotool failed: failed to connect to ydotoold",
          }
        : ok(),
    );
    const driver = createLinuxDriver({ backend: YDOTOOL, run: rec.run });

    const result = await driver.click(1, 1);

    assert.equal(result.ok, false);
    if (result.ok) assert.fail("unreachable");
    assert.equal(result.reason, "failed");
    assert.match(result.detail, /ydotoold/);
    // The click never fired: no button went down at a position we did not reach.
    assert.equal(rec.seen.length, 1);
  });

  it("returns a screenshot as base64 PNG data", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const rec = recorder(() => ({ ok: true, stdout: png, stderr: "", message: "" }));
    const driver = createLinuxDriver({ backend: XDOTOOL, run: rec.run });

    const result = await driver.screenshot();

    assert.equal(result.ok, true);
    if (!result.ok) assert.fail("unreachable");
    assert.equal(result.screenshot.mimeType, "image/png");
    assert.equal(result.screenshot.base64, png.toString("base64"));
    assert.deepEqual(rec.seen, [{ bin: "import", args: ["-window", "root", "png:-"] }]);
  });

  it("refuses a screenshot that produced no bytes", async () => {
    const driver = createLinuxDriver({ backend: XDOTOOL, run: recorder().run });

    const result = await driver.screenshot();

    assert.equal(result.ok, false);
    if (result.ok) assert.fail("unreachable");
    assert.equal(result.reason, "failed");
    assert.match(result.detail, /no image data/);
  });

  it("refuses a screenshot with no helper instead of returning an empty image", async () => {
    const rec = recorder();
    const driver = createLinuxDriver({
      backend: { tool: "xdotool", bin: "xdotool", screenshotBin: null },
      run: rec.run,
    });

    const result = await driver.screenshot();

    assert.equal(result.ok, false);
    if (result.ok) assert.fail("unreachable");
    assert.equal(result.reason, "unsupported");
    assert.deepEqual(rec.seen, []);
  });

  it("passes type and key through unchanged", async () => {
    const rec = recorder();
    const driver = createLinuxDriver({ backend: YDOTOOL, run: rec.run });

    assert.deepEqual(await driver.type("hello world"), { ok: true });
    assert.deepEqual(await driver.key("ctrl+alt+Delete"), { ok: true });

    assert.deepEqual(rec.seen, [
      { bin: "ydotool", args: ["type", "--", "hello world"] },
      { bin: "ydotool", args: ["key", "ctrl+alt+Delete"] },
    ]);
  });
});
