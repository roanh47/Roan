/**
 * The frontmatter parser on its own, with no disk access.
 *
 * The browser bundle reads skill proposals, and importing the library that
 * touches `node:fs` turns a pure parse into a build failure. Keeping the
 * parser here means both sides can use it.
 */

export interface Frontmatter {
  readonly name?: string;
  readonly description?: string;
  readonly body: string;
}

/** Reads `---` fenced key/value pairs. Deliberately small: two keys, no nesting. */
export function parseFrontmatter(raw: string): Frontmatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (match === null) return { body: raw };
  const head = match[1] ?? "";
  const body = match[2] ?? "";
  const values: Record<string, string> = {};
  for (const line of head.split(/\r?\n/)) {
    const pair = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (pair === null) continue;
    const key = pair[1];
    const value = pair[2];
    if (key === undefined || value === undefined) continue;
    values[key] = value.replace(/^["']|["']$/g, "").trim();
  }
  return {
    ...(values["name"] !== undefined ? { name: values["name"] } : {}),
    ...(values["description"] !== undefined ? { description: values["description"] } : {}),
    body,
  };
}
