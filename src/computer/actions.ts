/**
 * The five computer actions, as a thin, gated wrapper over a platform driver.
 *
 * The ordering of the checks is the contract, not an implementation detail:
 *
 *  1. grant   — is this session allowed to touch the machine at all;
 *  2. driver  — can this machine do it (no ydotool/xdotool, wrong session type);
 *  3. arguments — is this a usable request (finite integer coordinates on a
 *     known screen, text that is not empty, a key combo that is not a flag).
 *
 * The grant is checked first on purpose. A session with no grant must be told
 * "not granted" even when its request is also malformed, otherwise a caller
 * learns about the machine's layout from a refusal it should not have reached.
 *
 * Everything that actually moves the pointer lives behind `ComputerDriver`, so
 * the gated layer is testable with a fake driver and no display server. No
 * action here ever runs a binary itself.
 */

import { type GrantCheck, type GrantStore } from "./grant.js";

/** The screen the coordinates are validated against, in pixels. */
export interface ScreenSize {
  readonly width: number;
  readonly height: number;
}

/** One captured frame, already encoded; the driver decides the format. */
export interface Screenshot {
  readonly mimeType: string;
  readonly base64: string;
}

/** Why a driver could not do what it was asked. */
export type DriverFailure = "unavailable" | "unsupported" | "failed";

/** What a driver reports about itself before any action is attempted. */
export type DriverAvailability =
  | { readonly available: true }
  | { readonly available: false; readonly reason: string };

export type DriverOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: DriverFailure; readonly detail: string };

export type ScreenshotOutcome =
  | { readonly ok: true; readonly screenshot: Screenshot }
  | { readonly ok: false; readonly reason: DriverFailure; readonly detail: string };

/**
 * The platform driver: five actions plus an honest report about whether the
 * platform can perform them at all.
 *
 * Implementations are expected to be thin — build an argv, run it, report what
 * happened. Policy (grant, bounds, validation) belongs to the gated layer above,
 * never here, so there is exactly one place that decides.
 */
export interface ComputerDriver {
  /** Short, stable label for logs, e.g. `linux:ydotool`. */
  readonly name: string;
  /** Presence and usability of the tools this driver needs. */
  available(): DriverAvailability;
  screenshot(): Promise<ScreenshotOutcome>;
  move(x: number, y: number): Promise<DriverOutcome>;
  click(x: number, y: number): Promise<DriverOutcome>;
  type(text: string): Promise<DriverOutcome>;
  key(combo: string): Promise<DriverOutcome>;
}

/** Why an action was refused. Each value is a distinct, testable case. */
export type ActionRefusal =
  | "not-granted"
  | "grant-expired"
  | "grant-revoked"
  | "driver-unavailable"
  | "driver-unsupported"
  | "driver-failed"
  | "invalid-screen"
  | "invalid-coordinates"
  | "invalid-text"
  | "invalid-key";

export type ActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: ActionRefusal; readonly detail: string };

/** The refusing half of `ActionResult`, which every action can return. */
export type Refusal = Extract<ActionResult, { readonly ok: false }>;


export type ScreenshotActionResult =
  | { readonly ok: true; readonly screenshot: Screenshot }
  | { readonly ok: false; readonly reason: ActionRefusal; readonly detail: string };

/** The gated surface. Every member checks the grant before doing anything. */
export interface ComputerActions {
  screenshot(): Promise<ScreenshotActionResult>;
  moveTo(x: number, y: number): Promise<ActionResult>;
  click(x: number, y: number): Promise<ActionResult>;
  type(text: string): Promise<ActionResult>;
  key(combo: string): Promise<ActionResult>;
}

export interface ComputerActionsOptions {
  /** Session whose grant gates every action. */
  readonly sessionId: string;
  readonly driver: ComputerDriver;
  /** Screen the coordinates must fall inside. Required: there is no guess. */
  readonly screen: ScreenSize;
  /** Grant store to consult; defaults to the shared store. */
  readonly grants: GrantStore;
}

/** A key combo is at most this many parts, e.g. `ctrl+alt+shift+super+tab`. */
const MAX_KEY_PARTS = 6;

/** Each part is a plain name; anything that starts a flag is not a key. */
const KEY_PART = /^[A-Za-z0-9_]{1,24}$/;

function describeValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null) return "null";
  if (typeof value === "object") return Object.prototype.toString.call(value);
  return String(value);
}

function refuse(reason: ActionRefusal, detail: string): Refusal {
  return { ok: false, reason, detail };
}

/** Map a refused grant onto the action layer's own reason. */
function refusalOf(check: GrantCheck): Refusal | null {
  if (check.granted) return null;
  switch (check.reason) {
    case "no-grant":
      return refuse(
        "not-granted",
        "computer use requires a grant for this session; ask the user to allow it",
      );
    case "expired":
      return refuse(
        "grant-expired",
        "the computer-use grant for this session expired; grant it again to continue",
      );
    case "revoked":
      return refuse(
        "grant-revoked",
        "the computer-use grant for this session was revoked; grant it again to continue",
      );
  }
}

/** Map a driver failure onto the action layer's reason. */
function failureOf(reason: DriverFailure, detail: string): Refusal {
  switch (reason) {
    case "unavailable":
      return refuse("driver-unavailable", detail);
    case "unsupported":
      return refuse("driver-unsupported", detail);
    case "failed":
      return refuse("driver-failed", detail);
  }
}

