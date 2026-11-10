/**
 * Regelgebaseerde outline van een bronbestand.
 *
 * Bewust geen parser: de scanner kijkt per regel naar het begin van de regel en
 * herkent alleen top-level declaraties. Commentaar wordt eerst weggestript, dus
 * een `export class` binnen een blokcommentaar telt niet mee.
 */

/** Maximum aantal entries; daarna stopt de scanner met kijken. */
export const MAX_OUTLINE_ENTRIES = 200;

/** Eén top-level declaratie. */
export interface OutlineEntry {
  /** Gekende vorm: class, interface, type, function, const, let of default. */
  kind: string;
  /** Naam van de declaratie; "default" bij een anonieme default export. */
  name: string;
  /** Regelnummer, 1-gebaseerd. */
  line: number;
}

/** Declaratievormen in volgorde van herkenning. */
const KINDS = ["class", "interface", "type", "function", "const", "let"] as const;

/** Modifiers die vóór het keyword mogen staan. */
const MODIFIERS = ["declare", "abstract", "async"] as const;

/** Naam van een declaratie. */
const NAME_PATTERN = /^([A-Za-z_$][\w$]*)/;

/** Commentaarstatus die over regels heen loopt. */
interface ScanState {
  inBlock: boolean;
}

/**
 * Haalt commentaar uit één regel en werkt de blokstatus bij.
 * Een blokcommentaar wordt door een spatie vervangen zodat tokens niet aan
 * elkaar plakken.
 */
function stripComments(line: string, state: ScanState): string {
  let result = "";
  let index = 0;

  while (index < line.length) {
    if (state.inBlock) {
      const end = line.indexOf("*/", index);
      if (end === -1) {
        return result;
      }
      state.inBlock = false;
      index = end + 2;
      result += " ";
      continue;
    }

    if (line.startsWith("/*", index)) {
      state.inBlock = true;
      index += 2;
      continue;
    }

    if (line.startsWith("//", index)) {
      break;
    }

    result += line.charAt(index);
    index += 1;
  }

  return result;
}

/** Splitst `export`/`default` en modifiers van de regel af. */
function splitPrefixes(text: string): { rest: string; isDefault: boolean } {
  let rest = text.trim();
  let isDefault = false;

  if (/^export\b/.test(rest)) {
    rest = rest.slice("export".length).trim();
  }
  if (/^default\b/.test(rest)) {
    isDefault = true;
    rest = rest.slice("default".length).trim();
  }
  for (const modifier of MODIFIERS) {
    if (new RegExp(`^${modifier}\\b`).test(rest)) {
      rest = rest.slice(modifier.length).trim();
    }
  }

  return { rest, isDefault };
}

/** Herkent één declaratie op een reeds commentaar-vrije regel. */
function parseDeclaration(text: string): { kind: string; name: string } | undefined {
  if (text.trim() === "") {
    return undefined;
  }

  const { rest, isDefault } = splitPrefixes(text);

  for (const kind of KINDS) {
    if (!rest.startsWith(kind)) {
      continue;
    }
    const boundary = rest.charAt(kind.length);
    if (boundary !== " " && boundary !== "\t") {
      continue;
    }

    let tail = rest.slice(kind.length).trim();
    if (kind === "function") {
      tail = tail.replace(/^\*/, "").trim();
    }

    const match = NAME_PATTERN.exec(tail);
    const name = match?.[1];
    if (name !== undefined) {
      return { kind, name };
    }
    // Alleen bij een default export mag de naam ontbreken (bv. `export default class {}`).
    return isDefault ? { kind, name: "default" } : undefined;
  }

  return undefined;
}

/**
 * Geeft de top-level declaraties van `source` terug, met 1-gebaseerde
 * regelnummers en maximaal {@link MAX_OUTLINE_ENTRIES} entries.
 *
 * `file` wordt alleen in foutmeldingen gebruikt.
 */
export function outline(source: string, file: string): OutlineEntry[] {
  if (typeof source !== "string") {
    throw new Error(`outline source for ${file} must be a string, got ${typeof source}`);
  }

  const entries: OutlineEntry[] = [];
  const state: ScanState = { inBlock: false };
  const lines = source.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    if (entries.length >= MAX_OUTLINE_ENTRIES) {
      break;
    }

    const raw = lines[index];
    if (raw === undefined) {
      continue;
    }
    // Commentaar altijd strippen: ook op overgeslagen regels moet de blokstatus kloppen.
    const stripped = stripComments(raw, state);
    // Alleen top-level: een ingesprongen regel hoort bij een class, functie of blok.
    if (/^\s/.test(raw)) {
      continue;
    }

    const parsed = parseDeclaration(stripped);
    if (parsed === undefined) {
      continue;
    }

    entries.push({ kind: parsed.kind, name: parsed.name, line: index + 1 });
  }

  return entries;
}
