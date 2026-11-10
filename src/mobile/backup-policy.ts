/**
 * Back-upregels van de Roan mobile shell, als platte data.
 *
 * De shell toont deze lijsten in het instellingenscherm en geeft ze door aan de
 * native kant. Geen bestandssysteem, geen klok, geen platformaanroepen: alleen
 * data en twee pure functies, zodat alles zonder emulator te testen is.
 */

/** Eén regel uit de back-uplijst. */
export interface BackupEntry {
  /** Pad of patroon binnen de app-data, eindigt op `/` bij een map. */
  readonly path: string;
  /** Korte naam voor de UI. */
  readonly label: string;
  /** Waarom dit wel of niet meegaat; één zin. */
  readonly reason: string;
}

/** Wat er wél in een back-up zit. */
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

/** Wat er nooit in een back-up zit, ook niet als de lijst hierboven groeit. */
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

/** Hoe vaak en hoe lang er bewaard wordt. */
export interface BackupSchedule {
  /** Uren tussen twee back-ups, 1..168. */
  everyHours: number;
  /** Aantal bewaarde back-ups, 1..30. */
  keep: number;
}

/** Invoer van buiten (JSON, remote config): nog niet vertrouwd, dus `unknown`. */
export interface BackupScheduleInput {
  readonly everyHours?: unknown;
  readonly keep?: unknown;
}

/** Grenzen van {@link parseSchedule}. */
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
 * Leest een schema uit onbetrouwbare invoer. Ontbrekende velden komen uit
 * `defaults`; waarden buiten bereik worden geklemd in plaats van geweigerd.
 * Gooit een `Error` die het veld bij naam noemt als een waarde geen eindig
 * getal is.
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
 * Korte regels voor het instellingenscherm. De waarden van het schema en alle
 * nooit-mee-regels staan er letterlijk in, zodat de UI niets hoeft te verzinnen.
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
