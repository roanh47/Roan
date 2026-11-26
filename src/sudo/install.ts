/**
 * Passwordless elevation, installed by the owner once, never by a password.
 *
 * Two mechanisms on Linux:
 * - sudoers (`/etc/sudoers.d/roan-elevation`): a NOPASSWD rule for an exact
 *   list of command lines. The generated file is validated with
 *   `visudo -cf <temp>` *before* it is renamed into place, so a syntax error
 *   never reaches the live sudoers tree.
 * - polkit (`/etc/polkit-1/rules.d/50-roan-elevation.rules`): the desktop
 *   alternative. polkit authorizes actions, not command lines, so the rule is
 *   narrow in a different dimension — named actions, one user.
 *
 * Android and macOS are refused with a reason instead of a half-working file.
 * Nothing in this module stores, reads or prompts for a password: the owner
 * runs the install command with root rights, and `sudo -n` is the only way the
 * agent ever invokes sudo afterwards.
 */

import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, rename, unlink, writeFile } from "node:fs/promises";
import { hostname, userInfo } from "node:os";
import path from "node:path";

/** Where Debian/Ubuntu/Fedora keep drop-in rules. */
export const SUDOERS_DIR = "/etc/sudoers.d";
/** Our one file. Nothing else in the directory is touched. */
export const SUDOERS_FILE = "roan-elevation";
/** polkit's rule directory. */
export const POLKIT_DIR = "/etc/polkit-1/rules.d";
export const POLKIT_FILE = "50-roan-elevation.rules";

export type ElevationMechanism = "sudoers" | "polkit";
export type ElevationPlatform = "linux" | "android" | "macos" | "windows" | "other";

/** What the daemon or UI can show without reading a single byte of the rule. */
export interface ElevationStatus {
  readonly supported: boolean;
  readonly installed: boolean;
  readonly mechanism: ElevationMechanism | "none";
  readonly commands: readonly string[];
  readonly reason?: string;
}

/** The outcome of install/uninstall. `reason` is safe to display and log. */
export interface ElevationResult {
  readonly ok: boolean;
  readonly path?: string;
  readonly reason?: string;
}

export type ValidateRule = (file: string) => Promise<boolean>;

interface PlatformOptions {
  /** Overrides `process.platform`; tests pass "darwin", "android", "linux". */
  readonly platform?: string;
  /** Overrides Android detection (Termux reports `linux`). */
  readonly android?: boolean;
  /** Environment used for Android detection. Defaults to `process.env`. */
  readonly env?: NodeJS.ProcessEnv;
}

export interface InstallSudoersOptions extends PlatformOptions {
  /** The exact command lines the agent may run as root. Injected by the caller. */
  readonly commands: readonly string[];
  /** Unix user the agent runs as. Defaults to the current user. */
  readonly user?: string;
  /** Host token in the sudoers rule. Defaults to this machine's hostname. */
  readonly host?: string;
  readonly sudoersDir?: string;
  readonly filename?: string;
  /** Test seam: replaces `visudo -cf`. Returns true when the file parses. */
  readonly validate?: ValidateRule;
}

export interface UninstallSudoersOptions extends PlatformOptions {
  readonly sudoersDir?: string;
  readonly filename?: string;
}

export interface InstallPolkitOptions extends PlatformOptions {
  /** polkit action ids, e.g. `org.freedesktop.systemd1.manage-units`. */
  readonly actions: readonly string[];
  /** Unix user the agent runs as. Defaults to the current user. */
  readonly user?: string;
  readonly rulesDir?: string;
  readonly filename?: string;
}

export interface UninstallPolkitOptions extends PlatformOptions {
  readonly rulesDir?: string;
  readonly filename?: string;
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const SUDOERS_WILDCARDS = /[*?[\]]/;
const SAFE_FILENAME = /^[A-Za-z0-9._-]+$/;
const SAFE_USER = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const SAFE_HOST = /^[A-Za-z0-9.-]+$/;
const SAFE_ACTION = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_-]+)+$/;
/** pkexec runs an arbitrary program: allowing it would undo the allowlist. */
const FORBIDDEN_ACTIONS: readonly string[] = ["org.freedesktop.policykit.exec"];

/**
 * Decide what this machine is. Android has no sudoers or polkit — a rooted
 * phone is granted access through adb/Shizuku, not a drop-in file — and macOS
 * edits a single `/etc/sudoers`, which Roan will not rewrite.
 */
