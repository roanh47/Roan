import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

import { BackgroundPanel } from "./BackgroundPanel.js";
import { describeJob, removeJob, setJobEnabled, validateDraft, type BackgroundJob } from "./background.js";

const jobs: BackgroundJob[] = [
  { id: "a", prompt: "summarise my inbox", schedule: "every 30m", enabled: true },
  { id: "b", prompt: "plan the day", schedule: "daily 07:30", enabled: false },
];

function render(element: ReactElement): string {
  return renderToStaticMarkup(element);
}

describe("BackgroundPanel", () => {
  test("lists every job with its rhythm and switch state", () => {
    const markup = render(
      <BackgroundPanel jobs={jobs} onCreate={vi.fn()} onToggle={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(markup).toContain("summarise my inbox");
    expect(markup).toContain("every 30m · on");
    expect(markup).toContain("plan the day");
    expect(markup).toContain("daily 07:30 · paused");
    expect(markup).toContain("2 scheduled");
  });

  test("an enabled job offers Pause, a disabled one Resume, each with Delete", () => {
    const markup = render(
      <BackgroundPanel jobs={jobs} onCreate={vi.fn()} onToggle={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(markup).toContain(">Pause<");
    expect(markup).toContain(">Resume<");
    expect(markup.match(/>Delete</g)).toHaveLength(2);
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('aria-pressed="false"');
  });

  test("shows the create fields with a usable default schedule", () => {
    const markup = render(
      <BackgroundPanel jobs={[]} onCreate={vi.fn()} onToggle={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(markup).toContain("What should he do?");
    expect(markup).toContain('value="every 30m"');
    expect(markup).toContain(">Add task<");
  });

  test("an empty list says so instead of rendering a blank panel", () => {
    const markup = render(
      <BackgroundPanel jobs={[]} onCreate={vi.fn()} onToggle={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(markup).toContain("Nothing runs in the background.");
    expect(markup).toContain("nothing scheduled");
  });

  test("the parent's status line is shown when there is one", () => {
    const markup = render(
      <BackgroundPanel
        jobs={[]}
        onCreate={vi.fn()}
        onToggle={vi.fn()}
        onDelete={vi.fn()}
        status="saved"
      />,
    );
    expect(markup).toContain("saved");
    const quiet = render(
      <BackgroundPanel jobs={[]} onCreate={vi.fn()} onToggle={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(quiet).not.toContain("panel__status");
  });
});

describe("background job edits", () => {
  test("a toggle changes exactly one job", () => {
    const next = setJobEnabled(jobs, "a", false);
    expect(next.map((job) => job.enabled)).toEqual([false, false]);
    expect(next[1]).toEqual(jobs[1]);
    expect(jobs[0]?.enabled).toBe(true);
  });

  test("an unknown id changes nothing", () => {
    expect(setJobEnabled(jobs, "zzz", false)).toEqual(jobs);
    expect(removeJob(jobs, "zzz")).toEqual(jobs);
  });

  test("delete removes one job and keeps the rest in order", () => {
    expect(removeJob(jobs, "a").map((job) => job.id)).toEqual(["b"]);
    expect(removeJob(jobs, "b").map((job) => job.id)).toEqual(["a"]);
    expect(removeJob(jobs, "a")).toHaveLength(1);
  });

  test("the summary line names the rhythm and the state", () => {
    expect(describeJob(jobs[0] as BackgroundJob)).toBe("every 30m · on");
    expect(describeJob(jobs[1] as BackgroundJob)).toBe("daily 07:30 · paused");
  });
});

describe("draft validation", () => {
  test("a prompt and a readable schedule are accepted", () => {
    expect(validateDraft({ prompt: "summarise my inbox", schedule: "every 30m" })).toBeNull();
    expect(validateDraft({ prompt: "plan the day", schedule: "daily 07:30" })).toBeNull();
    expect(validateDraft({ prompt: "  spaced  ", schedule: " every 30m " })).toBeNull();
  });

  test("an empty prompt is refused", () => {
    expect(validateDraft({ prompt: "   ", schedule: "every 30m" })).toMatch(/prompt/i);
  });

  test("an empty schedule is refused", () => {
    expect(validateDraft({ prompt: "go", schedule: "  " })).toMatch(/schedule/i);
  });

  test("an unreadable schedule is refused with the three shapes named", () => {
    const problem = validateDraft({ prompt: "go", schedule: "elke dag" });
    expect(problem).toContain("every 30m");
    expect(problem).toContain("daily 07:30");
  });
});
