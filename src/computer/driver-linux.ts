/**
 * The Linux driver: ydotool on Wayland, xdotool on X11.
 *
 * Two jobs, kept apart on purpose:
 *
 *  - *Detection* is presence only. We look for an executable on `PATH` and
 *    stop there. Actually invoking the tool to see whether it works would move
 *    the pointer as a side effect of a health check, and `ydotool` needs
 *    `ydotoold` plus a uinput device to answer at all — so a missing daemon,
 *    a missing input group permission or a missing `$DISPLAY` is reported by
 *    the first real action, not by a probe. Presence is therefore a *necessary*
 *    but not sufficient condition, and the reason strings say so.
 *  - *Planning* is pure. Every action becomes a list of argv pairs, built by
 *    `buildPlan`, so argv construction is tested without a display server and
 *    without injecting a single keystroke.
 *
 * Screenshots are not an input action and neither input tool can capture the
 * screen, so the plan names a companion: `grim` on Wayland, ImageMagick's
 * `import` on X11. When neither the input tool nor its capture helper exists,
 * the driver reports itself unavailable with a reason a human can act on.
 */

import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import path from "node:path";
import type {
  ComputerDriver,
  DriverAvailability,
  DriverFailure,
  DriverOutcome,
  ScreenshotOutcome,
} from "./actions.js";

/** The input tools this driver knows how to drive. */
export type LinuxTool = "ydotool" | "xdotool";

/** One process to run: the binary and its arguments, separately. */
export interface Invocation {
  readonly bin: string;
  readonly args: readonly string[];
}

/** What the caller asked for, before it becomes argv. */
export type ComputerRequest =
  | { readonly kind: "screenshot" }
  | { readonly kind: "move"; readonly x: number; readonly y: number }
  | { readonly kind: "click"; readonly x: number; readonly y: number }
  | { readonly kind: "type"; readonly text: string }
  | { readonly kind: "key"; readonly combo: string };

export type PlanResult =
  | { readonly ok: true; readonly invocations: readonly Invocation[] }
  | { readonly ok: false; readonly reason: DriverFailure; readonly detail: string };

/** True when `bin` is executable somewhere the process can see. */
export interface PresenceProbe {
  (bin: string): boolean;
}

/** A resolved backend: an input tool plus the capture helper it can use. */
export interface LinuxBackend {
  readonly tool: LinuxTool;
  /** Binary name for the input tool, e.g. `ydotool`. */
  readonly bin: string;
  /** Capture helper for screenshots, or null when none was found. */
  readonly screenshotBin: string | null;
}

export interface DetectOptions {
  /** `XDG_SESSION_TYPE` — `wayland` or `x11`. Used to pick a backend. */
  readonly sessionType?: string;
  /** Forces one tool even when the other is present. */
  readonly prefer?: LinuxTool;
}

export interface LinuxDriverOptions extends DetectOptions {
  /** Presence probe. Default: scan `PATH` from `env`. */
  readonly probe?: PresenceProbe;
  /** Environment used for the default probe and session detection. */
  readonly env?: NodeJS.ProcessEnv;
  /** Skip detection entirely and use this backend (tests, explicit config). */
  readonly backend?: LinuxBackend;
  /** How a plan is executed. Default: `execFile`. Tests always inject one. */
  readonly run?: Executor;
}

export interface ExecResult {
  readonly ok: boolean;
  readonly stdout: Buffer;
  readonly stderr: string;
  /** One sentence, safe to show the user; never a secret. */
  readonly message: string;
}

export type Executor = (invocation: Invocation) => Promise<ExecResult>;

/** Longer than any input action should take; a hang is a failure, not a wait. */
const EXEC_TIMEOUT_MS = 10_000;

/** Screenshots of a 4K screen are a few MB; leave room for the base64 copy. */
const EXEC_MAX_BUFFER = 64 * 1024 * 1024;