export function classifyPlatform(
  platform: string = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  android?: boolean,
): ElevationPlatform {
  if (android === true) return "android";
  if (platform === "android") return "android";
  if (platform === "darwin") return "macos";
  if (platform === "win32") return "windows";
  if (platform !== "linux") return "other";
  if (env["ANDROID_ROOT"] !== undefined || env["ANDROID_DATA"] !== undefined) return "android";
  if (env["TERMUX_VERSION"] !== undefined || env["TERMUX_APP_PID"] !== undefined) return "android";
  return "linux";
}

/** One sentence per unsupported platform, safe to show in a UI. */
export function unsupportedReason(platform: ElevationPlatform): string {
  switch (platform) {
    case "android":
      return (
        "Android has no sudoers or polkit: apps run inside the Android sandbox and root is " +
        "granted per action through adb/Shizuku, not by a drop-in file. Roan will not write one."
      );
    case "macos":
      return (
        "macOS has no /etc/sudoers.d drop-in model: the one file is /etc/sudoers, edited with " +
        "visudo. Roan will not rewrite it; grant access manually if the owner wants it."
      );
    case "windows":
      return "Windows has no sudoers; run the agent as a service account with the rights it needs.";
    case "other":
      return "Elevation via sudoers or polkit is only implemented for Linux.";
    case "linux":
      return "";
  }
}

function isPlainFilename(name: string): boolean {
  return name !== "." && name !== ".." && SAFE_FILENAME.test(name);
}

function userOrDefault(user: string | undefined): string | null {
  if (user !== undefined) return SAFE_USER.test(user) ? user : null;
  try {
    const name = userInfo().username;
    return SAFE_USER.test(name) ? name : null;
  } catch {
    return null;
  }
}

function hostOrDefault(host: string | undefined): string {
  if (host !== undefined) return SAFE_HOST.test(host) ? host : "localhost";
  try {
    const name = hostname();
    return SAFE_HOST.test(name) ? name : "localhost";
  } catch {
    return "localhost";
  }
}

/** Collapse whitespace so the runtime comparison and the file agree. */
export function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ");
}

/**
 * Validate an injected allowlist. Wildcards are refused because a sudoers
 * wildcard is a pattern, not a command; `ALL` is refused because that is the
 * blanket grant this module exists to avoid.
 */
export function validateCommands(
  commands: readonly string[],
): { ok: true; commands: string[] } | { ok: false; reason: string } {
  if (!Array.isArray(commands) || commands.length === 0) {
    return { ok: false, reason: "the elevated command allowlist is empty; nothing to grant" };
  }
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const entry of commands) {
    if (typeof entry !== "string") {
      return { ok: false, reason: "every elevated command must be a string" };
    }
    const command = normalizeCommand(entry);
    if (command === "") {
      return { ok: false, reason: "an elevated command is empty" };
    }
    if (command.length > 1024) {
      return { ok: false, reason: "an elevated command is longer than 1024 characters" };
    }
    if (CONTROL_CHARS.test(command)) {
      return { ok: false, reason: "an elevated command contains a control character or newline" };
    }
    if (!command.startsWith("/")) {
      return { ok: false, reason: `elevated command must be an absolute path: ${command}` };
    }
    if (SUDOERS_WILDCARDS.test(command)) {
      return { ok: false, reason: `elevated commands may not contain wildcards: ${command}` };
    }
    if (/\bALL\b/.test(command)) {
      return { ok: false, reason: "elevated commands may not contain the sudoers keyword ALL" };
    }
    if (command.startsWith("!")) {
      return { ok: false, reason: "an elevated command may not start with the sudoers negation !" };
    }
    if (/[#"]/.test(command)) {
      return { ok: false, reason: `elevated commands may not contain # or a double quote: ${command}` };
    }
    if (seen.has(command)) continue;
    seen.add(command);
    normalized.push(command);
  }
  return { ok: true, commands: normalized };
}

/** backslash, comma, colon and equals are the characters sudoers requires escaped. */
export function escapeSudoersArgument(command: string): string {
  return normalizeCommand(command)
    .replace(/\\/g, "\\\\")
    .replace(/,/g, "\\,")
    .replace(/:/g, "\\:")
    .replace(/=/g, "\\=");
}

/**
 * The exact rule shape. One user, one host, one root target, NOPASSWD, and the
 * allowlisted command lines verbatim. There is no `ALL` token anywhere and no
 * wildcard, so the rule cannot be widened by a prefix match.
 */
export function sudoersText(commands: readonly string[], user: string, host: string): string {
  const rule = commands.map(escapeSudoersArgument).join(", ");
  return [
    "# Managed by Roan. Do not edit by hand; remove with Roan's elevation uninstall.",
    "# Scope: NOPASSWD for exactly the command lines below. No wildcards, no blanket grant.",
    `${user} ${host}=(root) NOPASSWD: ${rule}`,
    "",
  ].join("\n");
}

