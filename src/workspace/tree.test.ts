import assert from "node:assert/strict";
import { test } from "node:test";

import { buildTree, summariseTree, type TreeChainEvent, type TreeEntry, type TreeFolder } from "./tree.js";

/**
 * The tree is pure arithmetic over three facts — what is on this disk in each
 * root, what the chain says, and who "this device" is. Every test hands in
 * exactly those and reads the statuses back; no disk, no chain store, no clock.
 */

const SELF = "pc";

function chain(seq: number, data: Record<string, unknown>, node = SELF): TreeChainEvent {
  return { node, seq, ts: seq, type: "workspace", data };
}

function tree(overrides: Partial<Parameters<typeof buildTree>[0]> = {}) {
  return buildTree({ workspace: [], synced: [], chainEvents: [], self: SELF, ...overrides });
}

function folder(nodes: ReturnType<typeof tree>["nodes"], node: string, root: "workspace" | "synced"): TreeFolder {
  const found = nodes.find((entry) => entry.node === node)?.folders.find((entry) => entry.root === root);
  assert.ok(found !== undefined, `no ${root} folder for ${node}`);
  return found;
}

function row(entries: readonly TreeEntry[], path: string): TreeEntry {
  const found = entries.find((entry) => entry.path === path);
  assert.ok(found !== undefined, `no row for ${path}`);
  return found;
}

test("all five sync states come out of one tree", () => {
  const built = tree({
    workspace: [
      { path: "todo.txt", kind: "file", bytes: 2 },
      { path: "ideas.md", kind: "file", bytes: 8 },
      { path: "ideas.md.conflict-pc-3", kind: "file", bytes: 8 },
    ],
    synced: [
      { path: "synced-notes.md", kind: "file", bytes: 5, hash: "h1" },
      { path: "edited.md", kind: "file", bytes: 7, hash: "h-new" },
      { path: "draft.txt", kind: "file", bytes: 3, hash: "d2" },
      { path: "notes.md", kind: "file", bytes: 11, hash: "h9" },
      { path: "notes.md.conflict-phone-4", kind: "file", bytes: 12, hash: "h10" },
    ],
    chainEvents: [
      chain(1, { op: "put", path: "synced-notes.md", content: "hallo", hash: "h1" }),
      chain(2, { op: "put", path: "edited.md", content: "older", hash: "h-old" }),
      chain(3, { op: "put", path: "notes.md", content: "mijn", hash: "h9" }),
      chain(4, { op: "put", path: "from-phone.csv", blobHash: "ph1", bytes: 40 }, "phone"),
    ],
  });

  const self = built.nodes[0];
  assert.equal(self?.node, SELF);
  const synced = folder(built.nodes, SELF, "synced");
  const workspace = folder(built.nodes, SELF, "workspace");

  assert.equal(row(synced.entries, "synced-notes.md").status, "synced");
  assert.equal(row(synced.entries, "draft.txt").status, "local");
  assert.equal(row(synced.entries, "edited.md").status, "pending");
  assert.equal(row(workspace.entries, "todo.txt").status, "local");
  assert.equal(row(workspace.entries, "ideas.md").status, "conflict");
  assert.equal(row(synced.entries, "notes.md").status, "conflict");
  // Conflict copies keep their real bytes and are visible, not hidden.
  assert.equal(row(synced.entries, "notes.md.conflict-phone-4").status, "conflict");
  assert.equal(row(synced.entries, "from-phone.csv").status, "remote");
  assert.equal(row(synced.entries, "from-phone.csv").bytes, 40);
});

