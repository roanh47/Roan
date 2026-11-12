import { promises as fs } from "node:fs";
import path from "node:path";

/** Uitkomst van {@link mkdir}. */
export interface MkdirResult {
  /** Absoluut pad van de map, met eventuele symbolische links opgelost. */
  path: string;
  /** Pad relatief ten opzichte van de root, met forward slashes. */
  relative: string;
  /** True als de map in deze aanroep is aangemaakt, false als hij al bestond. */
  created: boolean;
}

/** Opties voor {@link mkdir}; nu alleen een abort-signaal. */
export interface MkdirOptions {
  signal?: AbortSignal;
}

/** Leest de foutcode (`ENOENT`, `EACCES`, …) zonder naar `any` te grijpen. */
function errorCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null || !("code" in err)) return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/** True als `child` gelijk is aan `root` of eronder ligt. */
function isWithin(root: string, child: string): boolean {
  if (child === root) return true;
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  // Vergelijk hoofdlettergevoelig zoals het besturingssysteem dat doet; op
  // Windows is dit een benadering, op Linux exact.
  return child.startsWith(prefix);
}

/**
 * Lost `absolute` op tot een echt pad en volgt daarbij symbolische links voor
 * het deel dat al bestaat. Segmenten die nog niet bestaan blijven staan zoals
 * ze zijn, zodat een aan te maken map hetzelfde pad houdt.
 */
async function resolveReal(absolute: string): Promise<string> {
  const missing: string[] = [];
  let candidate = absolute;
  for (;;) {
    try {
      const real = await fs.realpath(candidate);
      return missing.length === 0 ? real : path.join(real, ...missing.slice().reverse());
    } catch {
      const parent = path.dirname(candidate);
      if (parent === candidate) return absolute;
      missing.push(path.basename(candidate));
      candidate = parent;
    }
  }
}

/**
 * Maakt `target` aan als map, inclusief alle tussenliggende mappen.
 *
 * - `root` is de werkmap en moet al bestaan; `target` wordt daartegen afgezet.
 * - Relatieve én absolute paden zijn toegestaan zolang ze binnen `root` vallen.
 *   Een pad dat via `..` of een symbolische link naar buiten wijst wordt geweigerd.
 * - Idempotent: een bestaande map levert `created: false` op zonder fout.
 * - Bestaat er al een bestand of een dangling symlink op het pad, dan volgt een
 *   fout; er wordt niets overschreven.
 *
 * @throws Error als `root` geen bestaande map is, als `target` buiten de root
 *   valt, of als het doelpad door een niet-map wordt geblokkeerd.
 */
export async function mkdir(
  root: string,
  target: string,
  options: MkdirOptions = {},
): Promise<MkdirResult> {
  options.signal?.throwIfAborted();

  if (typeof target !== "string" || target.includes("\0")) {
    throw new Error(`ongeldig pad: ${JSON.stringify(target)}`);
  }
  if (typeof root !== "string" || root.trim() === "") {
    throw new Error("werkmap ontbreekt");
  }

  // De root moet bestaan: zonder bestaande root is er geen grens om tegen te
  // controleren en zou een typefout stilzwijgend mappen buiten de werkmap maken.
  let rootReal: string;
  try {
    rootReal = await fs.realpath(path.resolve(root));
  } catch {
    throw new Error(`werkmap bestaat niet: ${path.resolve(root)}`);
  }
  const rootInfo = await fs.stat(rootReal);
  if (!rootInfo.isDirectory()) {
    throw new Error(`werkmap is geen map: ${rootReal}`);
  }

  const raw = target.trim() === "" ? "." : target;
  const lexical = path.resolve(rootReal, raw);
  if (!isWithin(rootReal, lexical)) {
    throw new Error(`pad "${target}" valt buiten de werkmap ${rootReal}`);
  }

  // Het diepst bestaande deel kan een symbolische link naar buiten zijn; daarom
  // controleren we het echte pad en niet alleen de lexicale vorm.
  const resolved = await resolveReal(lexical);
  if (!isWithin(rootReal, resolved)) {
    throw new Error(`pad "${target}" wijst via een symbolische link buiten de werkmap ${rootReal}`);
  }

  let exists = true;
  try {
    await fs.lstat(resolved);
  } catch (err) {
    if (errorCode(err) !== "ENOENT") throw err;
    exists = false;
  }

  let created = false;
  if (exists) {
    // Een bestaand doel mag alleen een map zijn (of een link daarnaartoe).
    let isDirectory = false;
    try {
      isDirectory = (await fs.stat(resolved)).isDirectory();
    } catch (err) {
      if (errorCode(err) !== "ENOENT") throw err;
      throw new Error(`doel is een dangling symbolische link: ${resolved}`);
    }
    if (!isDirectory) throw new Error(`doel bestaat al en is geen map: ${resolved}`);
  } else {
    options.signal?.throwIfAborted();
    await fs.mkdir(resolved, { recursive: true });
    created = true;
  }

  const relative = path.relative(rootReal, resolved).split(path.sep).join("/") || ".";
  return { path: resolved, relative, created };
}
