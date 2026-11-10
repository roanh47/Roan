import path from "node:path";

/**
 * The macOS distribution chain for a desktop build, described as data.
 *
 * Nothing here runs a process, touches a keychain or talks to Apple: the
 * planner only produces the argument vectors a caller may execute. Two
 * consequences follow, and both are deliberate.
 *
 * 1. Order is fixed. `codesign` must finish before the bundle is archived, or
 *    the zip carries an unsigned binary; the notary service accepts only an
 *    archive (or a signed bundle), never a bare path; and `stapler` can only
 *    attach a ticket once notarization has succeeded, so it runs last.
 * 2. Credentials are referenced, never carried. `NotarizeInput` holds the
 *    *names* of the environment variables, and the emitted argv contains a
 *    literal `$NAME` that the user's shell expands at run time. This module
 *    never reads those values, never echoes them, and never puts a secret in a
 *    string it returns — a planned step is safe to log, print or persist.
 */

/** Environment variable names holding the App Store Connect credentials. */
export interface NotarizeCredentialEnvNames {
  /** Apple ID email used for `notarytool`. */
  readonly appleId: string;
  /** App-specific password for that Apple ID. */
  readonly appPassword: string;
  /** App Store Connect team identifier. */
  readonly teamId: string;
}

export interface NotarizeInput {
  /** Absolute path to the built `.app` bundle. */
  readonly appPath: string;
  /** Bundle identifier, e.g. `com.example.app`. */
  readonly bundleId: string;
  /** Team identifier that owns the Developer ID certificate. */
  readonly teamId: string;
  readonly credentialEnvNames: NotarizeCredentialEnvNames;
}

export type NotarizeStepId = "sign" | "zip" | "submit" | "staple";

/** One command to run, plus why it is where it is in the chain. */
export interface NotarizeStep {
  readonly id: NotarizeStepId;
  readonly argv: readonly string[];
  readonly note: string;
}

/** Identity prefix `codesign` matches against the login keychain. */
const DEVELOPER_ID_PREFIX = "Developer ID Application";

/**
 * Builds the four-step sign → zip → submit → staple plan.
 *
 * Throws an `Error` naming the offending field when `appPath` is empty or not
 * absolute, or when a credential env name is absent or not set in the
 * environment. Presence is checked by truthiness of `process.env[name]`; the
 * value is never read into a local, interpolated into a message, or returned.
 */
export function planNotarization(input: NotarizeInput): NotarizeStep[] {
  const appPath = requireAppPath(input.appPath);
  const bundleId = requireText(input.bundleId, "bundleId");
  const teamId = requireText(input.teamId, "teamId");

  const appleIdVar = requireEnvName(input.credentialEnvNames?.appleId, "credentialEnvNames.appleId");
  const appPasswordVar = requireEnvName(input.credentialEnvNames?.appPassword, "credentialEnvNames.appPassword");
  const teamIdVar = requireEnvName(input.credentialEnvNames?.teamId, "credentialEnvNames.teamId");

  // Only a presence test. `process.env[name]` is coerced to a boolean here and
  // the underlying string is never bound to anything.
  requireEnvSet(appleIdVar, "credentialEnvNames.appleId");
  requireEnvSet(appPasswordVar, "credentialEnvNames.appPassword");
  requireEnvSet(teamIdVar, "credentialEnvNames.teamId");

  const archivePath = `${appPath}.zip`;

  return [
    {
      id: "sign",
      argv: [
        "codesign",
        "--force",
        "--options",
        "runtime",
        "--timestamp",
        "--identifier",
        bundleId,
        "--sign",
        DEVELOPER_ID_PREFIX,
        appPath,
      ],
      note: `Re-signs the bundle in place with hardened runtime and a secure timestamp. "${DEVELOPER_ID_PREFIX}" must resolve to exactly one certificate in the login keychain; when several teams are installed, replace it with the full common name, including "(${teamId})".`,
    },
    {
      id: "zip",
      argv: ["ditto", "-c", "-k", "--keepParent", appPath, archivePath],
      note: `Archives the already-signed bundle into ${archivePath}. ditto preserves signature-relevant metadata that zip(1) drops; run this after sign, never before.`,
    },
    {
      id: "submit",
      argv: [
        "xcrun",
        "notarytool",
        "submit",
        archivePath,
        "--apple-id",
        dollar(appleIdVar),
        "--password",
        dollar(appPasswordVar),
        "--team-id",
        dollar(teamIdVar),
        "--wait",
      ],
      note: "Uploads the archive and blocks until Apple answers. The argv carries the literal references above; the shell supplies the values, so no credential is ever part of a planned step. --wait makes a rejection visible here instead of later at staple time.",
    },
    {
      id: "staple",
      argv: ["xcrun", "stapler", "staple", appPath],
      note: "Attaches the accepted ticket to the .app so it validates offline. Only valid after submit succeeded; finish with `xcrun stapler validate` and `spctl --assess` before shipping.",
    },
  ];
}

/* ---------------------------------------------------------------- helpers */

function dollar(envName: string): string {
  return `$${envName}`;
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function requireAppPath(value: unknown): string {
  const appPath = requireText(value, "appPath");
  if (!path.isAbsolute(appPath)) {
    throw new Error(`appPath must be an absolute path, got ${JSON.stringify(appPath)}`);
  }
  return appPath;
}

/** A name is only usable as a `$NAME` reference if it is a plain shell identifier. */
function requireEnvName(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} is missing: no environment variable name was given`);
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`${field} is not a valid environment variable name: ${JSON.stringify(value)}`);
  }
  return value;
}

/** Presence only — the value behind the name is never touched. */
function requireEnvSet(envName: string, field: string): void {
  if (process.env[envName]) return;
  throw new Error(`${field} names ${envName}, which is not set in the environment`);
}