test("a conflict sibling marks the base path, and only that path", () => {
  const built = tree({
    synced: [
      { path: "plan.md", kind: "file", bytes: 4, hash: "a" },
      { path: "plan.md.conflict-laptop-7", kind: "file", bytes: 5, hash: "b" },
      { path: "other.md", kind: "file", bytes: 4, hash: "c" },
    ],
    chainEvents: [
      chain(1, { op: "put", path: "plan.md", hash: "a" }),
      chain(2, { op: "put", path: "other.md", hash: "c" }),
    ],
  });

  const entries = folder(built.nodes, SELF, "synced").entries;
  const base = row(entries, "plan.md");
  assert.equal(base.status, "conflict");
  assert.equal(row(entries, "plan.md.conflict-laptop-7").status, "conflict");
  assert.equal(row(entries, "other.md").status, "synced");
});

test("remote-only files appear from the chain, attributed to their node", () => {
  const built = tree({
    chainEvents: [
      chain(1, { op: "put", path: "report.md", content: "x", hash: "r1" }, "phone"),
      chain(2, { op: "put", path: "photos/kust.jpg", blobHash: "b1", bytes: 900 }, "laptop"),
      chain(3, { op: "put", path: "report.md", content: "y", hash: "r2" }, "phone"),
    ],
  });

  const selfSynced = folder(built.nodes, SELF, "synced");
  assert.equal(row(selfSynced.entries, "report.md").status, "remote");
  assert.equal(row(selfSynced.entries, "photos/kust.jpg").status, "remote");
  // A directory the disk does not have is implied so the explorer can open it.
  assert.equal(row(selfSynced.entries, "photos").kind, "dir");
  assert.equal(row(selfSynced.entries, "photos").status, "remote");

  assert.deepEqual(
    built.nodes.map((node) => node.node),
    ["pc", "laptop", "phone"],
  );
  const phone = folder(built.nodes, "phone", "synced");
  assert.equal(row(phone.entries, "report.md").status, "remote");
  assert.equal(row(phone.entries, "report.md").bytes, 0);
  // Another node's workspace is never published; it has no folder to show.
  assert.equal(built.nodes.find((node) => node.node === "phone")?.folders.length, 1);
});

test("a node's file that already synced here is synced, not remote", () => {
  const built = tree({
    synced: [{ path: "gedeeld.md", kind: "file", bytes: 6, hash: "same" }],
    chainEvents: [chain(1, { op: "put", path: "gedeeld.md", content: "gedeel", hash: "same" }, "phone")],
  });

  const phone = folder(built.nodes, "phone", "synced");
  assert.equal(row(phone.entries, "gedeeld.md").status, "synced");
});

test("ordering is by path, self first, and both roots in a fixed order", () => {
  const built = tree({
    workspace: [
      { path: "b.txt", kind: "file", bytes: 1 },
      { path: "a", kind: "dir" },
      { path: "a/z.txt", kind: "file", bytes: 1 },
    ],
    synced: [
      { path: "z.md", kind: "file", bytes: 1, hash: "z" },
      { path: "m.md", kind: "file", bytes: 1, hash: "m" },
      { path: "m/inner.md", kind: "file", bytes: 1, hash: "i" },
    ],
    chainEvents: [chain(1, { op: "put", path: "x.md", hash: "x" }, "zeta"), chain(2, { op: "put", path: "y.md", hash: "y" }, "alpha")],
  });

  assert.deepEqual(
    built.nodes.map((node) => node.node),
    ["pc", "alpha", "zeta"],
  );
  assert.deepEqual(
    built.nodes[0]?.folders.map((entry) => entry.root),
    ["workspace", "synced"],
  );
  assert.deepEqual(
    folder(built.nodes, SELF, "workspace").entries.map((entry) => entry.path),
    ["a", "a/z.txt", "b.txt"],
  );
  assert.deepEqual(
    folder(built.nodes, SELF, "synced").entries.map((entry) => entry.path),
    ["m", "m.md", "m/inner.md", "x.md", "y.md", "z.md"],
  );
});

