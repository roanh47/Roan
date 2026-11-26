/**
 * The composer's plan-mode control, checked where a user meets it: the label,
 * the pressed state, and the sentence that says the mode is read-only.
 *
 * Rendered on the server so the test needs no DOM, no timers and no clicking —
 * the props are the whole input, and the markup is the whole output.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Composer, MIC_UNAVAILABLE_HINT, PLAN_MODE_HINT } from "./Composer.js";

function render(props: { planMode?: boolean; disabled?: boolean; onRecord?: () => void; recording?: boolean }): string {
  return renderToStaticMarkup(
    <Composer
      disabled={props.disabled ?? false}
      placeholder="Message Roan"
      onSend={() => undefined}
      {...(props.planMode !== undefined ? { planMode: props.planMode } : {})}
      onPlanModeChange={() => undefined}
      {...(props.onRecord !== undefined ? { onRecord: props.onRecord } : {})}
      {...(props.recording !== undefined ? { recording: props.recording } : {})}
    />,
  );
}

/** The mic's own opening tag, so a neighbouring `disabled` cannot fool a test. */
function micTag(html: string): string {
  const match = /<button[^>]*class="composer__mic[^"]*"[^>]*>/.exec(html);
  const tag = match?.[0];
  if (tag === undefined) throw new Error("the composer rendered no mic button");
  return tag;
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

describe("the mic button in the composer", () => {
  it("is disabled and says why when no recorder is wired", () => {
    const tag = micTag(render({}));
    expect(tag).toContain('disabled=""');
    expect(tag).toContain(`title="${MIC_UNAVAILABLE_HINT}"`);
    expect(tag).toContain('aria-label="Record a voice message"');
    // Nothing pretends to be recording when nothing can record.
    expect(tag).toContain('aria-pressed="false"');
  });

  it("is pressable once the app hands over a recorder", () => {
    const tag = micTag(render({ onRecord: () => undefined }));
    expect(tag).not.toContain("disabled");
    expect(tag).toContain('title="Record a voice message"');
    expect(tag).toContain('aria-label="Record a voice message"');
    expect(tag).not.toContain("composer__mic--on");
  });

  it("shows the recording state it is given, not one it invents", () => {
    const tag = micTag(render({ onRecord: () => undefined, recording: true }));
    expect(tag).toContain('aria-label="Stop recording"');
    expect(tag).toContain('aria-pressed="true"');
    expect(tag).toContain("composer__mic--on");
    expect(tag).toContain('title="Stop recording and transcribe it"');
  });

  it("stays locked while the dock is locked, even with a recorder", () => {
    const tag = micTag(render({ onRecord: () => undefined, recording: true, disabled: true }));
    expect(tag).toContain('disabled=""');
  });

  it("no longer ships browser speech recognition of its own", () => {
    // Capture belongs to the app; this component must not reach for a global
    // engine that half the WebViews do not have.
    const html = render({ onRecord: () => undefined });
    expect(html).not.toMatch(/SpeechRecognition/i);
    expect(html).not.toContain("Dictate");
  });
});