const KEY_PART = /^[A-Za-z0-9_]{1,24}$/;
const MAX_KEY_PARTS = 6;

/**
 * Probe that only reads the filesystem.
 *
 * Presence means "an executable with that name exists in a `PATH` directory",
 * nothing more: no version check, no `--help`, no run.
 */
export function pathProbe(env: NodeJS.ProcessEnv = process.env): PresenceProbe {
  const dirs = (env["PATH"] ?? "")
    .split(path.delimiter)
    .filter((dir) => dir !== "");
  return (bin: string): boolean => {
    if (bin === "" || bin.includes("/")) {
      try {
        accessSync(bin, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    }
    for (const dir of dirs) {
      try {
        accessSync(path.join(dir, bin), constants.X_OK);
        return true;
      } catch {
        // Not in this directory; the next one may have it.
      }
    }
    return false;
  };
}

/** What is installed, independent of which one this session should use. */
export interface InstalledTools {
  readonly ydotool: boolean;
  readonly xdotool: boolean;
  readonly grim: boolean;
  readonly imagemagickImport: boolean;
}

/** Presence of every binary the driver may need. Read-only. */
export function detectTools(probe: PresenceProbe): InstalledTools {
  return {
    ydotool: probe("ydotool"),
    xdotool: probe("xdotool"),
    grim: probe("grim"),
    imagemagickImport: probe("import"),
  };
}

/**
 * Pick a backend, or null when no input tool is installed.
 *
 * Order: an explicit `prefer` wins if it is installed; otherwise the session
 * type decides (`wayland` → ydotool, `x11` → xdotool); otherwise ydotool first,
 * because a Wayland session cannot be driven by xdotool and a stray xdotool on
 * a Wayland box would only produce failures.
 */
export function selectBackend(
  probe: PresenceProbe,
  options: DetectOptions = {},
): LinuxBackend | null {
  const tools = detectTools(probe);

  const candidates: LinuxTool[] =
    options.prefer !== undefined
      ? [options.prefer]
      : options.sessionType === "wayland"
        ? ["ydotool", "xdotool"]
        : options.sessionType === "x11"
          ? ["xdotool", "ydotool"]
          : ["ydotool", "xdotool"];

  const tool = candidates.find((candidate) =>
    candidate === "ydotool" ? tools.ydotool : tools.xdotool,
  );
  if (tool === undefined) return null;

  return {
    tool,
    bin: tool,
    screenshotBin: screenshotHelperFor(tool, tools),
  };
}

/** The capture helper that matches the session the input tool drives. */
function screenshotHelperFor(tool: LinuxTool, tools: InstalledTools): string | null {
  if (tool === "ydotool") {
    if (tools.grim) return "grim";
    if (tools.imagemagickImport) return "import";
    return null;
  }
  if (tools.imagemagickImport) return "import";
  if (tools.grim) return "grim";
  return null;
}

function failed(reason: DriverFailure, detail: string): PlanResult {
  return { ok: false, reason, detail };
}

/** Shared basic checks; the gated layer checks these too, on purpose. */
function checkPoint(x: unknown, y: unknown): string | null {
  for (const [axis, value] of [
    ["x", x],
    ["y", y],
  ] as const) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return `${axis} must be a finite number, got ${String(value)}`;
    }
    if (!Number.isInteger(value)) return `${axis} must be an integer, got ${String(value)}`;
    if (value < 0) return `${axis} must not be negative, got ${value}`;
  }
  return null;
}

function checkCombo(combo: unknown): string | null {
  if (typeof combo !== "string" || combo === "") return "combo must be a non-empty string";
  const parts = combo.split("+");
  if (parts.length > MAX_KEY_PARTS) {
    return `combo must have at most ${MAX_KEY_PARTS} parts, got ${parts.length}`;
  }
  for (const part of parts) {
    if (!KEY_PART.test(part)) return `combo part ${JSON.stringify(part)} is not a key name`;
  }
  return null;
}

