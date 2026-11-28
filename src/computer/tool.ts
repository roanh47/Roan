import type { Tool } from "../types.js";
import {
  createComputerActions,
  type ActionResult,
  type ComputerDriver,
  type ScreenSize,
  type Screenshot,
} from "./actions.js";
import type { GrantStore } from "./grant.js";

/**
 * Computer use as one tool: look at the screen, then move, click, type, press.
 *
 * The agent cannot see pixels through a tool result, which is text. So `look`
 * takes a screenshot and has a model that can see describe it, with pixel
 * positions; the answer is what the agent acts on. Every action checks the
 * grant of the conversation first — the owner gives it in the app, for a few
 * minutes, and takes it back with one press.
 *
 * The screen size comes from the screenshot itself, so there is nothing to
 * configure and a click can never be validated against a guessed size. That
 * is also why the first action has to be a look.
 */

export interface ComputerToolOptions {
  /** The conversation whose grant gates every action. */
  readonly session: () => string;
  readonly grants: GrantStore;
  readonly driver: ComputerDriver;
  /** Has a model that can see describe the screenshot. */
  readonly describe: (shot: Screenshot, size: ScreenSize, question: string) => Promise<string>;
}

/** Width and height of a PNG, read from its header, or null when it is not one. */
export function pngSize(base64: string): ScreenSize | null {
  const head = Buffer.from(base64.slice(0, 64), "base64");
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (head.length < 24) return null;
  for (let index = 0; index < signature.length; index += 1) {
    if (head[index] !== signature[index]) return null;
  }
  const width = head.readUInt32BE(16);
  const height = head.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

/** What the seeing model is asked: a map of the screen the agent can act on. */
export function describeScreenPrompt(size: ScreenSize, question: string): string {
  return [
    `This is a screenshot of a ${String(size.width)}x${String(size.height)} pixel screen. A colleague who cannot see it will control the mouse and keyboard from your description.`,
    "Say which window or app is in front, then list what can be clicked or typed into: its label, what it is, and the pixel position of its centre as (x, y) measured from the top-left corner.",
    "Transcribe visible text that matters. Be literal; do not guess at what is hidden.",
    question.trim().length > 0 ? `They are looking for: ${question.trim()}` : "",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

function integer(value: unknown, name: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${name} must be a whole number of pixels`);
  return parsed;
}

function settle(result: ActionResult, done: string): string {
  if (!result.ok) throw new Error(result.detail);
  return done;
}

export function createComputerTool(options: ComputerToolOptions): Tool {
  /** The size of the screen the agent last looked at, per conversation. */
  const screens = new Map<string, ScreenSize>();

  return {
    name: "computer",
    description:
      "Control the mouse and keyboard of this device. Always start with action look: it describes the screen " +
      "with pixel positions. Then move, click, type or key, and look again to check what happened. " +
      "The owner has to allow this for the conversation in the app first.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["look", "move", "click", "type", "key"] },
        question: { type: "string", description: "For look: what you are trying to find on the screen" },
        x: { type: "number", description: "For move and click: pixels from the left edge" },
        y: { type: "number", description: "For move and click: pixels from the top edge" },
        text: { type: "string", description: "For type: the text to type into the focused field" },
        combo: { type: "string", description: "For key: one key or a combination, such as enter or ctrl+s" },
      },
      required: ["action"],
    },
    async run(args): Promise<string> {
      const session = options.session();
      const action = String(args["action"] ?? "");
      const check = options.grants.check(session);
      if (!check.granted) {
        throw new Error(
          check.reason === "no-grant"
            ? "computer use is not allowed for this conversation yet; ask the owner to allow it under Settings → Computer use"
            : `computer use was ${check.reason} for this conversation; ask the owner to allow it again under Settings → Computer use`,
        );
      }
      const available = options.driver.available();
      if (!available.available) throw new Error(available.reason);

      if (action === "look") {
        const shot = await options.driver.screenshot();
        if (!shot.ok) throw new Error(shot.detail);
        const size = pngSize(shot.screenshot.base64);
        if (size === null) throw new Error("the screenshot is not a PNG, so its size cannot be read");
        screens.set(session, size);
        const question = typeof args["question"] === "string" ? args["question"] : "";
        const seen = (await options.describe(shot.screenshot, size, question)).trim();
        if (seen.length === 0) throw new Error("the model that looks at the screen returned nothing");
        return `Screen ${String(size.width)}x${String(size.height)}.\n${seen}`;
      }

      const screen = screens.get(session);
      if (screen === undefined) throw new Error("look at the screen first: action look");
      const actions = createComputerActions({ sessionId: session, driver: options.driver, screen, grants: options.grants });

      if (action === "move") {
        const x = integer(args["x"], "x");
        const y = integer(args["y"], "y");
        return settle(await actions.moveTo(x, y), `moved to (${String(x)}, ${String(y)})`);
      }
      if (action === "click") {
        const x = integer(args["x"], "x");
        const y = integer(args["y"], "y");
        return settle(await actions.click(x, y), `clicked at (${String(x)}, ${String(y)})`);
      }
      if (action === "type") {
        const text = typeof args["text"] === "string" ? args["text"] : "";
        return settle(await actions.type(text), `typed ${String(text.length)} characters`);
      }
      if (action === "key") {
        const combo = typeof args["combo"] === "string" ? args["combo"] : "";
        return settle(await actions.key(combo), `pressed ${combo}`);
      }
      throw new Error("action must be look, move, click, type or key");
    },
  };
}

/** The driver for a device that cannot be controlled: every action says why. */
export function unavailableDriver(reason: string): ComputerDriver {
  const no = async () => ({ ok: false as const, reason: "unavailable" as const, detail: reason });
  return {
    name: "none",
    available: () => ({ available: false, reason }),
    screenshot: no,
    move: no,
    click: no,
    type: no,
    key: no,
  };
}
