import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createComputerActions,
  type ComputerDriver,
  type DriverAvailability,
  type DriverOutcome,
  type Screenshot,
  type ScreenshotOutcome,
} from "./actions.js";
import { createGrantStore } from "./grant.js";

/**
 * Rules under test: the grant is checked first, coordinates must be finite
 * integers on the granted screen, and the wrapper is thin — the driver sees
 * exactly the intended call, or none at all.
 *
 * The driver here is a recorder. It never touches a real input API, so a green
 * run cannot have typed into anybody's window.
 */

const SESSION = "session-1";
const SCREEN = { width: 1920, height: 1080 } as const;
const IMAGE: Screenshot = { mimeType: "image/png", base64: "aW1n" };

type Call =
  | { readonly kind: "screenshot" }
  | { readonly kind: "move"; readonly x: number; readonly y: number }
  | { readonly kind: "click"; readonly x: number; readonly y: number }
  | { readonly kind: "type"; readonly text: string }
  | { readonly kind: "key"; readonly combo: string };

interface Recorder {
  readonly driver: ComputerDriver;
  readonly calls: readonly Call[];
  /** Force later outcomes, to test how driver failures are reported. */
  failWith(outcome: DriverOutcome): void;
  setAvailability(availability: DriverAvailability): void;
}

function recorder(initial: DriverAvailability = { available: true }): Recorder {
  const calls: Call[] = [];
  let availability = initial;
  let failure: DriverOutcome | null = null;

  const outcome = (): DriverOutcome => failure ?? { ok: true };

  return {
    calls,
    failWith(next) {
      failure = next;
    },
    setAvailability(next) {
      availability = next;
    },
    driver: {
      name: "recorder",
      available: () => availability,
      async screenshot(): Promise<ScreenshotOutcome> {
        calls.push({ kind: "screenshot" });
        if (failure !== null && !failure.ok) return failure;
        return { ok: true, screenshot: IMAGE };
      },
      async move(x, y) {
        calls.push({ kind: "move", x, y });
        return outcome();
      },
      async click(x, y) {
        calls.push({ kind: "click", x, y });
        return outcome();
      },
      async type(text) {
        calls.push({ kind: "type", text });
        return outcome();
      },
      async key(combo) {
        calls.push({ kind: "key", combo });
        return outcome();
      },
    },
  };
}

function gated(rec: Recorder, grants = createGrantStore({ now: () => 0 })) {
  return {
    grants,
    actions: createComputerActions({
      sessionId: SESSION,
      driver: rec.driver,
      screen: SCREEN,
      grants,
    }),
  };
}

describe("computer actions: the grant gates everything", () => {
  it("refuses each action without a grant and never reaches the driver", async () => {
    const rec = recorder();
    const { actions } = gated(rec);

    const results = [
      await actions.screenshot(),
      await actions.moveTo(10, 10),
      await actions.click(10, 10),
      await actions.type("hello"),
      await actions.key("ctrl+c"),
    ];

    for (const result of results) {
      assert.equal(result.ok, false);
      if (result.ok) assert.fail("unreachable");
      assert.equal(result.reason, "not-granted");
      assert.match(result.detail, /grant/);
    }
    assert.deepEqual(rec.calls, []);
  });

  it("refuses after the grant expires, with grant-expired", async () => {
    let now = 1_000;
    const grants = createGrantStore({ now: () => now });
    const rec = recorder();
    const { actions } = gated(rec, grants);

    grants.grantSession(SESSION, { ttlMs: 500 });
    now += 500;

    const result = await actions.click(5, 5);

    assert.equal(result.ok, false);
    if (result.ok) assert.fail("unreachable");
    assert.equal(result.reason, "grant-expired");
    assert.deepEqual(rec.calls, []);
  });

  it("refuses after revoke, with grant-revoked", async () => {
    const grants = createGrantStore({ now: () => 0 });
    const rec = recorder();
    const { actions } = gated(rec, grants);

    grants.grantSession(SESSION);
    grants.revokeSession(SESSION);

    const result = await actions.type("hello");

    assert.equal(result.ok, false);
    if (result.ok) assert.fail("unreachable");
    assert.equal(result.reason, "grant-revoked");
    assert.deepEqual(rec.calls, []);
  });

  it("checks the grant before coordinates, so a bad request leaks nothing", async () => {
    const rec = recorder();
    const { actions } = gated(rec);

    const result = await actions.click(Number.NaN, -1);

    assert.equal(result.ok, false);
    if (result.ok) assert.fail("unreachable");
    assert.equal(result.reason, "not-granted");
    assert.deepEqual(rec.calls, []);
  });

  it("lets the actions through once the session is granted", async () => {
    const grants = createGrantStore({ now: () => 0 });
    const rec = recorder();
    const { actions } = gated(rec, grants);
    grants.grantSession(SESSION);

    const shot = await actions.screenshot();
    const moved = await actions.moveTo(3, 4);
    const clicked = await actions.click(5, 6);
    const typed = await actions.type("hi");
    const pressed = await actions.key("ctrl+shift+t");

    assert.deepEqual([shot.ok, moved.ok, clicked.ok, typed.ok, pressed.ok], [
      true,
      true,
      true,
      true,
      true,
    ]);
    assert.deepEqual(shot, { ok: true, screenshot: IMAGE });
    assert.deepEqual(rec.calls, [
      { kind: "screenshot" },
      { kind: "move", x: 3, y: 4 },
      { kind: "click", x: 5, y: 6 },
      { kind: "type", text: "hi" },
      { kind: "key", combo: "ctrl+shift+t" },
    ]);
  });
});

