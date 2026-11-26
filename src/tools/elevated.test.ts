import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ElevationStatus } from "../sudo/install.js";
import { createElevatedTool, isAllowedCommand, splitCommandLine } from "./elevated.js";

const COMMANDS = ["/usr/bin/systemctl restart roan-daemon", "/usr/bin/journalctl -u roan-daemon -n 100"];

function status(overrides: Partial<ElevationStatus> = {}): ElevationStatus {
  return {
    supported: true,
    installed: true,
    mechanism: "sudoers",
    commands: COMMANDS,
    ...overrides,
  };
}

function toolWith(statusValue: ElevationStatus, run?: (argv: readonly string[]) => Promise<{ code: number | null; stdout: string; stderr: string }>) {
  const calls: string[][] = [];
  const tool = createElevatedTool({
    commands: COMMANDS,
    status: () => statusValue,
    run:
      run ??
      (async (argv) => {
        calls.push([...argv]);
        return { code: 0, stdout: "done", stderr: "" };
      }),
  });
  return { tool, calls };
}
describe("splitCommandLine", () => {
  it("splits plain arguments and keeps quoted groups together", () => {
    assert.deepEqual(splitCommandLine("/usr/bin/systemctl restart roan-daemon"), [
      "/usr/bin/systemctl",
      "restart",
      "roan-daemon",
    ]);
    assert.deepEqual(splitCommandLine(`/bin/echo "two words" 'and more'`), ["/bin/echo", "two words", "and more"]);
    assert.deepEqual(splitCommandLine("  /bin/echo   spaced  "), ["/bin/echo", "spaced"]);
  });

  it("refuses an unterminated quote", () => {
    assert.throws(() => splitCommandLine(`/bin/echo "open`), /unterminated quote/);
  });
});

describe("isAllowedCommand", () => {
  it("matches exactly, ignoring only whitespace differences", () => {
    assert.equal(isAllowedCommand(COMMANDS, "/usr/bin/systemctl restart roan-daemon"), true);
    assert.equal(isAllowedCommand(COMMANDS, "  /usr/bin/systemctl   restart roan-daemon  "), true);
    assert.equal(isAllowedCommand(COMMANDS, "/usr/bin/systemctl restart"), false);
    assert.equal(isAllowedCommand(COMMANDS, "/usr/bin/systemctl restart roan-daemon --force"), false);
    assert.equal(isAllowedCommand(COMMANDS, "/usr/bin/bash"), false);
  });
});

describe("run_elevated", () => {
  it("runs an allowlisted command as argv (never through a shell)", async () => {
    const { tool, calls } = toolWith(status());
    const output = await tool.run({ command: "/usr/bin/systemctl restart roan-daemon" }, { cwd: "/tmp" });
    assert.equal(output, "done");
    assert.deepEqual(calls, [["/usr/bin/systemctl", "restart", "roan-daemon"]]);
  });

  it("refuses a command that is not in the allowlist", async () => {
    const { tool } = toolWith(status());
    await assert.rejects(
      tool.run({ command: "/usr/bin/rm -rf /tmp/x" }, { cwd: "/tmp" }),
      /not in the elevation allowlist/,
    );
  });

  it("refuses shell metacharacters", async () => {
    const { tool } = toolWith(status());
    for (const command of [
      "/usr/bin/systemctl restart roan-daemon; id",
      "/usr/bin/systemctl $(id)",
      "/usr/bin/systemctl `id`",
      "/usr/bin/systemctl | sh",
    ]) {
      await assert.rejects(tool.run({ command }, { cwd: "/tmp" }), /metacharacters/, command);
    }
  });

  it("says the rule is not installed and never prompts", async () => {
    const { tool } = toolWith(status({ installed: false }));
    await assert.rejects(
      tool.run({ command: COMMANDS[0] ?? "" }, { cwd: "/tmp" }),
      /not installed.*owner must run/s,
    );
  });

  it("reports an unsupported platform with the reason", async () => {
    const { tool } = toolWith(
      status({ supported: false, installed: false, mechanism: "none", reason: "macOS has no drop-in model" }),
    );
    await assert.rejects(tool.run({ command: COMMANDS[0] ?? "" }, { cwd: "/tmp" }), /not supported.*macOS/s);
  });

  it("turns a sudo password demand into the install instruction, not a prompt", async () => {
    const { tool } = toolWith(status(), async () => ({
      code: 1,
      stdout: "",
      stderr: "sudo: a password is required",
    }));
    await assert.rejects(
      tool.run({ command: COMMANDS[0] ?? "" }, { cwd: "/tmp" }),
      /never prompts|run "roan-sudo install"/,
    );
  });

  it("surfaces a non-zero exit with the output", async () => {
    const { tool } = toolWith(status(), async () => ({ code: 3, stdout: "", stderr: "broken unit" }));
    await assert.rejects(tool.run({ command: COMMANDS[0] ?? "" }, { cwd: "/tmp" }), /exit 3\nbroken unit/);
  });
});
