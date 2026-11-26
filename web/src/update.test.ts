import { describe, expect, test } from "vitest";
import { checkForUpdate, describeUpdateCheck, runsInApp, type UpdateCheck } from "./update.js";

/**
 * The card's honesty rests on these four outcomes. In particular: a check that
 * throws must become `unreachable`, never `newest`, and the two sentences must
 * stay distinct. `inApp`/`check` are injected so no Tauri window and no real
 * feed are involved.
 */

describe("runsInApp", () => {
  test("is false outside a Tauri window", () => {
    expect(runsInApp()).toBe(false);
  });
});

describe("checkForUpdate", () => {
  test("reports the browser instead of pretending it can check", async () => {
    let called = false;
    const result = await checkForUpdate({
      inApp: false,
      check: async () => {
        called = true;
        return null;
      },
    });

    expect(result).toEqual({ status: "browser" });
    expect(called).toBe(false);
  });

  test("reports the newest version when the feed returns no update", async () => {
    const result = await checkForUpdate({ inApp: true, check: async () => null });

    expect(result).toEqual({ status: "newest" });
  });

  test("reports an available update with its notes", async () => {
    const result = await checkForUpdate({
      inApp: true,
      check: async () => ({ version: "0.0.24-test", body: "Local feed round", date: "2026-11-26" }),
    });

    expect(result).toEqual({
      status: "available",
      update: { version: "0.0.24-test", notes: "Local feed round", date: "2026-11-26" },
    });
  });

  test("reports an unreachable feed instead of an empty answer", async () => {
    const result = await checkForUpdate({
      inApp: true,
      check: async () => {
        throw new Error("could not reach the update feed at https://updates.example.invalid/latest.json");
      },
    });

    expect(result.status).toBe("unreachable");
    if (result.status !== "unreachable") return;
    expect(result.reason).toContain("could not reach the update feed");
  });
});

describe("describeUpdateCheck", () => {
  test("keeps 'newest' and 'unreachable' separate sentences", () => {
    const newest = describeUpdateCheck({ status: "newest" });
    const unreachable = describeUpdateCheck({ status: "unreachable", reason: "HTTP 503" });

    expect(newest).toBe("You are on the newest version.");
    expect(unreachable).toContain("Could not reach the update feed");
    expect(unreachable).toContain("HTTP 503");
    expect(unreachable).not.toBe(newest);
  });

  test("names the version an available update would install", () => {
    const check: UpdateCheck = { status: "available", update: { version: "0.0.24-test" } };

    expect(describeUpdateCheck(check)).toBe("There is an update: 0.0.24-test");
  });

  test("has nothing to say in the browser", () => {
    expect(describeUpdateCheck({ status: "browser" })).toBeNull();
  });
});