describe("computer actions: coordinate validation", () => {
  function grantedRecorder(): { rec: Recorder; actions: ReturnType<typeof gated>["actions"] } {
    const grants = createGrantStore({ now: () => 0 });
    const rec = recorder();
    const { actions } = gated(rec, grants);
    grants.grantSession(SESSION);
    return { rec, actions };
  }

  it("accepts the corners of the screen", async () => {
    const { rec, actions } = grantedRecorder();

    assert.equal((await actions.moveTo(0, 0)).ok, true);
    assert.equal((await actions.click(SCREEN.width - 1, SCREEN.height - 1)).ok, true);
    assert.deepEqual(rec.calls, [
      { kind: "move", x: 0, y: 0 },
      { kind: "click", x: 1919, y: 1079 },
    ]);
  });

  it("rejects a fractional coordinate instead of rounding it", async () => {
    const { rec, actions } = grantedRecorder();

    const result = await actions.moveTo(10.5, 20);

    assert.equal(result.ok, false);
    if (result.ok) assert.fail("unreachable");
    assert.equal(result.reason, "invalid-coordinates");
    assert.match(result.detail, /integer/);
    assert.deepEqual(rec.calls, []);
  });

  it("rejects non-finite coordinates", async () => {
    const { rec, actions } = grantedRecorder();

    for (const [x, y] of [
      [Number.NaN, 1],
      [1, Number.POSITIVE_INFINITY],
      [1, Number.NEGATIVE_INFINITY],
    ] as const) {
      const result = await actions.click(x, y);
      assert.equal(result.ok, false);
      if (result.ok) assert.fail("unreachable");
      assert.equal(result.reason, "invalid-coordinates");
    }
    assert.deepEqual(rec.calls, []);
  });

  it("rejects a negative coordinate", async () => {
    const { rec, actions } = grantedRecorder();

    const result = await actions.moveTo(-1, 0);

    assert.equal(result.ok, false);
    if (result.ok) assert.fail("unreachable");
    assert.equal(result.reason, "invalid-coordinates");
    assert.deepEqual(rec.calls, []);
  });

  it("rejects a coordinate on or past the screen edge, naming the bound", async () => {
    const { rec, actions } = grantedRecorder();

    const width = await actions.moveTo(SCREEN.width, 0);
    const height = await actions.click(0, SCREEN.height);

    for (const result of [width, height]) {
      assert.equal(result.ok, false);
      if (result.ok) assert.fail("unreachable");
      assert.equal(result.reason, "invalid-coordinates");
    }
    if (width.ok || height.ok) assert.fail("unreachable");
    assert.match(width.detail, /0\.\.1919/);
    assert.match(height.detail, /0\.\.1079/);
    assert.deepEqual(rec.calls, []);
  });

  it("refuses to build actions for a screen that is not a positive integer size", () => {
    const grants = createGrantStore({ now: () => 0 });
    grants.grantSession(SESSION);
    const rec = recorder();

    for (const screen of [
      { width: 0, height: 100 },
      { width: 100, height: -1 },
      { width: 100.5, height: 100 },
      { width: Number.NaN, height: 100 },
    ]) {
      assert.throws(
        () =>
          createComputerActions({
            sessionId: SESSION,
            driver: rec.driver,
            screen,
            grants,
          }),
        /positive integer/,
      );
    }
  });
});

