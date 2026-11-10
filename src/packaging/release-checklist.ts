/**
 * Per-platform release checklists as data, plus a builder that marks steps as
 * open or satisfied for a known signing/notarization status.
 *
 * The checklist itself carries only `id`, `text` and `manual`; which status flag
 * can close a step is derived from the step id, so no step can silently claim a
 * flag that is not part of `ReleaseStatus`:
 *
 * - `sign-…`     closes when `signed` is true.
 * - `notarize-…` closes when `notarized` is true.
 * - `staple-…`   closes when `notarized` is true (stapling follows notarization).
 * - anything else is manual-only and stays open until a human ticks it off.
 */

/** Platforms that ship a package and therefore need a checklist. */
export type ReleasePlatform = "windows" | "macos" | "linux";

/** One unchecked item of a platform checklist. */
export interface ReleaseStep {
  readonly id: string;
  readonly text: string;
  /** True when a human must perform or confirm the step. */
  readonly manual: boolean;
}

/** Status flags a release can be in; omitted means "not done yet". */
export interface ReleaseStatus {
  signed?: boolean;
  notarized?: boolean;
}

/** Status flag names, in the order they are documented above. */
type StatusKey = keyof ReleaseStatus;

/** A step with its open state resolved against a `ReleaseStatus`. */
export interface ChecklistStep {
  readonly id: string;
  readonly text: string;
  readonly manual: boolean;
  /** False once the status satisfies the step; true otherwise. */
  readonly open: boolean;
}

/** Result of `buildChecklist`. */
export interface ReleaseChecklist {
  readonly platform: ReleasePlatform;
  readonly steps: ChecklistStep[];
  /** Number of steps still open. */
  readonly openCount: number;
}

/** Step id prefixes that a status flag can satisfy, checked in order. */
const STATUS_BY_PREFIX: readonly (readonly [string, StatusKey])[] = [
  ["sign-", "signed"],
  ["notarize-", "notarized"],
  ["staple-", "notarized"],
];

/** Lowercase kebab-case: `sign-binaries`, `build-appimage`, `upload-2fa`. */
const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Known platforms, in the order they are reported. */
const PLATFORMS: readonly ReleasePlatform[] = ["windows", "macos", "linux"];

/** The checklist data. Ids are unique within a platform and kebab-case. */
export const CHECKLISTS: Readonly<Record<ReleasePlatform, readonly ReleaseStep[]>> = Object.freeze({
  windows: Object.freeze([
    {
      id: "bump-version",
      text: "Set the release version in package.json and the Windows app manifest.",
      manual: false,
    },
    {
      id: "build-installer",
      text: "Build the x64 installer from a clean checkout.",
      manual: false,
    },
    {
      id: "sign-binaries",
      text: "Sign the app executable and the installer with the code-signing certificate.",
      manual: true,
    },
    {
      id: "smoke-test",
      text: "Install on a clean Windows VM, launch the app and open a document.",
      manual: true,
    },
    {
      id: "upload-artifacts",
      text: "Upload the installer and its checksums to the release page.",
      manual: true,
    },
  ] as const satisfies readonly ReleaseStep[]),
  macos: Object.freeze([
    {
      id: "bump-version",
      text: "Set the release version in package.json and the Info.plist.",
      manual: false,
    },
    {
      id: "build-universal",
      text: "Build the universal (arm64 + x64) .app bundle and the DMG.",
      manual: false,
    },
    {
      id: "sign-app",
      text: "Sign the .app and the DMG with the Developer ID Application certificate and the hardened runtime.",
      manual: true,
    },
    {
      id: "notarize-dmg",
      text: "Submit the DMG to Apple's notary service and wait for acceptance.",
      manual: true,
    },
    {
      id: "staple-ticket",
      text: "Staple the notarization ticket to the DMG and confirm it with spctl.",
      manual: true,
    },
    {
      id: "upload-artifacts",
      text: "Upload the DMG and its checksums to the release page.",
      manual: true,
    },
  ] as const satisfies readonly ReleaseStep[]),
  linux: Object.freeze([
    {
      id: "bump-version",
      text: "Set the release version in package.json and the desktop entry.",
      manual: false,
    },
    {
      id: "build-packages",
      text: "Build the AppImage and the .deb from a clean checkout.",
      manual: false,
    },
    {
      id: "sign-packages",
      text: "Sign the .deb with the release GPG key and publish the public key.",
      manual: true,
    },
    {
      id: "smoke-test",
      text: "Install the .deb on a clean distribution and launch the app from the desktop entry.",
      manual: true,
    },
    {
      id: "upload-artifacts",
      text: "Upload the packages and their checksums to the release page.",
      manual: true,
    },
  ] as const satisfies readonly ReleaseStep[]),
});

/**
 * Rejects bad checklist data at module load: an id that is not kebab-case,
 * an id reused inside one platform, or empty step text.
 */
function assertValidChecklists(
  checklists: Readonly<Record<ReleasePlatform, readonly ReleaseStep[]>>,
): void {
  for (const platform of PLATFORMS) {
    const seen = new Set<string>();
    for (const step of checklists[platform]) {
      if (!KEBAB_CASE.test(step.id)) {
        throw new Error(
          `Invalid release checklist step for ${platform}: id "${step.id}" is not lowercase kebab-case`,
        );
      }
      if (seen.has(step.id)) {
        throw new Error(`Invalid release checklist step for ${platform}: duplicate id "${step.id}"`);
      }
      seen.add(step.id);
      if (step.text.trim().length === 0) {
        throw new Error(`Invalid release checklist step for ${platform}: id "${step.id}" has empty text`);
      }
    }
  }
}

assertValidChecklists(CHECKLISTS);

/** The status flag that can close `id`, or undefined for a manual-only step. */
function statusKeyFor(id: string): StatusKey | undefined {
  for (const [prefix, key] of STATUS_BY_PREFIX) {
    if (id.startsWith(prefix)) return key;
  }
  return undefined;
}

/**
 * Steps for `platform` with their open state resolved against `status`.
 *
 * A step is open unless the status flag bound to its id is true, so signing
 * steps close on `signed`, notarization and stapling steps on `notarized`, and
 * every other step stays open for a human.
 *
 * @throws Error when `platform` is not one of windows, macos or linux; the
 *   message quotes the offending value.
 */
export function buildChecklist(
  platform: ReleasePlatform,
  status: ReleaseStatus = {},
): ReleaseChecklist {
  if (!PLATFORMS.includes(platform)) {
    throw new Error(
      `Invalid release checklist platform: "${String(platform)}" — expected one of ${PLATFORMS.join(", ")}`,
    );
  }

  const steps: ChecklistStep[] = [];
  let openCount = 0;

  for (const step of CHECKLISTS[platform]) {
    const key = statusKeyFor(step.id);
    const open = key === undefined ? true : status[key] !== true;
    if (open) openCount += 1;
    steps.push({ id: step.id, text: step.text, manual: step.manual, open });
  }

  return { platform, steps, openCount };
}
