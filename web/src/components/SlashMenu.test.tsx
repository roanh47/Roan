/**
 * The slash menu, checked where the owner meets it: which commands it offers
 * for what was typed, which row is highlighted, and what a pick resolves to.
 *
 * Rendered on the server so the test needs no DOM, no timers and no clicking —
 * the props are the whole input and the markup is the whole output. The pick
 * itself goes through `highlightedCommand`, the same lookup the click and the
 * Enter key use, so its result is the name `onPick` would receive.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import SlashMenu, {
  clampHighlight,
  filterCommands,
  highlightedCommand,
  stepHighlight,
  type SlashCommand,
} from "./SlashMenu.js";

const COMMANDS: readonly SlashCommand[] = [
  { name: "review", description: "Look over the current diff" },
  { name: "standup", description: "What moved yesterday" },
  { name: "resume", description: "Pick up where the last turn stopped" },
];

function render(prefix: string, highlight?: number): string {
  return renderToStaticMarkup(
    <SlashMenu
      commands={COMMANDS}
      prefix={prefix}
      onPick={() => undefined}
      {...(highlight === undefined ? {} : { highlight })}
    />,
  );
}

describe("the slash menu", () => {
  it("renders nothing at all when there is nothing to offer", () => {
    expect(renderToStaticMarkup(<SlashMenu commands={[]} prefix="" onPick={() => undefined} />)).toBe("");
    expect(render("zzz")).toBe("");
  });

  it("offers every command when only the slash has been typed", () => {
    const html = render("");

    expect(html).toContain("/review");
    expect(html).toContain("/standup");
    expect(html).toContain("/resume");
    expect(html).toContain("Look over the current diff");
    expect(html.match(/class="slashmenu__row"/g)?.length).toBe(3);
  });

  it("filters by the prefix, ignoring case and a leading slash", () => {
    const html = render("re");

    expect(html).toContain("/review");
    expect(html).toContain("/resume");
    expect(html).not.toContain("/standup");

    expect(render("RE")).toContain("/review");
    expect(render("/re")).toContain("/resume");
  });

  it("filters on the start of the name, not somewhere inside it", () => {
    expect(filterCommands(COMMANDS, "view").map((command) => command.name)).toEqual([]);
    expect(filterCommands(COMMANDS, "stand").map((command) => command.name)).toEqual(["standup"]);
  });

  it("marks exactly one row as highlighted, and only that row", () => {
    const html = render("", 1);

    expect(html.match(/aria-selected="true"/g)?.length).toBe(1);
    expect(html.match(/aria-selected="false"/g)?.length).toBe(2);
    expect(html).toMatch(/aria-selected="true"[^>]*data-name="standup"/);
  });

  it("clamps a remembered highlight that no longer fits the list", () => {
    expect(clampHighlight(9, 2)).toBe(1);
    expect(clampHighlight(-3, 2)).toBe(0);
    expect(clampHighlight(0, 0)).toBe(0);
    // A narrow filter still highlights something rather than nothing.
    expect(render("re", 5)).toMatch(/aria-selected="true"[^>]*data-name="resume"/);
  });

  it("wraps the highlight at both ends", () => {
    expect(stepHighlight(2, 1, 3)).toBe(0);
    expect(stepHighlight(0, -1, 3)).toBe(2);
    expect(stepHighlight(0, 1, 0)).toBe(0);
  });

  it("resolves a pick to the highlighted name in the filtered list", () => {
    expect(highlightedCommand(COMMANDS, "re", 0)?.name).toBe("review");
    expect(highlightedCommand(COMMANDS, "re", 1)?.name).toBe("resume");
    expect(highlightedCommand(COMMANDS, "zzz", 0)).toBeNull();
  });

  it("carries the name and index each row picks on", () => {
    const html = render("re");

    expect(html).toContain('data-index="0"');
    expect(html).toContain('data-index="1"');
    expect(html).toContain('data-name="review"');
    expect(html).toContain('data-name="resume"');
    // Rows are buttons, so a tap picks as surely as Enter does.
    expect(html.match(/<button[^>]*class="slashmenu__row"/g)?.length).toBe(2);
  });

  it("renders a description as text, never as markup it contains", () => {
    const html = renderToStaticMarkup(
      <SlashMenu
        commands={[{ name: "evil", description: '<script>alert("x")</script>' }]}
        prefix=""
        onPick={() => undefined}
      />,
    );

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