describe("computer actions: text and key validation", () => {
  function grantedRecorder(): { rec: Recorder; actions: ReturnType<typeof gated>["actions"] } {
    const grants = createGrantStore({ now: () => 0 });
    const rec = recorder();
    const { actions } = gated(rec, grants);
    grants.grantSession(SESSION);
    return { rec, actions };
  }

  it("rejects empty text and a NUL byte", async () => {
    const { rec, actions } = grantedRecorder();

    const empty = await actions.type("");
    const nul = await actions.type("a\0b");

    assert.equal(empty.ok, false);
    assert.equal(nul.ok, false);
    if (empty.ok || nul.ok) assert.fail("unreachable");
    assert.equal(empty.reason, "invalid-text");
    assert.equal(nul.reason, "invalid-text");
    assert.deepEqual(rec.calls, []);
  });

  it("passes text that looks like a flag through unchanged", async () => {
    const { rec, actions } = grantedRecorder();

    const result = await actions.type("--not-a-flag");

    assert.equal(result.ok, true);
    assert.deepEqual(rec.calls, [{ kind: "type", text: "--not-a-flag" }]);
  });

  it("rejects a key combo that is not made of key names", async () => {
    const { rec, actions } = grantedRecorder();

    const results = [
      await actions.key(""),
      await actions.key("--delay"),
      await actions.key("ctrl++c"),
      await actions.key("ctrl+shift+alt+super+a+b+c"),
      await actions.key("ctrl c"),
    ];

    for (const result of results) {
      assert.equal(result.ok, false);
      if (result.ok) assert.fail("unreachable");
      assert.equal(result.reason, "invalid-key");
    }
    assert.deepEqual(rec.calls, []);
  });
});

describe("computer actions: driver availability and failures", () => {
  it("refuses with the driver's own reason when the platform cannot act", async () => {
    const grants = createGrantStore({ now: () => 0 });
    const rec = recorder({ available: false, reason: "neither ydotool nor xdotool is installed" });
    const { actions } = gated(rec, grants);
    grants.grantSession(SESSION);

    const result = await actions.moveTo(1, 1);

    assert.equal(result.ok, false);
    if (result.ok) assert.fail("unreachable");
    assert.equal(result.reason, "driver-unavailable");
    assert.match(result.detail, /ydotool/);
    assert.deepEqual(rec.calls, []);
  });

  it("reports a driver failure as driver-failed and keeps its detail", async () => {
    const grants = createGrantStore({ now: () => 0 });
    const rec = recorder();
    const { actions } = gated(rec, grants);
    grants.grantSession(SESSION);
    rec.failWith({ ok: false, reason: "failed", detail: "ydotoold is not running" });

    const result = await actions.click(1, 1);

    assert.equal(result.ok, false);
    if (result.ok) assert.fail("unreachable");
    assert.equal(result.reason, "driver-failed");
    assert.equal(result.detail, "ydotoold is not running");
  });

  it("reports an unsupported driver reason separately", async () => {
    const grants = createGrantStore({ now: () => 0 });
    const rec = recorder();
    const { actions } = gated(rec, grants);
    grants.grantSession(SESSION);
    rec.failWith({ ok: false, reason: "unsupported", detail: "no screen-capture helper" });

    const result = await actions.screenshot();

    assert.equal(result.ok, false);
    if (result.ok) assert.fail("unreachable");
    assert.equal(result.reason, "driver-unsupported");
  });
});
