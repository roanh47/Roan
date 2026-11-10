import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHECKLISTS,
  buildChecklist,
  type ChecklistStep,
  type ReleasePlatform,
} from "./release-checklist.js";

/**
 * These tests live next to the source (and not in tests/) because tsconfig
 * only includes "src" and the test run executes compiled dist/**\/*.test.js.
 */

const PLATFORMS: readonly ReleasePlatform[] = ["windows", "macos", "linux"];

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Indexes resolved steps by id so tests do not poke at array positions. */
function byId(steps: readonly ChecklistStep[]): Map<string, ChecklistStep> {
  return new Map(steps.map((step) => [step.id, step]));
}

/** Every step id of one platform, in checklist order. */
function idsOf(platform: ReleasePlatform): string[] {
  return CHECKLISTS[platform].map((step) => step.id);
}

describe("CHECKLISTS", () => {
  it("describes every platform with at least one step", () => {
    for (const platform of PLATFORMS) {
      assert.ok(
        CHECKLISTS[platform].length > 0,
        `expected a non-empty checklist for ${platform}`,
      );
    }
  });

  it("uses unique lowercase kebab-case ids per platform", () => {
    for (const platform of PLATFORMS) {
      const ids = idsOf(platform);
      for (const id of ids) {
        assert.match(id, KEBAB_CASE, `${platform} id "${id}" is not kebab-case`);
      }
      assert.equal(new Set(ids).size, ids.length, `${platform} reuses a step id`);
    }
  });

  it("keeps step text free of trailing whitespace", () => {
    for (const platform of PLATFORMS) {
      for (const step of CHECKLISTS[platform]) {
        assert.ok(step.text.trim().length > 0, `${platform}/${step.id} has empty text`);
      }
    }
  });

  it("marks a signing step on every platform", () => {
    for (const platform of PLATFORMS) {
      assert.ok(
        idsOf(platform).some((id) => id.startsWith("sign-")),
        `expected ${platform} to have a sign- step`,
      );
    }
  });

  it("has no notarization step outside macOS", () => {
    for (const platform of ["windows", "linux"] as const) {
      const notarization = idsOf(platform).filter(
        (id) => id.startsWith("notarize-") || id.startsWith("staple-"),
      );
      assert.deepEqual(notarization, [], `${platform} cannot notarize`);
    }
  });
});

describe("buildChecklist", () => {
  it("reports every step open when no status is given", () => {
    for (const platform of PLATFORMS) {
      const checklist = buildChecklist(platform);

      assert.equal(checklist.platform, platform);
      assert.equal(checklist.steps.length, CHECKLISTS[platform].length);
      assert.ok(checklist.steps.every((step) => step.open));
      assert.equal(checklist.openCount, checklist.steps.length);
    }
  });

  it("preserves id, text and manual from the checklist data", () => {
    const checklist = buildChecklist("windows");
    const steps = byId(checklist.steps);

    for (const source of CHECKLISTS.windows) {
      const resolved = steps.get(source.id);
      assert.ok(resolved !== undefined, `missing step ${source.id}`);
      assert.deepEqual(
        { id: resolved.id, text: resolved.text, manual: resolved.manual },
        { id: source.id, text: source.text, manual: source.manual },
      );
    }

    assert.equal(steps.get("build-installer")?.manual, false);
    assert.equal(steps.get("upload-artifacts")?.manual, true);
  });

  it("closes the signing step when signed is true", () => {
    const checklist = buildChecklist("windows", { signed: true });
    const steps = byId(checklist.steps);

    assert.equal(steps.get("sign-binaries")?.open, false);
    assert.equal(steps.get("build-installer")?.open, true);
    assert.equal(steps.get("smoke-test")?.open, true);
    assert.equal(steps.get("upload-artifacts")?.open, true);
    assert.equal(checklist.openCount, checklist.steps.length - 1);
  });

  it("does not close notarization steps when only signed is true", () => {
    const steps = byId(buildChecklist("macos", { signed: true }).steps);

    assert.equal(steps.get("sign-app")?.open, false);
    assert.equal(steps.get("notarize-dmg")?.open, true);
    assert.equal(steps.get("staple-ticket")?.open, true);
  });

  it("closes notarization and stapling when notarized is true", () => {
    const steps = byId(buildChecklist("macos", { notarized: true }).steps);

    assert.equal(steps.get("notarize-dmg")?.open, false);
    assert.equal(steps.get("staple-ticket")?.open, false);
    assert.equal(steps.get("sign-app")?.open, true, "notarization is not a signature");
  });

  it("leaves every step closed only for a fully signed and notarized macOS release", () => {
    const checklist = buildChecklist("macos", { signed: true, notarized: true });
    const open = checklist.steps.filter((step) => step.open).map((step) => step.id);

    assert.deepEqual(open, ["bump-version", "build-universal", "upload-artifacts"]);
    assert.equal(checklist.openCount, open.length);
  });

  it("treats explicit false as not satisfied", () => {
    const checklist = buildChecklist("linux", { signed: false, notarized: false });
    const steps = byId(checklist.steps);

    assert.equal(steps.get("sign-packages")?.open, true);
    assert.equal(checklist.openCount, checklist.steps.length);
  });

  it("returns ids in checklist order", () => {
    const checklist = buildChecklist("linux");
    assert.deepEqual(
      checklist.steps.map((step) => step.id),
      idsOf("linux"),
    );
  });

  it("rejects an unknown platform and quotes the value", () => {
    const unknown = "beos" as unknown as ReleasePlatform;

    assert.throws(
      () => buildChecklist(unknown),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(
          error.message.includes("beos"),
          `expected the message to quote "beos", got: ${error.message}`,
        );
        return true;
      },
    );
  });
});
