import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ImportPanel, type ImportPlanView } from "./ImportPanel.js";

const candidates = [
  { path: "/work/alpha/AGENTS.md", kind: "agents", bytes: 2048 },
  { path: "/work/alpha/.cursorrules", kind: "cursor", bytes: 120 },
];

const plan: ImportPlanView = {
  adds: [
    { path: "imported/AGENTS.md", size: 2048 },
    { path: "imported/.cursorrules", size: 120 },
  ],
  conflicts: [{ path: "imported/CLAUDE.md", reason: "exists" }],
};

function render(element: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(element);
}

describe("ImportPanel", () => {
  test("lists the discovered candidates with their kind and size", () => {
    const markup = render(<ImportPanel candidates={candidates} plan={plan} onImport={vi.fn()} />);
    expect(markup).toContain("/work/alpha/AGENTS.md");
    expect(markup).toContain("agents · 2 kB");
    expect(markup).toContain(".cursorrules");
    expect(markup).toContain("cursor · 120 B");
    expect(markup).toContain("2 instruction files found.");
  });

  test("lists what will be added and what collides", () => {
    const markup = render(<ImportPanel candidates={candidates} plan={plan} onImport={vi.fn()} />);
    expect(markup).toContain("imported/AGENTS.md");
    expect(markup).toContain("imported/CLAUDE.md");
    expect(markup).toContain("already exists · left untouched");
  });

  test("explains that a duplicate inside the batch is not overwritten", () => {
    const markup = render(
      <ImportPanel
        candidates={candidates}
        plan={{ adds: [], conflicts: [{ path: "imported/AGENTS-2.md", reason: "duplicate" }] }}
        onImport={vi.fn()}
      />,
    );
    expect(markup).toContain("already in this import · left untouched");
  });

  test("keeps Import disabled until the user confirms", () => {
    const markup = render(<ImportPanel candidates={candidates} plan={plan} onImport={vi.fn()} />);
    expect(markup).toContain(">Import 2 files<");
    expect(markup).toContain('type="checkbox"');
    expect(markup).toContain("disabled=\"\"");
    expect(markup).toContain("existing files are not overwritten");
  });

  test("says when there is nothing to import and still shows the conflicts", () => {
    const markup = render(
      <ImportPanel
        candidates={[]}
        plan={{ adds: [], conflicts: [{ path: "imported/AGENTS.md" }] }}
        onImport={vi.fn()}
      />,
    );
    expect(markup).toContain("No instruction files found in the chosen folders.");
    expect(markup).toContain("Nothing new to import.");
    expect(markup).toContain(">Import 0 files<");
    expect(markup).toContain("already exists · left untouched");
  });

  test("says so when the plan has no conflicts", () => {
    const markup = render(
      <ImportPanel candidates={[]} plan={{ adds: [], conflicts: [] }} onImport={vi.fn()} />,
    );
    expect(markup).toContain("No conflicts.");
  });

  test("shows the parent's status line when there is one", () => {
    const markup = render(
      <ImportPanel candidates={candidates} plan={plan} onImport={vi.fn()} status="imported 2 files" />,
    );
    expect(markup).toContain("imported 2 files");
  });
});
