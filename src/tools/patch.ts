import { promises as fs } from "node:fs";
import * as nodePath from "node:path";

export interface PatchResult {
  path: string;
  diff: string;
}

const CONTEXT = 3;

/** Turns a path into something inside the working directory; rejects paths pointing outside it. */
function resolveInside(cwd: string, target: string): string {
  const raw = target.length > 0 ? target : ".";
  const full = nodePath.resolve(cwd, raw);
  const rel = nodePath.relative(cwd, full);
  if (rel.startsWith("..") || nodePath.isAbsolute(rel)) {
    throw new Error(`path falls outside the working directory: ${target}`);
  }
  return full;
}

/** Counts exact, non-overlapping occurrences of a piece of text. */
function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/** Splits into lines without counting the trailing newline as an extra empty line. */
function toLines(text: string): string[] {
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  return body === "" ? [] : body.split("\n");
}

/** Builds one unified hunk around the first difference, with context on both sides. */
function buildDiff(file: string, oldText: string, newText: string): string {
  const oldLines = toLines(oldText);
  const newLines = toLines(newText);

  let prefix = 0;
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const oldChangeEnd = oldLines.length - suffix;
  const newChangeEnd = newLines.length - suffix;

  if (prefix === oldLines.length && prefix === newLines.length) return "";

  const start = Math.max(0, prefix - CONTEXT);
  const oldEnd = Math.min(oldLines.length, oldChangeEnd + CONTEXT);
  const newEnd = Math.min(newLines.length, newChangeEnd + CONTEXT);

  const body: string[] = [];
  for (const line of oldLines.slice(start, prefix)) body.push(` ${line}`);
  for (const line of oldLines.slice(prefix, oldChangeEnd)) body.push(`-${line}`);
  for (const line of newLines.slice(prefix, newChangeEnd)) body.push(`+${line}`);
  for (const line of oldLines.slice(oldChangeEnd, oldEnd)) body.push(` ${line}`);

  const oldCount = oldEnd - start;
  const newCount = prefix - start + (newChangeEnd - prefix) + (oldEnd - oldChangeEnd);
  const oldStart = oldCount === 0 ? start : start + 1;
  const newStart = newCount === 0 ? start : start + 1;

  return [
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
    ...body,
  ].join("\n");
}

/**
 * Replaces one unique piece of text in an existing file and returns a unified diff.
 * Refuses if the text is missing or occurs more than once; does not create new files.
 */
export async function applyPatch(
  filePath: string,
  oldText: string,
  newText: string,
): Promise<PatchResult> {
  const cwd = process.cwd();
  const full = resolveInside(cwd, filePath);
  const shown = nodePath.relative(cwd, full).split(nodePath.sep).join("/") || full;

  if (oldText === "") {
    throw new Error(`empty search pattern in ${shown}: provide the exact text that should be replaced`);
  }

  let content: string;
  try {
    const stat = await fs.stat(full);
    if (!stat.isFile()) throw new Error("not a file");
    content = await fs.readFile(full, "utf8");
  } catch {
    throw new Error(`file does not exist or is not a file: ${shown}`);
  }

  const count = countOccurrences(content, oldText);
  if (count === 0) {
    throw new Error(`text not found in ${shown}`);
  }
  if (count > 1) {
    throw new Error(`text occurs ${count} times in ${shown}; make the text unique`);
  }

  if (oldText === newText) {
    return { path: shown, diff: "" };
  }

  const at = content.indexOf(oldText);
  const updated = content.slice(0, at) + newText + content.slice(at + oldText.length);
  await fs.writeFile(full, updated, "utf8");

  return { path: shown, diff: buildDiff(shown, content, updated) };
}
