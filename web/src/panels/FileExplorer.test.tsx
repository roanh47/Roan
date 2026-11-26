// @vitest-environment jsdom

/**
 * The explorer in a real (if small) DOM: clicking a folder walks into it, the
 * breadcrumb walks back, a file opens the preview the loader hands over, and
 * the node sections open one at a time. Keyboard navigation is exercised with
 * real key events on the container, because that is the thing a person presses.
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { FileExplorer, type ExplorerNodeView, type FileExplorerProps, type PreviewLoader } from "./FileExplorer.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NODES: ExplorerNodeView[] = [
  {
    node: "pc",
    name: "pc",
    folders: [
      {
        root: "workspace",
        entries: [{ path: "lokaal.md", kind: "file", bytes: 10, status: "local" }],
      },
      {
        root: "synced",
        entries: [
          { path: "notulen", kind: "dir", bytes: 0, status: "synced" },
          { path: "notulen/2026-11.md", kind: "file", bytes: 2048, status: "synced" },
          { path: "kluis.md", kind: "file", bytes: 12, status: "conflict" },
          { path: "omzet.csv", kind: "file", bytes: 120, status: "pending" },
          { path: "van-phone.md", kind: "file", bytes: 30, status: "remote" },
        ],
      },
    ],
  },
  {
    node: "phone",
    name: "phone",
    folders: [
      { root: "synced", entries: [{ path: "van-phone.md", kind: "file", bytes: 30, status: "remote" }] },
    ],
  },
];

let container: HTMLDivElement;
let root: Root;
let loadPreview: Mock<PreviewLoader>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  loadPreview = vi.fn<PreviewLoader>(async ({ path }) => ({
    path,
    text: `inhoud van ${path}`,
    mime: "text/markdown",
  }));
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
});

async function mount(props: Partial<FileExplorerProps> = {}): Promise<void> {
  await act(async () => {
    root.render(<FileExplorer nodes={NODES} self="pc" loadPreview={loadPreview} {...props} />);
  });
}

function byLabel(label: string): HTMLButtonElement {
  const found = container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
  if (found === null) throw new Error(`no button labelled ${label}`);
  return found;
}

async function press(element: HTMLElement, init: KeyboardEventInit): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new window.KeyboardEvent("keydown", { bubbles: true, ...init }));
  });
  // The handler may start a preview load; let its promise settle.
  await act(async () => undefined);
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.click();
  });
  await act(async () => undefined);
}

function text(): string {
  return container.textContent ?? "";
}

describe("FileExplorer", () => {
  it("lists a folder's rows with a size and a status chip for each state", async () => {
    await mount();

    expect(text()).toContain("notulen/");
    expect(text()).toContain("omzet.csv");
    expect(text()).toContain("120 B");
    expect(text()).toContain("12 B");

    const chips = [...container.querySelectorAll(".explorer__chip")].map((chip) => chip.textContent);
    expect(chips).toEqual(["synced", "conflict", "pending", "remote"]);
    expect(container.querySelector(".explorer__chip--synced")).not.toBeNull();
    expect(container.querySelector(".explorer__chip--conflict")).not.toBeNull();
    expect(container.querySelector(".explorer__chip--pending")).not.toBeNull();
    expect(container.querySelector(".explorer__chip--remote")).not.toBeNull();
  });

  it("opens a folder and walks back up the breadcrumb", async () => {
    await mount();

    await click(byLabel("Open folder notulen"));

    expect(text()).toContain("2026-11.md");
    expect(text()).toContain("2 kB");
    expect(text()).not.toContain("omzet.csv");
    const crumb = container.querySelector(".explorer__crumb");
    expect(crumb?.textContent).toContain("notulen");

    const rootCrumb = [...container.querySelectorAll<HTMLButtonElement>(".explorer__crumbstep")].find(
      (button) => button.textContent === "workspace/synced",
    );
    expect(rootCrumb).toBeDefined();
    await click(rootCrumb as HTMLButtonElement);

    expect(text()).toContain("omzet.csv");
    expect(text()).not.toContain("2026-11.md");
  });

  it("switches roots and shows the other root's folder", async () => {
    await mount();

    const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs.map((tab) => tab.textContent?.replace(/\d+$/u, ""))).toEqual(["workspace", "workspace/synced"]);

    const workspaceTab = tabs[0];
    expect(workspaceTab).toBeDefined();
    await click(workspaceTab as HTMLButtonElement);

    expect(text()).toContain("lokaal.md");
    expect(text()).toContain("local");
    expect(text()).not.toContain("omzet.csv");
  });

  it("opens a preview with the text the loader returns", async () => {
    await mount();

    await click(byLabel("Open omzet.csv"));

    expect(loadPreview).toHaveBeenCalledWith({ node: "pc", root: "synced", path: "omzet.csv" });
    expect(container.querySelector(".explorer__pre")?.textContent).toBe("inhoud van omzet.csv");
    expect(text()).toContain("text/markdown");
  });

  it("switches node sections, and only the open one shows rows", async () => {
    const onNodeChange = vi.fn();
    await mount({ onNodeChange });

    expect(byLabel("Open phone")).toBeDefined();
    await click(byLabel("Open phone"));

    expect(onNodeChange).toHaveBeenCalledWith("phone");
    expect(container.querySelectorAll(".explorer__node--open").length).toBe(1);
    // pc's unique file is gone with its section; phone's own row is shown.
    expect(text()).not.toContain("omzet.csv");
    expect(text()).toContain("van-phone.md");

    // Clicking the open header collapses it without selecting another node.
    await click(byLabel("Collapse phone"));
    expect(text()).not.toContain("van-phone.md");
  });

  it("moves the selection with the arrow keys and opens it with Enter", async () => {
    await mount();
    const rows = container.querySelector<HTMLDivElement>(".explorer__rows");
    expect(rows).not.toBeNull();
    const list = rows as HTMLDivElement;

    expect(list.querySelector(".explorer__row--cursor")?.textContent).toContain("notulen/");

    await press(list, { key: "ArrowDown" });
    await press(list, { key: "ArrowDown" });
    expect(list.querySelector(".explorer__row--cursor")?.textContent).toContain("omzet.csv");

    await press(list, { key: "Enter" });
    expect(loadPreview).toHaveBeenCalledWith({ node: "pc", root: "synced", path: "omzet.csv" });
    expect(text()).toContain("inhoud van omzet.csv");

    await press(list, { key: "ArrowUp" });
    await press(list, { key: "ArrowUp" });
    await press(list, { key: "ArrowUp" });
    expect(list.querySelector(".explorer__row--cursor")?.textContent).toContain("notulen/");
    await press(list, { key: "Enter" });
    expect(text()).toContain("2026-11.md");
  });

  it("says an unavailable root is unavailable instead of pretending it is empty", async () => {
    await mount({
      nodes: [
        {
          node: "pc",
          folders: [{ root: "workspace", entries: [], unavailable: true }],
        },
      ],
    });

    expect(text()).toContain("This daemon does not list this root yet.");
  });
});
