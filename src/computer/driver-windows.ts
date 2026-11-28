/**
 * The Windows driver: PowerShell and the .NET that ships with Windows.
 *
 * Nothing has to be installed. Every action is one PowerShell script, built
 * here as text and handed over base64-encoded (`-EncodedCommand`), so there is
 * no quoting to get wrong. Text the model wants typed never appears in a
 * script as source: it rides as base64 and is decoded inside PowerShell, so a
 * quote or a `$(...)` in it stays text.
 *
 * The screenshot and the pointer use the same coordinate space (the primary
 * screen as this process sees it), so a position read from the picture is the
 * position the pointer goes to.
 */

import type { ComputerDriver, DriverOutcome, ScreenshotOutcome } from "./actions.js";
import { execFileRunner, type Executor, type Invocation } from "./driver-linux.js";

const POWERSHELL = "powershell.exe";

const ASSEMBLIES = "Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing;";

const MOUSE =
  "Add-Type -Namespace Roan -Name Mouse -MemberDefinition '[DllImport(\"user32.dll\")] public static extern void mouse_event(uint f, uint x, uint y, uint d, System.UIntPtr e);';";

/** Characters SendKeys reads as commands; in braces they are just characters. */
const SENDKEYS_SPECIAL = /[+^%~(){}[\]]/g;

/** Key names the agent may use, in SendKeys spelling. */
const NAMED_KEYS: Readonly<Record<string, string>> = {
  enter: "{ENTER}",
  return: "{ENTER}",
  tab: "{TAB}",
  esc: "{ESC}",
  escape: "{ESC}",
  backspace: "{BACKSPACE}",
  delete: "{DELETE}",
  space: " ",
  up: "{UP}",
  down: "{DOWN}",
  left: "{LEFT}",
  right: "{RIGHT}",
  home: "{HOME}",
  end: "{END}",
  pageup: "{PGUP}",
  pagedown: "{PGDN}",
};

const MODIFIERS: Readonly<Record<string, string>> = { ctrl: "^", control: "^", alt: "%", shift: "+" };

/** Text as SendKeys types it literally. */
export function sendKeysText(text: string): string {
  return text.replace(SENDKEYS_SPECIAL, (char) => `{${char}}`).replace(/\r?\n/g, "{ENTER}");
}

/** `ctrl+s` as SendKeys spells it (`^s`), or null when a part is not a key it knows. */
export function sendKeysCombo(combo: string): string | null {
  const parts = combo.toLowerCase().split("+");
  const key = parts.pop();
  if (key === undefined || key.length === 0) return null;
  let prefix = "";
  for (const part of parts) {
    const modifier = MODIFIERS[part];
    if (modifier === undefined) return null;
    prefix += modifier;
  }
  const named = NAMED_KEYS[key];
  if (named !== undefined) return prefix + named;
  if (/^f([1-9]|1[0-2])$/.test(key)) return `${prefix}{${key.toUpperCase()}}`;
  if (/^[a-z0-9]$/.test(key)) return prefix + key;
  return null;
}

function base64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

/** The script for one action. Pure text in, text out. */
export const windowsScripts = {
  screenshot(): string {
    return [
      ASSEMBLIES,
      "$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds;",
      "$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height;",
      "$g = [System.Drawing.Graphics]::FromImage($bmp);",
      "$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size);",
      "$ms = New-Object System.IO.MemoryStream;",
      "$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png);",
      "[Console]::Out.Write([Convert]::ToBase64String($ms.ToArray()));",
    ].join(" ");
  },
  move(x: number, y: number): string {
    return `${ASSEMBLIES} [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${String(x)}, ${String(y)});`;
  },
  click(x: number, y: number): string {
    return [
      windowsScripts.move(x, y),
      MOUSE,
      "[Roan.Mouse]::mouse_event(2, 0, 0, 0, [System.UIntPtr]::Zero);",
      "[Roan.Mouse]::mouse_event(4, 0, 0, 0, [System.UIntPtr]::Zero);",
    ].join(" ");
  },
  /** `keys` is already in SendKeys spelling; it travels as base64. */
  send(keys: string): string {
    return `${ASSEMBLIES} $k = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${base64(keys)}')); [System.Windows.Forms.SendKeys]::SendWait($k);`;
  },
};

/** One PowerShell run of a script, with nothing for a shell to reinterpret. */
export function powershellInvocation(script: string): Invocation {
  return {
    bin: POWERSHELL,
    args: [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ],
  };
}

export function createWindowsDriver(run: Executor = execFileRunner()): ComputerDriver {
  async function act(script: string): Promise<DriverOutcome> {
    const result = await run(powershellInvocation(script));
    return result.ok ? { ok: true } : { ok: false, reason: "failed", detail: result.message || "PowerShell failed" };
  }
  return {
    name: "windows",
    available: () => ({ available: true }),
    async screenshot(): Promise<ScreenshotOutcome> {
      const result = await run(powershellInvocation(windowsScripts.screenshot()));
      if (!result.ok) return { ok: false, reason: "failed", detail: result.message || "PowerShell failed" };
      const encoded = result.stdout.toString("utf8").trim();
      if (encoded.length === 0) return { ok: false, reason: "failed", detail: "the screen capture produced no image data" };
      return { ok: true, screenshot: { mimeType: "image/png", base64: encoded } };
    },
    move: (x, y) => act(windowsScripts.move(x, y)),
    click: (x, y) => act(windowsScripts.click(x, y)),
    type: (text) => act(windowsScripts.send(sendKeysText(text))),
    async key(combo): Promise<DriverOutcome> {
      const keys = sendKeysCombo(combo);
      if (keys === null) {
        return { ok: false, reason: "unsupported", detail: `"${combo}" is not a key combination this device can press` };
      }
      return act(windowsScripts.send(keys));
    },
  };
}