function validateActions(
  actions: readonly string[],
): { ok: true; actions: string[] } | { ok: false; reason: string } {
  if (!Array.isArray(actions) || actions.length === 0) {
    return { ok: false, reason: "the polkit action allowlist is empty; nothing to grant" };
  }
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const action of actions) {
    if (typeof action !== "string" || !SAFE_ACTION.test(action)) {
      return { ok: false, reason: `polkit action id is not a valid dotted action name: ${String(action)}` };
    }
    if (FORBIDDEN_ACTIONS.includes(action)) {
      return {
        ok: false,
        reason: `${action} runs an arbitrary program and is never granted by Roan`,
      };
    }
    if (seen.has(action)) continue;
    seen.add(action);
    kept.push(action);
  }
  return { ok: true, actions: kept };
}

/** The exact polkit rule shape: named actions, one user, nothing global. */
export function polkitText(actions: readonly string[], user: string): string {
  const list = actions.map((action) => `        ${JSON.stringify(action)}`).join(",\n");
  return [
    "// Managed by Roan. Do not edit by hand; remove with Roan's elevation uninstall.",
    "// Scope: the polkit actions below, for this user only. polkit authorizes actions,",
    "// not command lines; see docs/security.md for what that does and does not cover.",
    "polkit.addRule(function(action, subject) {",
    "    var allowed = [",
    list,
    "    ];",
    `    if (allowed.indexOf(action.id) !== -1 && subject.user === ${JSON.stringify(user)}) {`,
    "        return polkit.Result.YES;",
    "    }",
    "});",
    "",
  ].join("\n");
}

/** Turn a filesystem error into a reason that names the fix, never the content. */
function writeFailure(dir: string, error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  if (code === "ENOENT") {
    return `${dir} does not exist; install the rule on a Linux machine that has this directory`;
  }
  if (code === "EACCES" || code === "EPERM" || code === "EROFS") {
    return `writing ${dir} needs root: run this once as root (sudo). Roan never asks for or stores a password`;
  }
  return `could not write the rule in ${dir} (${code ?? "unknown error"})`;
}

/** `visudo -cf` on the staged file. stderr is deliberately discarded: it can echo rule text. */
function visudoCheck(file: string): Promise<boolean> {
  const visudo = process.env["ROAN_VISUDO"] ?? "visudo";
  return new Promise((resolve) => {
    execFile(visudo, ["-cf", file], { timeout: 10_000, windowsHide: true }, (error) => {
      resolve(error === null);
    });
  });
}

interface StageOptions {
  readonly dir: string;
  readonly filename: string;
  readonly text: string;
  readonly mode: number;
  readonly validate?: ValidateRule;
  readonly rejection: string;
}

/**
 * Write to a temp file in the *target directory* (so the final move is a
 * rename, not a copy across filesystems), validate it, then move it into place.
 * Any failure removes the temp file and leaves whatever was installed intact.
 */
async function stageAndMove(options: StageOptions): Promise<ElevationResult> {
  const target = path.join(options.dir, options.filename);
  const temp = path.join(
    options.dir,
    `.${options.filename}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`,
  );

  try {
    await writeFile(temp, options.text, { encoding: "utf8", mode: options.mode, flag: "wx" });
  } catch (error) {
    return { ok: false, reason: writeFailure(options.dir, error) };
  }

  try {
    if (options.validate !== undefined && !(await options.validate(temp))) {
      await unlink(temp).catch(() => undefined);
      return { ok: false, reason: options.rejection };
    }
    await chmod(temp, options.mode);
    await rename(temp, target);
    return { ok: true, path: target };
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    return { ok: false, reason: writeFailure(options.dir, error) };
  }
}

/**
 * Install the sudoers drop-in. Refuses on non-Linux, empty/unsafe allowlists,
 * and when visudo rejects the staged file. Never prompts for a password.
 */
export async function installSudoers(options: InstallSudoersOptions): Promise<ElevationResult> {
  const platform = classifyPlatform(options.platform, options.env, options.android);
  if (platform !== "linux") return { ok: false, reason: unsupportedReason(platform) };

  const checked = validateCommands(options.commands);
  if (!checked.ok) return { ok: false, reason: checked.reason };

  const user = userOrDefault(options.user);
  if (user === null) {
    return { ok: false, reason: "no usable unix user name for the sudoers rule; pass `user` explicitly" };
  }

  const filename = options.filename ?? SUDOERS_FILE;
  if (!isPlainFilename(filename)) {
    return { ok: false, reason: `refusing file name "${filename}": a plain file name is required` };
  }

  const dir = options.sudoersDir ?? SUDOERS_DIR;
  const text = sudoersText(checked.commands, user, hostOrDefault(options.host));
  return stageAndMove({
    dir,
    filename,
    text,
    mode: 0o440,
    validate: options.validate ?? visudoCheck,
    rejection: "visudo rejected the generated rule; nothing was installed",
  });
}

