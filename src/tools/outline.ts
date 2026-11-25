/**
 * Rule-based outline of a source file.
 *
 * Deliberately not a parser: the scanner looks at the start of each line and
 * only recognises top-level declarations. Comments are stripped first, so
 * an `export class` inside a block comment does not count.
 */

/** Maximum number of entries; after that the scanner stops looking. */
export const MAX_OUTLINE_ENTRIES = 200;

/** One top-level declaration. */
export interface OutlineEntry {
  /** Recognised form: class, interface, type, function, const, let or default. */
  kind: string;
  /** Name of the declaration; "default" for an anonymous default export. */
  name: string;
  /** Line number, 1-based. */
  line: number;
}

/** Declaration forms in order of recognition. */
const KINDS = ["class", "interface", "type", "function", "const", "let"] as const;

/** Modifiers that may appear before the keyword. */
const MODIFIERS = ["declare", "abstract", "async"] as const;

/** Name of a declaration. */
const NAME_PATTERN = /^([A-Za-z_$][\w$]*)/;

/** Comment state that carries across lines. */
interface ScanState {
  inBlock: boolean;
}

/**
 * Strips comments from a single line and updates the block state.
 * A block comment is replaced by a space so that tokens do not stick
 * together.
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

/** Splits `export`/`default` and modifiers off the line. */
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

/** Recognises one declaration on an already comment-free line. */
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
    // Only a default export may omit the name (e.g. `export default class {}`).
    return isDefault ? { kind, name: "default" } : undefined;
  }

  return undefined;
}

/**
 * Returns the top-level declarations of `source`, with 1-based
 * line numbers and at most {@link MAX_OUTLINE_ENTRIES} entries.
 *
 * `file` is only used in error messages.
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
    // Always strip comments: the block state must be correct on skipped lines too.
    const stripped = stripComments(raw, state);
    // Top-level only: an indented line belongs to a class, function or block.
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
