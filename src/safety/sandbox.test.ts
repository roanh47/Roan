import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describeSandbox,
  detectSandbox,
  wrapShellCommand,
  type SandboxDetection,
  type SandboxProbe,
} from "./sandbox.js";

/** A probe with a fixed platform and an explicit set of installed commands. */
function probe(platform: NodeJS.Platform, installed: readonly string[] = []): SandboxProbe {
  const present = new Set(installed);
  return { platform, hasCommand: (command) => present.has(command) };
}

describe("detectSandbox", () => {
  it("picks bwrap first on Linux when both wrappers exist", () => {
    const detection = detectSandbox(probe("linux", ["bwrap", "landlock-sandbox"]));
    assert.equal(detection.supported, true);
    assert.equal(detection.kind, "bwrap");
    assert.equal(detection.command, "bwrap");
    assert.match(detection.reason, /no network/);
  });

  it("falls back to the Landlock helper when bwrap is missing", () => {
    const detection = detectSandbox(probe("linux", ["landlock-sandbox"]));
    assert.equal(detection.supported, true);
    assert.equal(detection.kind, "landlock-seccomp");
    assert.equal(detection.command, "landlock-sandbox");
    assert.match(detection.reason, /Landlock/);
    assert.match(detection.reason, /seccomp/);
  });

  it("reports Linux without a wrapper instead of pretending", () => {
    const detection = detectSandbox(probe("linux"));
    assert.equal(detection.supported, false);
    assert.equal(detection.kind, null);
    assert.equal(detection.command, null);
    assert.match(detection.reason, /bwrap/);
    assert.match(detection.reason, /landlock-sandbox/);
    assert.doesNotMatch(describeSandbox(detection), /^Sandbox:/);
    assert.match(describeSandbox(detection), /No sandbox available/);
    assert.match(describeSandbox(detection), /unsandboxed/);
  });

  it("uses sandbox-exec on macOS", () => {
    const detection = detectSandbox(probe("darwin", ["sandbox-exec"]));
    assert.equal(detection.supported, true);
    assert.equal(detection.kind, "sandbox-exec");
    assert.match(detection.reason, /deny-by-default/);
  });

  it("reports macOS without sandbox-exec", () => {
    const detection = detectSandbox(probe("darwin", ["bwrap"]));
    assert.equal(detection.supported, false);
    assert.match(detection.reason, /sandbox-exec/);
  });

  it("reports platforms it has no wrapper for", () => {
    const detection = detectSandbox(probe("win32", ["bwrap", "sandbox-exec"]));
    assert.equal(detection.supported, false);
    assert.match(detection.reason, /win32/);
  });

  it("never rejects a supported result from describeSandbox", () => {
    const detection: SandboxDetection = {
      supported: true,
      kind: "bwrap",
      command: "bwrap",
      reason: "confined",
    };
    assert.match(describeSandbox(detection), /^Sandbox: bwrap via bwrap/);
  });
});

describe("wrapShellCommand", () => {
  const unsupported: SandboxDetection = detectSandbox(probe("linux"));

  it("passes the command through untouched when nothing is sandboxed", () => {
    const wrapped = wrapShellCommand("echo hi", unsupported);
    assert.deepEqual(wrapped.argv, ["/bin/sh", "-c", "echo hi"]);
    assert.equal(wrapped.sandboxed, false);
    assert.equal(wrapped.kind, null);
    assert.match(wrapped.reason, /bwrap/);
  });

  it("wraps in bwrap with a read-only root and a writable workspace", () => {
    const detection = detectSandbox(probe("linux", ["bwrap"]));
    const wrapped = wrapShellCommand("make test", detection, {
      shell: "/bin/bash",
      workspace: "/home/roan/Roan",
    });

    assert.equal(wrapped.sandboxed, true);
    assert.equal(wrapped.kind, "bwrap");
    assert.equal(wrapped.argv[0], "bwrap");
    assert.ok(wrapped.argv.includes("--unshare-net"));
    assert.ok(wrapped.argv.includes("--die-with-parent"));
    assert.deepEqual(wrapped.argv.slice(-3), ["/bin/bash", "-c", "make test"]);
    // The workspace is bound twice (source and destination) and made the cwd.
    const bindIndex = wrapped.argv.indexOf("--bind");
    assert.ok(bindIndex > 0);
    assert.deepEqual(wrapped.argv.slice(bindIndex + 1, bindIndex + 3), [
      "/home/roan/Roan",
      "/home/roan/Roan",
    ]);
    assert.equal(wrapped.argv[wrapped.argv.indexOf("--chdir") + 1], "/home/roan/Roan");
  });

  it("runs the Landlock helper with the workspace writable", () => {
    const detection = detectSandbox(probe("linux", ["landlock-sandbox"]));
    const wrapped = wrapShellCommand("id", detection, { workspace: "/tmp/work" });

    assert.equal(wrapped.argv[0], "landlock-sandbox");
    assert.ok(wrapped.argv.includes("--no-network"));
    const rwIndex = wrapped.argv.indexOf("--rw");
    assert.equal(wrapped.argv[rwIndex + 1], "/tmp/work");
    assert.deepEqual(wrapped.argv.slice(-3), ["/bin/sh", "-c", "id"]);
  });

  it("builds a deny-by-default macOS profile naming the workspace", () => {
    const detection = detectSandbox(probe("darwin", ["sandbox-exec"]));
    const wrapped = wrapShellCommand("ls", detection, { workspace: "/Users/roan/Roan" });

    assert.equal(wrapped.argv[0], "sandbox-exec");
    const profile = wrapped.argv[wrapped.argv.indexOf("-p") + 1];
    assert.ok(profile !== undefined);
    assert.match(profile, /\(deny default\)/);
    assert.match(profile, /\(subpath "\/Users\/roan\/Roan"\)/);
    assert.match(profile, /file-write\*/);
    assert.doesNotMatch(profile, /\(allow network/);
    assert.deepEqual(wrapped.argv.slice(-3), ["/bin/sh", "-c", "ls"]);
  });

  it("passes shell syntax as one argv element, never re-quoted", () => {
    const detection = detectSandbox(probe("linux", ["bwrap"]));
    const command = 'echo "$(id)" > /tmp/out && cat /tmp/out';
    const wrapped = wrapShellCommand(command, detection);

    assert.equal(wrapped.argv.filter((part) => part === command).length, 1);
    assert.equal(wrapped.argv.at(-1), command);
  });

  it("refuses an empty command and a NUL byte", () => {
    const detection = detectSandbox(probe("linux", ["bwrap"]));
    assert.throws(() => wrapShellCommand("   ", detection), /non-empty/);
    assert.throws(() => wrapShellCommand("echo\0hi", detection), /NUL/);
  });

  it("refuses a workspace that would break the macOS profile", () => {
    const detection = detectSandbox(probe("darwin", ["sandbox-exec"]));
    assert.throws(
      () => wrapShellCommand("ls", detection, { workspace: '/tmp/a"b' }),
      /sandbox-exec profile/,
    );
  });
});
