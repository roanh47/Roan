/**
 * The composer's plan-mode control, checked where a user meets it: the label,
 * the pressed state, and the sentence that says the mode is read-only.
 *
 * Rendered on the server so the test needs no DOM, no timers and no clicking —
 * the props are the whole input, and the markup is the whole output.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Composer, PLAN_MODE_HINT } from "./Composer.js";

function render(props: { planMode?: boolean; disabled?: boolean }): string {
  return renderToStaticMarkup(
    <Composer
      disabled={props.disabled ?? false}
      placeholder="Message Roan"
      onSend={() => undefined}
      {...(props.planMode !== undefined ? { planMode: props.planMode } : {})}
      onPlanModeChange={() => undefined}
    />,
  );
}

describe("the plan toggle in the composer", () => {
  it("is off by default and says the agent may act", () => {
    const html = render({});
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("Plan mode is off");
    expect(html).not.toContain("Approve plan");
    expect(html).not.toContain(PLAN_MODE_HINT);
  });

  it("is honest while it is on: read-only, no writes, approve to execute", () => {
    const html = render({ planMode: true });
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Plan mode is on: read-only");
    expect(html).toContain("Approve plan");
    // The words a user has to read before trusting the toggle.
    expect(html).toMatch(/read-only/);
    expect(html).toMatch(/cannot write files or run commands/);
    expect(html).toContain("Send message (plan mode is read-only)");
  });

  it("keeps the copy about refusing work, not about a hidden setting", () => {
    expect(PLAN_MODE_HINT).toMatch(/researches and writes a plan/);
    expect(PLAN_MODE_HINT).toMatch(/until you approve/);
  });

  it("cannot be flipped while the dock is locked", () => {
    const html = render({ planMode: true, disabled: true });
    // Both the pill and the approve button disable, so a mid-turn click is not
    // a silent no-op that looks like a broken toggle.
    expect(html.match(/disabled=""/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});
