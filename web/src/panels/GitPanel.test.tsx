import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { applyDiffStats, parseStatus } from "../../../src/gitpanel/status.js";
import { GitPanel, type GitChangedFile } from "./GitPanel.js";

/**
 * The panel is props-only, so static markup is enough: every badge, count and
 * button state is decided from the list it was handed, with no git and no disk.
 */

const FILES: GitChangedFile[] = [
  {
    path: "src/a.ts",
    code: "MM",
    staged: true,
    unstaged: true,
    untracked: false,
    stat: { added: 12, removed: 3 },
  },
  {
    path: "src/new name.ts",
    code: "R ",
    originalPath: "src/old name.ts",
    staged: true,
    unstaged: false,
    untracked: false,
  },
  {
    path: "notes/todo.md",
    code: "??",
    staged: false,
    unstaged: false,
    untracked: true,
  },
  {
    path: "assets/logo.png",
    code: " M",
    staged: false,
    unstaged: true,
    untracked: false,
    stat: { added: 0, removed: 0, binary: true },
  },
];

function render(
  files: readonly GitChangedFile[],
  extra: { draft?: string; status?: string; busy?: boolean } = {},
): string {
  return renderToStaticMarkup(<GitPanel files={files} onCommit={vi.fn()} {...extra} />);
}

describe("GitPanel", () => {
  it("says the tree is clean and refuses to commit", () => {
    const html = render([]);

    expect(html).toContain("Changes");
    expect(html).toContain("No changes.");
    expect(html).toContain("Write a commit message first.");
    expect(html.match(/disabled=""/g)?.length).toBe(1);
  });

  it("lists every changed path with its badges and diffstat", () => {
    const html = render(FILES);

    expect(html).toContain("src/a.ts");
    expect(html).toContain("notes/todo.md");
    expect(html).toContain("Staged");
    expect(html).toContain("Unstaged");
    expect(html).toContain("Untracked");
    expect(html).toContain("+12 −3");
    expect(html).toContain("binary");
  });

  it("shows the rename's source without losing the new name", () => {
    const html = render(FILES);

    expect(html).toContain("src/new name.ts");
    expect(html).toContain("was src/old name.ts");
  });

  it("summarises the bucket counts in the header", () => {
    expect(render(FILES)).toContain("2 staged, 2 unstaged, 1 untracked");
    expect(render([])).toContain("No changes");
  });

  it("keeps Commit disabled while the message box is empty", () => {
    const html = render(FILES);

    expect(html).toContain("Write a commit message first.");
    expect(html.match(/disabled=""/g)?.length).toBe(1);
  });

  it("enables Commit once there is a message and something staged", () => {
    const html = render(FILES, { draft: "fix the parser" });

    expect(html).toContain('value="fix the parser"');
    expect(html).toContain("Ready to commit.");
    expect(html).not.toContain("disabled=");
  });

  it("stays disabled when the draft is only untracked work", () => {
    const untracked = FILES.filter((file) => file.untracked);
    const html = render(untracked, { draft: "add notes" });

    expect(html).toContain("Nothing staged yet.");
    expect(html.match(/disabled=""/g)?.length).toBe(1);
  });

  it("passes a parent note through to the form", () => {
    const html = render(FILES, { status: "git commit failed: nothing to commit" });

    expect(html).toContain('role="status"');
    expect(html).toContain("git commit failed: nothing to commit");
  });

  it("renders the parser's own output without adaptation", () => {
    const status = applyDiffStats(parseStatus("MM src/a.ts\u0000?? note.md\u0000"), [
      { path: "src/a.ts", added: 2, removed: 1, binary: false },
    ]);

    const html = render(status.files);

    expect(html).toContain("1 staged, 1 unstaged, 1 untracked");
    expect(html).toContain("+2 −1");
  });
});
