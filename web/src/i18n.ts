/**
 * Shell copy for the Roan app. Pure data plus pure functions: no react, no
 * fetch, nothing that runs at import time. Dutch is the default because this
 * builds for the Netherlands.
 */

export type Locale = "en" | "nl";

export const defaultLocale: Locale = "nl";

export const locales: readonly Locale[] = ["en", "nl"];

/** Dotted paths, one per string, mirrored by the flat `Strings` shape below. */
export type StringKey =
  | "onboarding.heading" | "onboarding.create"
  | "onboarding.join" | "onboarding.joinHint"
  | "pickers.providerLabel" | "pickers.modelLabel"
  | "pickers.searchPlaceholder" | "pickers.emptyResult"
  | "invite.heading" | "invite.copy"
  | "invite.copied" | "invite.sendHint"
  | "settings.heading" | "settings.workspace"
  | "settings.provider" | "settings.model"
  | "settings.save"
  | "toolCard.running" | "toolCard.done"
  | "toolCard.failed" | "toolCard.showOutput"
  | "toolCard.hideOutput"
  | "errors.dismiss" | "errors.connectionLost"
  | "errors.turnFailed"
  | "peers.heading" | "peers.empty"
  | "shortcuts.heading" | "shortcuts.close"
  | "common.cancel" | "common.retry"
  | "common.loading";

export interface Strings {
  "onboarding.heading": string; "onboarding.create": string;
  "onboarding.join": string; "onboarding.joinHint": string;
  "pickers.providerLabel": string; "pickers.modelLabel": string;
  "pickers.searchPlaceholder": string; "pickers.emptyResult": string;
  "invite.heading": string; "invite.copy": string;
  "invite.copied": string; "invite.sendHint": string;
  "settings.heading": string; "settings.workspace": string;
  "settings.provider": string; "settings.model": string;
  "settings.save": string;
  "toolCard.running": string; "toolCard.done": string;
  "toolCard.failed": string; "toolCard.showOutput": string;
  "toolCard.hideOutput": string;
  "errors.dismiss": string; "errors.connectionLost": string;
  "errors.turnFailed": string;
  "peers.heading": string; "peers.empty": string;
  "shortcuts.heading": string; "shortcuts.close": string;
  "common.cancel": string; "common.retry": string;
  "common.loading": string;
}

// Fails to typecheck if the union and the interface ever drift apart.
type MissingFromStrings = Exclude<StringKey, keyof Strings>;
type MissingFromUnion = Exclude<keyof Strings, StringKey>;
export type StringKeyCheck = [MissingFromStrings, MissingFromUnion] extends [never, never] ? true : never;

const en: Strings = {
  "onboarding.heading": "Start a chain",
  "onboarding.create": "Start a new chain",
  "onboarding.join": "Join an existing chain",
  "onboarding.joinHint": "Asks the other chain for its data and takes it over",
  "pickers.providerLabel": "Provider",
  "pickers.modelLabel": "Model",
  "pickers.searchPlaceholder": "Search models",
  "pickers.emptyResult": "No models found",
  "invite.heading": "Invite a device",
  "invite.copy": "Share this link with your other device",
  "invite.copied": "Copied",
  "invite.sendHint": "Works once, on the device that opens it",
  "settings.heading": "Settings",
  "settings.workspace": "Workspace",
  "settings.provider": "Provider",
  "settings.model": "Model",
  "settings.save": "Save",
  "toolCard.running": "Running",
  "toolCard.done": "Done",
  "toolCard.failed": "Failed",
  "toolCard.showOutput": "Show output",
  "toolCard.hideOutput": "Hide output",
  "errors.dismiss": "Dismiss",
  "errors.connectionLost": "Connection lost",
  "errors.turnFailed": "Turn failed",
  "peers.heading": "Peers",
  "peers.empty": "No peers yet",
  "shortcuts.heading": "Shortcuts",
  "shortcuts.close": "Close",
  "common.cancel": "Cancel",
  "common.retry": "Retry",
  "common.loading": "Loading",
};

const nl: Strings = {
  "onboarding.heading": "Start een keten",
  "onboarding.create": "Start een nieuwe keten",
  "onboarding.join": "Sluit aan bij een bestaande keten",
  "onboarding.joinHint": "Vraagt de andere keten om zijn gegevens en neemt ze over",
  "pickers.providerLabel": "Aanbieder",
  "pickers.modelLabel": "Model",
  "pickers.searchPlaceholder": "Zoek een model",
  "pickers.emptyResult": "Geen modellen gevonden",
  "invite.heading": "Nodig een apparaat uit",
  "invite.copy": "Deel deze link met je andere apparaat",
  "invite.copied": "Gekopieerd",
  "invite.sendHint": "Werkt één keer, op het apparaat dat hem opent",
  "settings.heading": "Instellingen",
  "settings.workspace": "Werkmap",
  "settings.provider": "Aanbieder",
  "settings.model": "Model",
  "settings.save": "Opslaan",
  "toolCard.running": "Bezig",
  "toolCard.done": "Klaar",
  "toolCard.failed": "Mislukt",
  "toolCard.showOutput": "Toon uitvoer",
  "toolCard.hideOutput": "Verberg uitvoer",
  "errors.dismiss": "Sluiten",
  "errors.connectionLost": "Verbinding verbroken",
  "errors.turnFailed": "Beurt mislukt",
  "peers.heading": "Apparaten",
  "peers.empty": "Nog geen apparaten",
  "shortcuts.heading": "Sneltoetsen",
  "shortcuts.close": "Sluiten",
  "common.cancel": "Annuleren",
  "common.retry": "Opnieuw proberen",
  "common.loading": "Laden",
};

export const strings: Record<Locale, Strings> = { en, nl };

export function t(locale: Locale, key: StringKey): string {
  return strings[locale][key];
}

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "nl";
}
