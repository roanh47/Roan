/**
 * What the browser tool offers the model.
 *
 * One name, four actions, one flat schema. The per-action schemas stay here so
 * a UI can show them one by one; the registry sees `browserParameters()`. The
 * action list is the single source of truth for both, so an action cannot be
 * advertised in one place and missing in the other.
 */

export interface BrowserAction {
  readonly name: "navigate" | "read" | "click" | "screenshot";
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

export interface BrowserToolSurface {
  readonly name: "browser";
  readonly summary: string;
  readonly actions: readonly BrowserAction[];
}

function actionSchema(
  name: BrowserAction["name"],
  extra: Record<string, unknown> = {},
  required: string[] = [],
): Record<string, unknown> {
  return {
    type: "object",
    properties: { action: { const: name }, ...extra },
    required: ["action", ...required],
  };
}

const NAVIGATE = actionSchema(
  "navigate",
  { url: { type: "string", description: "The address to load in the current tab." } },
  ["url"],
);
const READ = actionSchema("read");
const CLICK = actionSchema(
  "click",
  { selector: { type: "string", description: "CSS selector of the element to click." } },
  ["selector"],
);
const SCREENSHOT = actionSchema("screenshot");

export const browserTool: BrowserToolSurface = {
  name: "browser",
  summary:
    "Control the local browser: navigate to a url, read the page text, click an element, take a screenshot.",
  actions: [
    { name: "navigate", description: "Load a url in the current tab.", parameters: NAVIGATE },
    { name: "read", description: "Return the visible text of the page.", parameters: READ },
    { name: "click", description: "Click the first element matching a CSS selector.", parameters: CLICK },
    { name: "screenshot", description: "Capture the page as base64 PNG.", parameters: SCREENSHOT },
  ],
};

/** `navigate, read, click, screenshot` — for a refusal a model can act on. */
export const browserActionNames = browserTool.actions.map((action) => action.name).join(", ");

/** The flat JSON Schema a caller registers: `{ action, url?, selector? }`. */
export function browserParameters(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: browserTool.actions.map((action) => action.name),
        description: "What to do in the page.",
      },
      url: { type: "string", description: "For navigate: the address to load." },
      selector: { type: "string", description: "For click: CSS selector of the element." },
    },
    required: ["action"],
  };
}

/** The refusal for an unusable action name, or undefined when it is one of ours. */
export function actionProblem(action: string): string | undefined {
  if (action === "") return `browser: no action given; use one of ${browserActionNames}`;
  if (!browserTool.actions.some((entry) => entry.name === action)) {
    return `browser: unknown action ${JSON.stringify(action)}; use one of ${browserActionNames}`;
  }
  return undefined;
}
