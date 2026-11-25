/**
 * Backup rules of the Roan mobile shell, as plain data.
 *
 * The shell shows these lists in the settings screen and passes them on to the
 * native side. No filesystem, no clock, no platform calls: just data and two
 * pure functions, so everything can be tested without an emulator.
 */

/** One entry from the backup list. */
export interface BackupEntry {
  /** Path or pattern inside the app data, ends on `/` for a directory. */
  readonly path: string;
  /** Short name for the UI. */
  readonly label: string;
  /** Why this is or is not included; one sentence. */
  readonly reason: string;
}

/** What does go into a backup. */
export const included: readonly BackupEntry[] = Object.freeze([
  {
    path: "env/snapshot.json",
    label: "Environment snapshot",
    reason: "Reproduceert de machine waarop een turn liep.",
  },
  {
    path: "sessions/",
    label: "Sessions",
    reason: "Gespreksgeschiedenis is het werk zelf.",
  },
  {
    path: "skills/",
    label: "Skills",
    reason: "Eigen procedures zijn duur om opnieuw te leren.",
  },
  {
    path: "config/",
    label: "Config",
    reason: "Instellingen zonder de bijbehorende sleutels.",
  },
]);

/** What never goes into a backup, even if the list above grows. */
export const neverIncluded: readonly BackupEntry[] = Object.freeze([
  {
    path: "secrets/",
    label: "Secret store",
    reason: "Bevat wachtwoorden en privésleutels.",
  },
  {
    path: "secrets/api-keys.json",
    label: "API keys",
    reason: "Een back-upkopie is een tweede lek.",
  },
  {
    path: "secrets/tokens/",
    label: "Tokens",
    reason: "Sessie- en OAuth-tokens verlopen, maar lekken blijft mogelijk.",
  },
  {
    path: "logs/",
    label: "Logs",
    reason: "Kunnen per ongeluk tokens of inhoud bevatten en groeien onbeperkt.",
  },
]);

/** How often and how long things are kept. */
export interface BackupSchedule {
  /** Hours between two backups, 1..168. */
  everyHours: number;
  /** Number of backups kept, 1..30. */
  keep: number;
}

/** Input from outside (JSON, remote config): not trusted yet, so `unknown`. */
export interface BackupScheduleInput {
  readonly everyHours?: unknown;
  readonly keep?: unknown;
}

/** Limits of {@link parseSchedule}. */
export const SCHEDULE_LIMITS = Object.freeze({
  everyHours: Object.freeze({ min: 1, max: 168 }),
  keep: Object.freeze({ min: 1, max: 30 }),
});

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readField(
  field: keyof BackupSchedule,
  raw: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined || raw === null) {
    return clamp(fallback, min, max);
  }
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    throw new Error(
      `backup schedule: field "${field}" must be a finite number, got ${String(raw)}`,
    );
  }
  return clamp(Math.round(raw), min, max);
}

/**
 * Reads a schedule from untrusted input. Missing fields come from
 * `defaults`; out-of-range values are clamped instead of rejected.
 * Throws an `Error` that names the field when a value is not a finite
 * number.
 */
export function parseSchedule(
  input: BackupScheduleInput | null | undefined,
  defaults: BackupSchedule,
): BackupSchedule {
  return {
    everyHours: readField(
      "everyHours",
      input?.everyHours,
      defaults.everyHours,
      SCHEDULE_LIMITS.everyHours.min,
      SCHEDULE_LIMITS.everyHours.max,
    ),
    keep: readField(
      "keep",
      input?.keep,
      defaults.keep,
      SCHEDULE_LIMITS.keep.min,
      SCHEDULE_LIMITS.keep.max,
    ),
  };
}

/**
 * Short lines for the settings screen. The schedule values and every
 * never-included rule appear literally, so the UI does not have to invent anything.
 */
export function describeBackupPolicy(schedule: BackupSchedule): string[] {
  const paths = (entries: readonly BackupEntry[]): string =>
    entries.map((entry) => entry.path).join(", ");

  return [
    `Backup every ${schedule.everyHours} h, keep ${schedule.keep}.`,
    `Included: ${paths(included)}.`,
    `Never included: ${paths(neverIncluded)}.`,
  ];
}
