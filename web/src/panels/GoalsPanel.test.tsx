import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GoalsPanel, type Goal } from "./GoalsPanel";

/**
 * The panel is props-only, so it renders without a browser: static markup is
 * enough to prove what a person sees for each status, and that the callbacks
 * are wired to buttons rather than to a fetch of its own.
 */

const GOALS: Goal[] = [
  { id: "g1", text: "keep the chain append-only", status: "open", createdAt: 1 },
  { id: "g2", text: "ask before touching dist/", status: "done", createdAt: 2, note: "done in one turn" },
  { id: "g3", text: "old idea", status: "cancelled", createdAt: 3 },
];

function render(goals: readonly Goal[]): string {
  return renderToStaticMarkup(<GoalsPanel goals={goals} onClose={() => {}} onCreate={() => {}} />);
}

describe("GoalsPanel", () => {
  it("says so when there are no goals", () => {
    const html = render([]);

    expect(html).toContain("Standing orders");
    expect(html).toContain("No standing orders.");
  });

  it("lists every goal with its status and note", () => {
    const html = render(GOALS);

    expect(html).toContain("keep the chain append-only");
    expect(html).toContain("ask before touching dist/");
    expect(html).toContain("old idea");
    expect(html).toContain("Open");
    expect(html).toContain("Done");
    expect(html).toContain("Cancelled");
    expect(html).toContain("done in one turn");
  });

  it("offers a close button per goal, disabled once it is settled", () => {
    const html = render(GOALS);

    expect(html.match(/aria-label="Close /g)?.length).toBe(3);
    // One enabled button (the open goal), two disabled ones.
    expect(html.match(/disabled=""/g)?.length).toBe(2);
  });

  it("offers a way to add an order without fetching anything", () => {
    const html = render(GOALS);

    expect(html).toContain("Add order");
    expect(html).toContain("A standing order");
  });
});