/**
 * Turn a request into the exact argv to run.
 *
 * Notes on the two tools, because the shapes differ and both are easy to get
 * wrong:
 *  - `xdotool` accepts several commands in one invocation, so a click is
 *    `mousemove --sync X Y click 1`: the pointer is already there when the
 *    button goes down, with no window in which the user can move under it.
 *  - `ydotool` runs exactly one command per invocation, so a click is two
 *    runs: `mousemove --absolute -x X -y Y`, then `click 1`.
 *  - text goes after `--` so a leading dash stays text instead of becoming a
 *    flag.
 */
export function buildPlan(
  backend: LinuxBackend,
  request: ComputerRequest,
): PlanResult {
  switch (request.kind) {
    case "screenshot": {
      if (backend.screenshotBin === null) {
        return failed(
          "unsupported",
          `no screen-capture helper found; ${backend.tool} cannot capture the screen` +
            (backend.tool === "ydotool" ? " (install grim)" : " (install ImageMagick)"),
        );
      }
      const args =
        backend.screenshotBin === "grim"
          ? ["-t", "png", "-"]
          : ["-window", "root", "png:-"];
      return { ok: true, invocations: [{ bin: backend.screenshotBin, args }] };
    }

    case "move": {
      const pointError = checkPoint(request.x, request.y);
      if (pointError !== null) return failed("failed", pointError);
      return {
        ok: true,
        invocations: [moveInvocation(backend, request.x, request.y)],
      };
    }

    case "click": {
      const pointError = checkPoint(request.x, request.y);
      if (pointError !== null) return failed("failed", pointError);
      if (backend.tool === "xdotool") {
        return {
          ok: true,
          invocations: [
            {
              bin: backend.bin,
              args: ["mousemove", "--sync", String(request.x), String(request.y), "click", "1"],
            },
          ],
        };
      }
      return {
        ok: true,
        invocations: [
          moveInvocation(backend, request.x, request.y),
          { bin: backend.bin, args: ["click", "1"] },
        ],
      };
    }

    case "type": {
      if (typeof request.text !== "string" || request.text === "") {
        return failed("failed", "text must be a non-empty string");
      }
      if (request.text.includes("\0")) {
        return failed("failed", "text must not contain a NUL byte");
      }
      return {
        ok: true,
        invocations: [{ bin: backend.bin, args: ["type", "--", request.text] }],
      };
    }

    case "key": {
      const comboError = checkCombo(request.combo);
      if (comboError !== null) return failed("failed", comboError);
      return { ok: true, invocations: [{ bin: backend.bin, args: ["key", request.combo] }] };
    }
  }
}

function moveInvocation(backend: LinuxBackend, x: number, y: number): Invocation {
  if (backend.tool === "ydotool") {
    return {
      bin: backend.bin,
      args: ["mousemove", "--absolute", "-x", String(x), "-y", String(y)],
    };
  }
  return {
    bin: backend.bin,
    args: ["mousemove", "--sync", String(x), String(y)],
  };
}

/**
 * The real executor. Only reached in production: every test injects `run`,
 * because injecting input while a test suite runs would type into whatever
 * window happens to be focused.
 */
export function execFileRunner(): Executor {
  return (invocation: Invocation): Promise<ExecResult> =>
    new Promise((resolve) => {
      execFile(
        invocation.bin,
        [...invocation.args],
        {
          timeout: EXEC_TIMEOUT_MS,
          maxBuffer: EXEC_MAX_BUFFER,
          windowsHide: true,
          encoding: "buffer",
        },
        (error, stdout, stderr) => {
          const out = Buffer.isBuffer(stdout) ? stdout : Buffer.from(String(stdout ?? ""));
          const errText = Buffer.isBuffer(stderr) ? stderr.toString("utf8").trim() : String(stderr ?? "").trim();
          const err = error as (NodeJS.ErrnoException & { killed?: boolean }) | null;
          if (err === null) {
            resolve({ ok: true, stdout: out, stderr: errText, message: "" });
            return;
          }
          if (err.code === "ENOENT") {
            resolve({
              ok: false,
              stdout: out,
              stderr: errText,
              message: `${invocation.bin} is not installed or not on PATH`,
            });
            return;
          }
          if (err.killed === true || err.code === "ETIMEDOUT") {
            resolve({
              ok: false,
              stdout: out,
              stderr: errText,
              message: `${invocation.bin} did not finish within ${EXEC_TIMEOUT_MS}ms`,
            });
            return;
          }
          const detail = errText !== "" ? errText : err.message;
          resolve({
            ok: false,
            stdout: out,
            stderr: errText,
            message: `${invocation.bin} failed: ${detail}`,
          });
        },
      );
    });
}

