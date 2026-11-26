/**
 * Whether the conversation rail is open on a wide screen.
 *
 * The rail is always there on a phone as a drawer; from 1024 px up it is a
 * real column that the user can keep open or fold away. The choice is a
 * preference, so it outlives the window and the reload: it lives in
 * localStorage under one key, and an unwritten (or unreadable) key means
 * open — a wide window should not start with its history hidden.
 */

export const RAIL_EXPANDED_KEY = "roan.rail.expanded";

/** The one thing this module needs from a storage; localStorage fits. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readRailExpanded(storage: StorageLike | null): boolean {
  if (storage === null) return true;
  try {
    return storage.getItem(RAIL_EXPANDED_KEY) !== "0";
  } catch {
    // Private mode, a full quota, a throwing shim: open is the safe default.
    return true;
  }
}

export function writeRailExpanded(storage: StorageLike | null, expanded: boolean): void {
  if (storage === null) return;
  try {
    storage.setItem(RAIL_EXPANDED_KEY, expanded ? "1" : "0");
  } catch {
    // The rail still opens for this session; only the memory is lost.
  }
}

/** localStorage when the host has one, null when it does not (SSR, tests). */
export function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
