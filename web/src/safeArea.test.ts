/**
 * Where the status-bar space comes from.
 *
 * The page is one bundle: a phone, a desktop window and a browser tab all get
 * the same HTML. So the stylesheets may only *read* the platform's insets
 * (`env(safe-area-inset-*, 0px)`); a literal floor of 30 px for a status bar
 * would be a dead strip above the content on a desktop. These checks read the
 * shipped CSS and the shipped page, because that is the contract.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Read from disk: a CSS import is stubbed in the test runner, `?raw` included. */
function read(name: string): string {
  return readFileSync(new URL(name, import.meta.url), "utf8");
}

const styles = read("./styles.css");
const layout = read("./layout.css");
const page = read("../index.html");

/** Comments describe the rules; they must not be mistaken for them. */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

const css = `${withoutComments(styles)}\n${withoutComments(layout)}`;

/** Every `selector { body }` pair that is not itself wrapped in an at-rule. */
function blocks(source: string): { selector: string; body: string }[] {
  const found: { selector: string; body: string }[] = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match = pattern.exec(source);
  while (match !== null) {
    const selector = (match[1] ?? "").trim().replace(/\s+/g, " ");
    const body = match[2] ?? "";
    if (selector.length > 0 && !selector.startsWith("@")) found.push({ selector, body });
    match = pattern.exec(source);
  }
  return found;
}

/** The value of one longhand declaration inside a block, if it has one. */
function declaration(body: string, property: string): string | null {
  const pattern = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "i");
  const match = pattern.exec(body);
  return match === null ? null : (match[1] ?? "").trim();
}

const ENV_TOP = /^env\(\s*safe-area-inset-top\s*,\s*0px\s*\)$/;

describe("the status-bar space belongs to the shell", () => {
  it("keeps the page edge-to-edge with viewport-fit=cover", () => {
    expect(page).toContain("viewport-fit=cover");
  });

  it("has no shell-specific compensation class left in the CSS", () => {
    expect(css).not.toContain(".app-shell");
  });

  it("reads every top inset from env(), with 0px as the fallback", () => {
    const uses = css.match(/safe-area-inset-top/g) ?? [];
    const envUses = css.match(/env\(\s*safe-area-inset-top\s*,\s*0px\s*\)/g) ?? [];
    expect(uses.length).toBeGreaterThan(0);
    expect(envUses.length).toBe(uses.length);
    // No `max(env(...), 30px)`: that is a floor, not an inset.
    expect(css).not.toMatch(/max\(\s*env\(\s*safe-area-inset-top/);
  });

  it("never pins a literal top padding on the header or the shell", () => {
    const watched = new Set([".app", ".app--rail-collapsed", ".rail", ".titlebar"]);
    for (const { selector, body } of blocks(css)) {
      if (!watched.has(selector)) continue;
      const top = declaration(body, "padding-top");
      if (top === null) continue;
      expect(top, `${selector} must not pin a top padding`).toMatch(ENV_TOP);
    }
    // The header grows downwards on its own (content + border); the status bar
    // is the shell's, so the titlebar may not add a top inset of its own.
    for (const { selector, body } of blocks(css)) {
      if (selector !== ".titlebar") continue;
      expect(declaration(body, "padding-top")).toBeNull();
    }
  });
});
