import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { WorkspaceHost, WorkspacePanel, WorkspacePanelView, type WorkspaceEntryView, type WorkspacePreview } from "./WorkspacePanel";

/**
 * The panel is props-only, so static markup proves every state a person sees:
 * no socket, no fetch, no timers. What the daemon refuses shows up as `status`,
 * and the download link is whatever href the parent hands in.
 */

const FILES: WorkspaceEntryView[] = [
  { path: "notulen", bytes: 0, kind: "dir" },
  { path: "notulen/2026-11.md", bytes: 2048, kind: "file" },
  { path: "omzet.csv", bytes: 120, kind: "file" },
];

const PREVIEW: WorkspacePreview = {
  path: "omzet.csv",
  text: "maand,bedrag\njan,3\n",
  mime: "text/csv",
};

const download = (path: string): string => `data:text/csv;charset=utf-8,${encodeURIComponent(path)}`;

function render(overrides: Partial<Parameters<typeof WorkspacePanelView>[0]> = {}): string {
  return renderToStaticMarkup(
    <WorkspacePanelView files={FILES} onSelect={() => {}} downloadHref={download} {...overrides} />,
  );
}

describe("WorkspacePanelView", () => {
  it("says the library is empty, and says it is loading while a read is out", () => {
    expect(render({ files: [] })).toContain("No files yet.");
    expect(render({ files: [], busy: true })).toContain("Loading the workspace…");
  });

  it("lists files with a human size and folders as folders", () => {
    const html = render();

    expect(html).toContain("omzet.csv");
    expect(html).toContain("notulen/2026-11.md");
    expect(html).toContain("2 kB");
    expect(html).toContain("120 B");
    expect(html).toContain("folder");
    // A folder is not a button: clicking it would have nowhere to go.
    expect(html.match(/aria-label="Open /g)?.length).toBe(2);
    expect(html).toContain('aria-label="Open omzet.csv"');
  });

  it("previews text read-only when the parent offers no save", () => {
    const html = render({ selected: PREVIEW });

    expect(html).toContain("maand,bedrag");
    expect(html).toContain("text/csv");
    expect(html).toContain("<pre class=\"panel__code\">");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain(">Save<");
  });

  it("offers a download link with the href and name it was given", () => {
    const html = render({ selected: PREVIEW });

    expect(html).toContain("<a class=\"panel__link\"");
    expect(html).toContain(`href="${download("omzet.csv").replace(/&/gu, "&amp;")}"`);
    expect(html).toContain('download="omzet.csv"');
    expect(html).toContain("Download omzet.csv");
  });

  it("renders no link when the parent has no target for the file", () => {
    const html = render({ selected: PREVIEW, downloadHref: () => null });

    expect(html).not.toContain("Download omzet.csv");
    expect(html).not.toContain("panel__link");
  });

  it("shows an editor only when a save path exists", () => {
    const html = render({ selected: PREVIEW, onSave: () => {} });

    expect(html).toContain("<textarea");
    expect(html).toContain('aria-label="Edit omzet.csv"');
    expect(html).toContain(">Save<");
  });

  it("says a binary file is binary instead of printing mojibake", () => {
    const html = render({ selected: { path: "plaat.png", text: "\u0000PNG", mime: "image/png", binary: true } });

    expect(html).toContain("Binary file — download it to open.");
    expect(html).not.toContain("<pre");
  });

  it("says when a preview stopped at the size cap", () => {
    const html = render({ selected: { ...PREVIEW, truncated: true } });

    expect(html).toContain("Preview stopped at the size cap.");
  });

  it("shows the parent's status line, e.g. a refusal", () => {
    const html = render({ status: "outside the workspace" });

    expect(html).toContain("outside the workspace");
    expect(html).toContain("panel__status");
  });

  it("keeps the search box but filters nothing while typing is unavailable", () => {
    expect(render()).toContain("Search files");
  });
});

describe("WorkspaceHost", () => {
  it("frames the explorer with both roots and one honest summary line", () => {
    const nodes = [
      {
        node: "pc",
        name: "pc",
        folders: [
          { root: "workspace" as const, entries: [{ path: "lokaal.md", kind: "file" as const, bytes: 4, status: "local" as const }] },
          {
            root: "synced" as const,
            entries: [
              { path: "notulen", kind: "dir" as const, bytes: 0, status: "synced" as const },
              { path: "notulen/a.md", kind: "file" as const, bytes: 4, status: "synced" as const },
              { path: "b.md", kind: "file" as const, bytes: 4, status: "conflict" as const },
              { path: "b.md.conflict-pc-1", kind: "file" as const, bytes: 4, status: "conflict" as const },
            ],
          },
        ],
      },
    ];

    const html = renderToStaticMarkup(
      <WorkspaceHost nodes={nodes} self="pc" loadPreview={() => ({ path: "", text: "" })} />,
    );

    // A conflict copy is not a fourth file; the base path carries the conflict.
    expect(html).toContain("3 files · 1 synced · 1 conflicts");
    expect(html).toContain("workspace/synced");
    expect(html).toContain("this device");
    expect(html).toContain("explorer__chip--conflict");
  });

  it("keeps the legacy flat props working through the same export", () => {
    const html = renderToStaticMarkup(<WorkspacePanel files={FILES} onSelect={() => {}} />);

    expect(html).toContain("Search files");
    expect(html).toContain("omzet.csv");
  });
});