/** Remove exactly our file and nothing else in the directory. */
export async function uninstallSudoers(options: UninstallSudoersOptions = {}): Promise<ElevationResult> {
  const platform = classifyPlatform(options.platform, options.env, options.android);
  if (platform !== "linux") return { ok: false, reason: unsupportedReason(platform) };

  const filename = options.filename ?? SUDOERS_FILE;
  if (!isPlainFilename(filename)) {
    return { ok: false, reason: `refusing file name "${filename}": a plain file name is required` };
  }

  const target = path.join(options.sudoersDir ?? SUDOERS_DIR, filename);
  try {
    await unlink(target);
    return { ok: true, path: target };
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === "ENOENT") {
      return { ok: true, path: target, reason: "no Roan elevation rule was installed" };
    }
    return { ok: false, reason: writeFailure(path.dirname(target), error) };
  }
}

/**
 * Install the polkit rule (desktop Linux). Same guarantees as sudoers: narrow
 * allowlist, one user, atomic move; no password is read or stored.
 */
export async function installPolkitRule(options: InstallPolkitOptions): Promise<ElevationResult> {
  const platform = classifyPlatform(options.platform, options.env, options.android);
  if (platform !== "linux") return { ok: false, reason: unsupportedReason(platform) };

  const checked = validateActions(options.actions);
  if (!checked.ok) return { ok: false, reason: checked.reason };

  const user = userOrDefault(options.user);
  if (user === null) {
    return { ok: false, reason: "no usable unix user name for the polkit rule; pass `user` explicitly" };
  }

  const filename = options.filename ?? POLKIT_FILE;
  if (!isPlainFilename(filename)) {
    return { ok: false, reason: `refusing file name "${filename}": a plain file name is required` };
  }

  return stageAndMove({
    dir: options.rulesDir ?? POLKIT_DIR,
    filename,
    text: polkitText(checked.actions, user),
    mode: 0o644,
    rejection: "polkit rule was not installed",
  });
}

/** Remove exactly our polkit rule and nothing else in the directory. */
export async function uninstallPolkitRule(
  options: UninstallPolkitOptions = {},
): Promise<ElevationResult> {
  const platform = classifyPlatform(options.platform, options.env, options.android);
  if (platform !== "linux") return { ok: false, reason: unsupportedReason(platform) };

  const filename = options.filename ?? POLKIT_FILE;
  if (!isPlainFilename(filename)) {
    return { ok: false, reason: `refusing file name "${filename}": a plain file name is required` };
  }

  const target = path.join(options.rulesDir ?? POLKIT_DIR, filename);
  try {
    await unlink(target);
    return { ok: true, path: target };
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === "ENOENT") {
      return { ok: true, path: target, reason: "no Roan polkit rule was installed" };
    }
    return { ok: false, reason: writeFailure(path.dirname(target), error) };
  }
}

export interface ElevationStatusInput extends PlatformOptions {
  /** Which mechanism this machine is configured for. Default `sudoers`. */
  readonly mechanism?: ElevationMechanism;
  /** The allowlist the caller would install; echoed back for the UI. */
  readonly commands?: readonly string[];
  readonly sudoersPath?: string;
  readonly polkitPath?: string;
  /** Test seam for the installed check. Default `existsSync`. */
  readonly exists?: (file: string) => boolean;
}

/**
 * One pure answer for the daemon/UI: is elevation possible here, is a rule
 * installed, which mechanism, and which commands it covers. It reads one
 * existence bit and mutates nothing.
 */
export function elevationStatus(input: ElevationStatusInput = {}): ElevationStatus {
  const platform = classifyPlatform(input.platform, input.env, input.android);
  if (platform !== "linux") {
    return {
      supported: false,
      installed: false,
      mechanism: "none",
      commands: [],
      reason: unsupportedReason(platform),
    };
  }

  const mechanism = input.mechanism ?? "sudoers";
  const target =
    mechanism === "polkit"
      ? input.polkitPath ?? path.join(POLKIT_DIR, POLKIT_FILE)
      : input.sudoersPath ?? path.join(SUDOERS_DIR, SUDOERS_FILE);
  const exists = input.exists ?? existsSync;
  return {
    supported: true,
    installed: exists(target),
    mechanism,
    commands: [...(input.commands ?? [])],
  };
}
