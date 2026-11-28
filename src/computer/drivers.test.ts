import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExecResult, Invocation } from "./driver-linux.js";
import { createMacDriver, macInvocations, retinaScale } from "./driver-macos.js";
import {
  createWindowsDriver,
  powershellInvocation,
  sendKeysCombo,
  sendKeysText,
  windowsScripts,
} from "./driver-windows.js";

function pngHeader(width: number, height: number): Buffer {
  const head = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
  head.writeUInt32BE(width, 16);
  head.writeUInt32BE(height, 20);
  return head;
}

/** An executor that records what it was asked and answers from a script. */
function recorder(answer: (invocation: Invocation) => Partial<ExecResult>) {
  const ran: Invocation[] = [];
  const run = async (invocation: Invocation): Promise<ExecResult> => {
    ran.push(invocation);
    return { ok: true, stdout: Buffer.alloc(0), stderr: "", message: "", ...answer(invocation) };
  };
  return { ran, run };
}

function decodeCommand(invocation: Invocation): string {
  const encoded = invocation.args[invocation.args.indexOf("-EncodedCommand") + 1] ?? "";
  return Buffer.from(encoded, "base64").toString("utf16le");
}

describe("windows driver", () => {
  it("types text literally, whatever characters it holds", () => {
    assert.equal(sendKeysText("a+b (50%)"), "a{+}b {(}50{%}{)}");
    assert.equal(sendKeysText("line one\nline two"), "line one{ENTER}line two");
  });

  it("spells key combinations the way SendKeys reads them", () => {
    assert.equal(sendKeysCombo("ctrl+s"), "^s");
    assert.equal(sendKeysCombo("ctrl+shift+tab"), "^+{TAB}");
    assert.equal(sendKeysCombo("enter"), "{ENTER}");
    assert.equal(sendKeysCombo("alt+f4"), "%{F4}");
    assert.equal(sendKeysCombo("hyper+x"), null);
    assert.equal(sendKeysCombo("ctrl+"), null);
  });

  it("never puts typed text into a script as source", () => {
    const script = windowsScripts.send(sendKeysText("'; Remove-Item C:\\ -Recurse; '"));
    assert.equal(script.includes("Remove-Item"), false);
    assert.match(script, /FromBase64String\('[A-Za-z0-9+/=]+'\)/);
  });

  it("runs every action as one encoded PowerShell command", async () => {
    const { ran, run } = recorder(() => ({}));
    const driver = createWindowsDriver(run);
    assert.deepEqual(await driver.click(120, 340), { ok: true });
    assert.equal(ran[0]?.bin, "powershell.exe");
    const script = decodeCommand(ran[0] as Invocation);
    assert.match(script, /Point\(120, 340\)/);
    assert.match(script, /mouse_event\(2,/);
    assert.deepEqual(powershellInvocation("x").args.slice(0, 5), [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
    ]);
  });

  it("returns the screenshot it printed, and refuses a key it cannot press", async () => {
    const { run } = recorder(() => ({ stdout: Buffer.from(pngHeader(1920, 1080).toString("base64"), "utf8") }));
    const driver = createWindowsDriver(run);
    const shot = await driver.screenshot();
    assert.equal(shot.ok, true);
    const refused = await driver.key("hyper+x");
    assert.equal(refused.ok, false);
  });
});

describe("macos driver", () => {
  it("passes typed text as an argument, after --", () => {
    const invocation = macInvocations.type('say "hi"');
    assert.equal(invocation.bin, "osascript");
    assert.deepEqual(invocation.args.slice(-2), ["--", 'say "hi"']);
  });

  it("maps key combinations onto System Events", () => {
    assert.match(macInvocations.key("cmd+s")?.args[1] ?? "", /keystroke "s" using \{command down\}/);
    assert.match(macInvocations.key("enter")?.args[1] ?? "", /key code 36$/);
    assert.match(macInvocations.key("ctrl+shift+tab")?.args[1] ?? "", /key code 48 using \{control down, shift down\}/);
    assert.equal(macInvocations.key("hyper+x"), null);
  });

  it("learns the Retina scale from a screenshot and divides positions by it", async () => {
    assert.equal(retinaScale(pngHeader(2880, 1800).toString("base64"), 1440), 2);
    assert.equal(retinaScale(pngHeader(1440, 900).toString("base64"), 1440), 1);
    assert.equal(retinaScale("", 1440), 1);

    const { ran, run } = recorder((invocation) =>
      invocation.bin === "/bin/sh"
        ? { stdout: pngHeader(2880, 1800) }
        : invocation.args.includes("-l") && invocation.args.join(" ").includes("CGDisplayBounds")
          ? { stdout: Buffer.from("1440", "utf8") }
          : {},
    );
    const driver = createMacDriver(run);
    assert.equal((await driver.screenshot()).ok, true);
    await driver.click(800, 600);
    const click = ran[ran.length - 1];
    assert.match(click?.args.join(" ") ?? "", /CGPointMake\(400, 300\)/);
    assert.match(click?.args.join(" ") ?? "", /kCGEventLeftMouseDown/);
  });

  it("says which permission is missing when an action fails", async () => {
    const { run } = recorder(() => ({ ok: false, message: "osascript failed: not allowed" }));
    const result = await createMacDriver(run).type("x");
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.detail, /Accessibility/);
  });
});