/** The reason a session with neither tool installed sees. */
export const NO_TOOL_REASON =
  "computer use is not available on this machine: neither ydotool (Wayland) nor xdotool (X11) is installed";

/**
 * Build the Linux driver.
 *
 * Detection runs on every call rather than once at construction, so installing
 * a tool does not require restarting the daemon; the cost is a handful of
 * `access` calls per action.
 */
export function createLinuxDriver(options: LinuxDriverOptions = {}): ComputerDriver {
  const env = options.env ?? process.env;
  const probe = options.probe ?? pathProbe(env);
  const run = options.run ?? execFileRunner();

  function resolveBackend(): LinuxBackend | null {
    if (options.backend !== undefined) return options.backend;
    const sessionType = options.sessionType ?? env["XDG_SESSION_TYPE"]?.toLowerCase();
    return selectBackend(probe, { sessionType, prefer: options.prefer });
  }

  function availability(): DriverAvailability {
    const backend = resolveBackend();
    if (backend === null) return { available: false, reason: NO_TOOL_REASON };
    return { available: true };
  }

  /** Plan, then run every invocation in order; stop at the first failure. */
  async function perform(request: ComputerRequest): Promise<
    | { readonly ok: true; readonly stdout: Buffer }
    | { readonly ok: false; readonly reason: DriverFailure; readonly detail: string }
  > {
    const backend = resolveBackend();
    if (backend === null) {
      return { ok: false, reason: "unavailable", detail: NO_TOOL_REASON };
    }
    const plan = buildPlan(backend, request);
    if (!plan.ok) return plan;

    let stdout: Buffer = Buffer.alloc(0);
    for (const invocation of plan.invocations) {
      const result = await run(invocation);
      if (!result.ok) {
        const detail = result.message !== "" ? result.message : `\`${invocation.bin}\` failed`;
        return { ok: false, reason: "failed", detail };
      }
      stdout = result.stdout;
    }
    return { ok: true, stdout };
  }

  async function action(request: ComputerRequest): Promise<DriverOutcome> {
    const result = await perform(request);
    if (!result.ok) return { ok: false, reason: result.reason, detail: result.detail };
    return { ok: true };
  }

  return {
    name: "linux",

    available: availability,

    async screenshot(): Promise<ScreenshotOutcome> {
      const result = await perform({ kind: "screenshot" });
      if (!result.ok) return { ok: false, reason: result.reason, detail: result.detail };
      if (result.stdout.length === 0) {
        return {
          ok: false,
          reason: "failed",
          detail: "the screen-capture helper produced no image data",
        };
      }
      return {
        ok: true,
        screenshot: { mimeType: "image/png", base64: result.stdout.toString("base64") },
      };
    },

    move(x: number, y: number): Promise<DriverOutcome> {
      return action({ kind: "move", x, y });
    },

    click(x: number, y: number): Promise<DriverOutcome> {
      return action({ kind: "click", x, y });
    },

    type(text: string): Promise<DriverOutcome> {
      return action({ kind: "type", text });
    },

    key(combo: string): Promise<DriverOutcome> {
      return action({ kind: "key", combo });
    },
  };
}
