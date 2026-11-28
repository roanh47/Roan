import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ComputerDriver, DriverOutcome } from "./actions.js";
import { createGrantStore } from "./grant.js";
import { createComputerTool, describeScreenPrompt, pngSize, unavailableDriver } from "./tool.js";

/** The first 24 bytes of a PNG that says it is `width` x `height`. */
function pngHeader(width: number, height: number): string {
  const head = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
  head.writeUInt32BE(13, 8);
  head.write("IHDR", 12, "ascii");
  head.writeUInt32BE(width, 16);
  head.writeUInt32BE(height, 20);
  return head.toString("base64");
}

function harness() {
  const did: string[] = [];
  const ok = async (what: string): Promise<DriverOutcome> => {
    did.push(what);
    return { ok: true };
  };
  const driver: ComputerDriver = {
    name: "fake",
    available: () => ({ available: true }),
    screenshot: async () => ({ ok: true, screenshot: { mimeType: "image/png", base64: pngHeader(800, 600) } }),
    move: (x, y) => ok(`move ${String(x)},${String(y)}`),
    click: (x, y) => ok(`click ${String(x)},${String(y)}`),
    type: (text) => ok(`type ${text}`),
    key: (combo) => ok(`key ${combo}`),
  };
  const grants = createGrantStore();
  const asked: string[] = [];
  const tool = createComputerTool({
    session: () => "chat-1",
    grants,
    driver,
    describe: async (_shot, size, question) => {
      asked.push(`${String(size.width)}x${String(size.height)} ${question}`);
      return "A browser. Search box at (400, 80).";
    },
  });
  return { did, grants, asked, tool };
}

const ctx = { cwd: "." };

describe("computer tool", () => {
  it("reads a PNG's size from its header and refuses anything else", () => {
    assert.deepEqual(pngSize(pngHeader(1920, 1080)), { width: 1920, height: 1080 });
    assert.equal(pngSize(Buffer.from("not a png at all, really not").toString("base64")), null);
    assert.equal(pngSize(""), null);
  });

  it("refuses everything until the owner allows the conversation", async () => {
    const { did, tool } = harness();
    await assert.rejects(tool.run({ action: "look" }, ctx), /not allowed for this conversation yet/);
    await assert.rejects(tool.run({ action: "click", x: 1, y: 1 }, ctx), /not allowed/);
    assert.deepEqual(did, []);
  });

  it("looks first, then acts inside the screen it saw", async () => {
    const { did, grants, asked, tool } = harness();
    grants.grantSession("chat-1");
    await assert.rejects(tool.run({ action: "click", x: 10, y: 10 }, ctx), /look at the screen first/);
    const seen = await tool.run({ action: "look", question: "the search box" }, ctx);
    assert.match(seen, /^Screen 800x600\./);
    assert.match(seen, /Search box at \(400, 80\)/);
    assert.deepEqual(asked, ["800x600 the search box"]);

    assert.equal(await tool.run({ action: "click", x: 400, y: 80 }, ctx), "clicked at (400, 80)");
    assert.equal(await tool.run({ action: "type", text: "hello" }, ctx), "typed 5 characters");
    assert.equal(await tool.run({ action: "key", combo: "enter" }, ctx), "pressed enter");
    assert.deepEqual(did, ["click 400,80", "type hello", "key enter"]);
  });

  it("refuses a click outside the screen, a fractional pixel and an unknown action", async () => {
    const { did, grants, tool } = harness();
    grants.grantSession("chat-1");
    await tool.run({ action: "look" }, ctx);
    await assert.rejects(tool.run({ action: "click", x: 800, y: 10 }, ctx), /x must be within/);
    await assert.rejects(tool.run({ action: "move", x: 1.5, y: 10 }, ctx), /whole number/);
    await assert.rejects(tool.run({ action: "dance" }, ctx), /action must be/);
    assert.deepEqual(did, []);
  });

  it("stops the moment the owner takes the permission back", async () => {
    const { grants, tool } = harness();
    grants.grantSession("chat-1");
    await tool.run({ action: "look" }, ctx);
    grants.revokeSession("chat-1");
    await assert.rejects(tool.run({ action: "key", combo: "enter" }, ctx), /was revoked/);
  });

  it("says why on a device that cannot be controlled", async () => {
    const grants = createGrantStore();
    grants.grantSession("chat-1");
    const tool = createComputerTool({
      session: () => "chat-1",
      grants,
      driver: unavailableDriver("this device has no way to move a pointer"),
      describe: async () => "",
    });
    await assert.rejects(tool.run({ action: "look" }, ctx), /no way to move a pointer/);
  });

  it("asks for positions and names what is being looked for", () => {
    const prompt = describeScreenPrompt({ width: 800, height: 600 }, "the save button");
    assert.match(prompt, /800x600/);
    assert.match(prompt, /\(x, y\)/);
    assert.match(prompt, /the save button/);
  });
});