function validateScreen(screen: ScreenSize): string | null {
  if (screen === null || typeof screen !== "object") {
    return `screen must be an object with width and height, got ${describeValue(screen)}`;
  }
  const width: unknown = screen.width;
  const height: unknown = screen.height;
  if (!Number.isSafeInteger(width) || (width as number) < 1) {
    return `screen.width must be a positive integer, got ${describeValue(width)}`;
  }
  if (!Number.isSafeInteger(height) || (height as number) < 1) {
    return `screen.height must be a positive integer, got ${describeValue(height)}`;
  }
  return null;
}

/**
 * A coordinate is usable only when it is a finite integer inside the screen.
 *
 * Fractional or out-of-range coordinates are rejected rather than clamped: a
 * clamped click lands somewhere the model did not ask for, silently, which is
 * worse than a refusal it can read.
 */
function validatePoint(screen: ScreenSize, x: unknown, y: unknown): string | null {
  for (const [axis, value] of [
    ["x", x],
    ["y", y],
  ] as const) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return `${axis} must be a finite number, got ${describeValue(value)}`;
    }
    if (!Number.isInteger(value)) {
      return `${axis} must be an integer, got ${describeValue(value)}`;
    }
  }
  const px = x as number;
  const py = y as number;
  if (px < 0 || px >= screen.width) {
    return `x must be within 0..${screen.width - 1} for a ${screen.width}x${screen.height} screen, got ${px}`;
  }
  if (py < 0 || py >= screen.height) {
    return `y must be within 0..${screen.height - 1} for a ${screen.width}x${screen.height} screen, got ${py}`;
  }
  return null;
}

function validateText(text: unknown): string | null {
  if (typeof text !== "string") {
    return `text must be a string, got ${describeValue(text)}`;
  }
  if (text === "") return "text must not be empty";
  if (text.includes("\0")) return "text must not contain a NUL byte";
  return null;
}

/**
 * A combo is `ctrl+shift+t`. Rejecting a leading dash matters: `--delay 5` as
 * a "key" would become an argument to the tool instead of a key to press.
 */
function validateCombo(combo: unknown): string | null {
  if (typeof combo !== "string" || combo === "") {
    return `combo must be a non-empty string, got ${describeValue(combo)}`;
  }
  const parts = combo.split("+");
  if (parts.length > MAX_KEY_PARTS) {
    return `combo must have at most ${MAX_KEY_PARTS} parts, got ${parts.length}`;
  }
  for (const part of parts) {
    if (!KEY_PART.test(part)) {
      return `combo part ${describeValue(part)} is not a key name (letters, digits, underscore)`;
    }
  }
  return null;
}

/**
 * Build the gated action surface for one session, driver and screen.
 *
 * The screen is fixed at construction because it is the screen the grant was
 * given for; letting a caller pass a different size per call would let it walk
 * the pointer off the edge it promised to stay inside.
 */
export function createComputerActions(options: ComputerActionsOptions): ComputerActions {
  const { sessionId, driver, screen, grants } = options;

  const screenError = validateScreen(screen);
  if (screenError !== null) {
    throw new Error(`computer actions: ${screenError}`);
  }
  if (typeof sessionId !== "string" || sessionId.trim() === "") {
    throw new Error(
      `computer actions: sessionId must be a non-empty string, got ${describeValue(sessionId)}`,
    );
  }

  /** Checks 1 and 2, in that order; returns a refusal or the driver's ok. */
  function gate(): Refusal | null {
    const grantRefusal = refusalOf(grants.check(sessionId));
    if (grantRefusal !== null) return grantRefusal;

    const availability = driver.available();
    if (!availability.available) {
      return refuse("driver-unavailable", availability.reason);
    }
    return null;
  }

  function pointGate(x: unknown, y: unknown): Refusal | null {
    const gated = gate();
    if (gated !== null) return gated;
    const pointError = validatePoint(screen, x, y);
    if (pointError !== null) return refuse("invalid-coordinates", pointError);
    return null;
  }

  return {
    async screenshot(): Promise<ScreenshotActionResult> {
      const gated = gate();
      if (gated !== null) return gated;
      const outcome = await driver.screenshot();
      if (!outcome.ok) return failureOf(outcome.reason, outcome.detail);
      return { ok: true, screenshot: outcome.screenshot };
    },

    async moveTo(x: number, y: number): Promise<ActionResult> {
      const gated = pointGate(x, y);
      if (gated !== null) return gated;
      const outcome = await driver.move(x, y);
      if (!outcome.ok) return failureOf(outcome.reason, outcome.detail);
      return { ok: true };
    },

    async click(x: number, y: number): Promise<ActionResult> {
      const gated = pointGate(x, y);
      if (gated !== null) return gated;
      const outcome = await driver.click(x, y);
      if (!outcome.ok) return failureOf(outcome.reason, outcome.detail);
      return { ok: true };
    },

    async type(text: string): Promise<ActionResult> {
      const gated = gate();
      if (gated !== null) return gated;
      const textError = validateText(text);
      if (textError !== null) return refuse("invalid-text", textError);
      const outcome = await driver.type(text);
      if (!outcome.ok) return failureOf(outcome.reason, outcome.detail);
      return { ok: true };
    },

    async key(combo: string): Promise<ActionResult> {
      const gated = gate();
      if (gated !== null) return gated;
      const comboError = validateCombo(combo);
      if (comboError !== null) return refuse("invalid-key", comboError);
      const outcome = await driver.key(combo);
      if (!outcome.ok) return failureOf(outcome.reason, outcome.detail);
      return { ok: true };
    },
  };
}
