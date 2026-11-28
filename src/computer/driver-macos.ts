/**
 * The macOS driver: `screencapture` and `osascript`, both part of the system.
 *
 * Nothing has to be installed, but macOS has to be told the app may do this:
 * Screen Recording for the picture, Accessibility for the pointer and the
 * keyboard. Without them the first action fails and says so.
 *
 * A Retina screenshot has more pixels than the screen has points, and the
 * pointer moves in points. The driver learns the ratio when it takes a
 * picture and divides every position by it, so the agent only ever deals in
 * the pixels of the picture it was shown.
 *
 * Text the model wants typed is passed to `osascript` as an argument, never
 * pasted into a script, so a quote in it stays text.
 */

import type { ComputerDriver, DriverOutcome, ScreenshotOutcome } from "./actions.js";
import { execFileRunner, type Executor, type Invocation } from "./driver-linux.js";

/** Key names the agent may use, as macOS virtual key codes. */
const KEY_CODES: Readonly<Record<string, number>> = {
  enter: 36,
  return: 36,
  tab: 48,
  space: 49,
  backspace: 51,
  delete: 117,
  esc: 53,
  escape: 53,
  left: 123,
  right: 124,
  down: 125,
  up: 126,
  home: 115,
  end: 119,
  pageup: 116,
  pagedown: 121,
};

const MODIFIERS: Readonly<Record<string, string>> = {
  cmd: "command down",
  command: "command down",
  super: "command down",
  ctrl: "control down",
  control: "control down",
  alt: "option down",
  option: "option down",
  shift: "shift down",
};

/** A fixed script: capture to a temporary file, print it, remove it. */
const CAPTURE = 'f="$(mktemp -t roan-screen)"; screencapture -x -t png "$f" && cat "$f"; s=$?; rm -f "$f"; exit $s';

/** How wide the main screen is in points; the pointer's own unit. */
const POINT_WIDTH =
  "ObjC.import('CoreGraphics'); String($.CGDisplayBounds($.CGMainDisplayID()).size.width)";

function mouseScript(x: number, y: number, click: boolean): string {
  const post = (event: string): string =>
    `$.CGEventPost($.kCGHIDEventTap, $.CGEventCreateMouseEvent(null, $.${event}, p, $.kCGMouseButtonLeft));`;
  return [
    "ObjC.import('CoreGraphics');",
    `var p = $.CGPointMake(${String(x)}, ${String(y)});`,
    post("kCGEventMouseMoved"),
    ...(click ? [post("kCGEventLeftMouseDown"), post("kCGEventLeftMouseUp")] : []),
  ].join(" ");
}

/** The `osascript` runs for each action. Pure: values in, argv out. */
export const macInvocations = {
  screenshot(): Invocation {
    return { bin: "/bin/sh", args: ["-c", CAPTURE] };
  },
  pointWidth(): Invocation {
    return { bin: "osascript", args: ["-l", "JavaScript", "-e", POINT_WIDTH] };
  },
  move(x: number, y: number): Invocation {
    return { bin: "osascript", args: ["-l", "JavaScript", "-e", mouseScript(x, y, false)] };
  },
  click(x: number, y: number): Invocation {
    return { bin: "osascript", args: ["-l", "JavaScript", "-e", mouseScript(x, y, true)] };
  },
  type(text: string): Invocation {
    return {
      bin: "osascript",
      args: [
        "-e",
        "on run argv",
        "-e",
        'tell application "System Events" to keystroke (item 1 of argv)',
        "-e",
        "end run",
        "--",
        text,
      ],
    };
  },
  /** `cmd+s`, `enter`, `ctrl+shift+tab`; null when a part is not a key it knows. */
  key(combo: string): Invocation | null {
    const parts = combo.toLowerCase().split("+");
    const key = parts.pop();
    if (key === undefined || key.length === 0) return null;
    const held: string[] = [];
    for (const part of parts) {
      const modifier = MODIFIERS[part];
      if (modifier === undefined) return null;
      held.push(modifier);
    }
    const using = held.length > 0 ? ` using {${held.join(", ")}}` : "";
    const code = KEY_CODES[key];
    const press =
      code !== undefined ? `key code ${String(code)}${using}` : /^[a-z0-9]$/.test(key) ? `keystroke "${key}"${using}` : null;
    if (press === null) return null;
    return { bin: "osascript", args: ["-e", `tell application "System Events" to ${press}`] };
  },
};

/** Picture pixels per screen point, from a PNG header and the screen's width in points. */
export function retinaScale(pngBase64: string, pointWidth: number): number {
  const head = Buffer.from(pngBase64.slice(0, 64), "base64");
  if (head.length < 24 || !(pointWidth > 0)) return 1;
  const pixelWidth = head.readUInt32BE(16);
  const scale = pixelWidth / pointWidth;
  return Number.isFinite(scale) && scale >= 1 ? scale : 1;
}

const PERMISSION_HINT =
  " — allow Roan under System Settings → Privacy & Security (Screen Recording for the picture, Accessibility for the pointer and keyboard)";

export function createMacDriver(run: Executor = execFileRunner()): ComputerDriver {
  /** Learned at the last screenshot; 1 until then. */
  let scale = 1;

  async function act(invocation: Invocation): Promise<DriverOutcome> {
    const result = await run(invocation);
    return result.ok ? { ok: true } : { ok: false, reason: "failed", detail: (result.message || "osascript failed") + PERMISSION_HINT };
  }
  const point = (value: number): number => Math.round(value / scale);

  return {
    name: "macos",
    available: () => ({ available: true }),
    async screenshot(): Promise<ScreenshotOutcome> {
      const shot = await run(macInvocations.screenshot());
      if (!shot.ok || shot.stdout.length === 0) {
        return { ok: false, reason: "failed", detail: (shot.message || "the screen capture produced no image data") + PERMISSION_HINT };
      }
      const encoded = shot.stdout.toString("base64");
      const width = await run(macInvocations.pointWidth());
      scale = width.ok ? retinaScale(encoded, Number.parseFloat(width.stdout.toString("utf8"))) : 1;
      return { ok: true, screenshot: { mimeType: "image/png", base64: encoded } };
    },
    move: (x, y) => act(macInvocations.move(point(x), point(y))),
    click: (x, y) => act(macInvocations.click(point(x), point(y))),
    type: (text) => act(macInvocations.type(text)),
    async key(combo): Promise<DriverOutcome> {
      const invocation = macInvocations.key(combo);
      if (invocation === null) {
        return { ok: false, reason: "unsupported", detail: `"${combo}" is not a key combination this device can press` };
      }
      return act(invocation);
    },
  };
}
