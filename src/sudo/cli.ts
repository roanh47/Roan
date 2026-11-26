#!/usr/bin/env node
/**
 * Owner-facing one-shot commands. Run the install once, as root, with the
 * allowlist this machine is allowed to elevate:
 *
 *   sudo node dist/sudo/cli.js install --commands-file ./elevated-commands.json
 *
 * The file is a JSON array of full command lines:
 *
 *   ["/usr/bin/systemctl restart roan-daemon", "/usr/bin/journalctl -u roan-daemon -n 100"]
 *
 * `status` needs no root and prints a JSON summary the UI could use directly.
 * This command never asks for, stores or prints a password, and it never prints
 * the rule body.
 */

import { readFileSync } from "node:fs";
import {
  elevationStatus,
  installPolkitRule,
  installSudoers,
  type ElevationResult,
  uninstallPolkitRule,
  uninstallSudoers,
} from "./install.js";

function flagValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  return value !== undefined && !value.startsWith("--") ? value : undefined;
}

/** Read a JSON array from a file or env; newline-separated env is accepted too. */
function loadList(kind: "commands" | "actions"): string[] {
  const fileFlag = `--${kind}-file`;
  const envFile = process.env[kind === "commands" ? "ROAN_ELEVATED_COMMANDS_FILE" : "ROAN_ELEVATED_ACTIONS_FILE"];
  const file = flagValue(process.argv.slice(2), fileFlag) ?? envFile;
  let raw: string | undefined;
  if (file !== undefined) raw = readFileSync(file, "utf8");
  else raw = process.env[kind === "commands" ? "ROAN_ELEVATED_COMMANDS" : "ROAN_ELEVATED_ACTIONS"];
  if (raw === undefined || raw.trim() === "") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string")) {
      return parsed;
    }
    return [];
  } catch {
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
  }
}

function printResult(result: ElevationResult): void {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0] ?? "status";
  const polkit = argv.includes("--polkit");

  const common = {
    sudoersDir: process.env["ROAN_SUDOERS_DIR"],
    rulesDir: process.env["ROAN_POLKIT_DIR"],
    user: process.env["ROAN_ELEVATION_USER"],
    filename: undefined,
  };

  switch (command) {
    case "status": {
      const commands = loadList("commands");
      const status = elevationStatus({
        mechanism: polkit ? "polkit" : "sudoers",
        commands,
        sudoersPath: process.env["ROAN_SUDOERS_PATH"],
        polkitPath: process.env["ROAN_POLKIT_PATH"],
      });
      process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
      return;
    }
    case "install": {
      if (polkit) {
        printResult(
          await installPolkitRule({
            actions: loadList("actions"),
            rulesDir: common.rulesDir,
            user: common.user,
          }),
        );
        return;
      }
      printResult(
        await installSudoers({
          commands: loadList("commands"),
          sudoersDir: common.sudoersDir,
          user: common.user,
        }),
      );
      return;
    }
    case "uninstall": {
      printResult(
        polkit
          ? await uninstallPolkitRule({ rulesDir: common.rulesDir })
          : await uninstallSudoers({ sudoersDir: common.sudoersDir }),
      );
      return;
    }
    default:
      process.stderr.write(
        "usage: roan-sudo <status|install|uninstall> [--polkit] [--commands-file FILE] [--actions-file FILE]\n",
      );
      process.exitCode = 2;
  }
}

main().catch((error: unknown) => {
  // A thrown error here is a programming error, not rule content.
  process.stderr.write(`roan-sudo: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exitCode = 1;
});