test("dotfiles and escaping paths are skipped at every level", () => {
  const built = tree({
    workspace: [
      { path: ".env", kind: "file", bytes: 3 },
      { path: ".git", kind: "dir" },
      { path: "../outside.txt", kind: "file", bytes: 3 },
      { path: "notes/.cache", kind: "file", bytes: 3 },
      { path: "notes/kept.md", kind: "file", bytes: 3 },
    ],
    synced: [{ path: "/etc/passwd", kind: "file", bytes: 3 }],
    chainEvents: [chain(1, { op: "put", path: ".hidden", hash: "h" }), chain(2, { op: "put", path: "../up.md", hash: "u" })],
  });

  assert.deepEqual(
    folder(built.nodes, SELF, "workspace").entries.map((entry) => entry.path),
    ["notes", "notes/kept.md"],
  );
  assert.deepEqual(folder(built.nodes, SELF, "synced").entries, []);
});

test("a delete in the chain makes the local copy local again, and hides the remote row", () => {
  const built = tree({
    synced: [{ path: "weg.md", kind: "file", bytes: 4, hash: "w1" }],
    chainEvents: [
      chain(1, { op: "put", path: "weg.md", hash: "w1" }),
      chain(2, { op: "delete", path: "weg.md" }),
    ],
  });

  assert.equal(row(folder(built.nodes, SELF, "synced").entries, "weg.md").status, "local");
  const phone = tree({
    chainEvents: [chain(1, { op: "put", path: "tijdelijk.md", hash: "t" }, "phone"), chain(2, { op: "delete", path: "tijdelijk.md" }, "phone")],
  });
  assert.equal(folder(phone.nodes, SELF, "synced").entries.some((entry) => entry.path === "tijdelijk.md"), false);
});

test("a folder wears the most notable status inside it", () => {
  const built = tree({
    synced: [
      { path: "werk/klaar.md", kind: "file", bytes: 1, hash: "k" },
      { path: "werk/botsing.md", kind: "file", bytes: 1, hash: "b1" },
      { path: "werk/botsing.md.conflict-pc-1", kind: "file", bytes: 1, hash: "b2" },
      { path: "leeg", kind: "dir" },
    ],
    chainEvents: [chain(1, { op: "put", path: "werk/klaar.md", hash: "k" })],
  });

  const entries = folder(built.nodes, SELF, "synced").entries;
  assert.equal(row(entries, "werk").kind, "dir");
  assert.equal(row(entries, "werk").status, "conflict");
  assert.equal(row(entries, "leeg").kind, "dir");
  assert.equal(row(entries, "leeg").status, "local");
});

test("without a hash the listing compares sizes, and says nothing it cannot know", () => {
  const built = tree({
    synced: [
      { path: "gelijk.md", kind: "file", bytes: 5 },
      { path: "anders.md", kind: "file", bytes: 5 },
    ],
    chainEvents: [
      chain(1, { op: "put", path: "gelijk.md", hash: "g", bytes: 5 }),
      chain(2, { op: "put", path: "anders.md", hash: "a", bytes: 6 }),
    ],
  });

  const entries = folder(built.nodes, SELF, "synced").entries;
  assert.equal(row(entries, "gelijk.md").status, "synced");
  assert.equal(row(entries, "anders.md").status, "pending");
});

test("the summary counts files once and conflicts at their base", () => {
  const built = tree({
    synced: [
      { path: "een.md", kind: "file", bytes: 1, hash: "1" },
      { path: "twee.md", kind: "file", bytes: 1, hash: "2" },
      { path: "twee.md.conflict-pc-9", kind: "file", bytes: 1, hash: "3" },
      { path: "drie.md", kind: "file", bytes: 1, hash: "4" },
      { path: "map", kind: "dir" },
    ],
    chainEvents: [chain(1, { op: "put", path: "een.md", hash: "1" })],
  });

  assert.deepEqual(summariseTree(folder(built.nodes, SELF, "synced").entries), {
    files: 3,
    synced: 1,
    conflicts: 1,
  });
});
