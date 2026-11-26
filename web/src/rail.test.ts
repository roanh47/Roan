/**
 * The wide-screen rail is a preference: it starts open, folds away on a tap,
 * and remembers that across a reload. Checked through a storage double, so the
 * test is about what a reader gets back, not about localStorage internals.
 */

import { describe, expect, it } from "vitest";

import { RAIL_EXPANDED_KEY, readRailExpanded, writeRailExpanded } from "./rail.js";
import type { StorageLike } from "./rail.js";

function memory(initial: Record<string, string> = {}): StorageLike & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

/** A storage that behaves like a browser in private mode. */
const throwing: StorageLike = {
  getItem: () => {
    throw new Error("denied");
  },
  setItem: () => {
    throw new Error("denied");
  },
};

describe("the rail's remembered width", () => {
  it("starts open when nothing was ever chosen", () => {
    expect(readRailExpanded(memory())).toBe(true);
    expect(readRailExpanded(null)).toBe(true);
  });

  it("remembers a fold and an opening by the same key", () => {
    const storage = memory();
    writeRailExpanded(storage, false);
    expect(storage.values.get(RAIL_EXPANDED_KEY)).toBe("0");
    expect(readRailExpanded(storage)).toBe(false);

    writeRailExpanded(storage, true);
    expect(storage.values.get(RAIL_EXPANDED_KEY)).toBe("1");
    expect(readRailExpanded(storage)).toBe(true);
  });

  it("reads a stored fold back as folded", () => {
    expect(readRailExpanded(memory({ [RAIL_EXPANDED_KEY]: "0" }))).toBe(false);
    expect(readRailExpanded(memory({ [RAIL_EXPANDED_KEY]: "1" }))).toBe(true);
  });

  it("survives a storage that refuses to answer", () => {
    expect(readRailExpanded(throwing)).toBe(true);
    expect(() => writeRailExpanded(throwing, false)).not.toThrow();
  });
});
