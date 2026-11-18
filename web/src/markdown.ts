/**
 * Markdown for chat answers, without a dependency.
 *
 * The transcript renders assistant messages as markdown: headings, lists,
 * fenced code, quotes, tables, and the usual inline marks. The parser is pure
 * text in, block tree out, so it is unit-tested directly and re-runs on every
 * streaming delta without state. React renders the tree — no HTML strings are
 * built anywhere, so nothing the model says can inject markup.
 */

export type Block =
  | { kind: "code"; lang: string; text: string }
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "quote"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "table"; rows: string[][] }
  | { kind: "para"; text: string };

export type InlineToken =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string }
  | { kind: "link"; text: string; href: string };

/** A fence is three or more backticks; the closer matches the same run. */
function fenceLength(line: string): number {
  const match = /^`{3,}/.exec(line);
  return match === null ? 0 : match[0].length;
}

function splitRow(line: string): string[] {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

/** True when the line would start a new block, so paragraphs stop there. */
function startsBlock(line: string): boolean {
  return (
    fenceLength(line) > 0 ||
    /^#{1,3}\s/.test(line) ||
    /^>\s?/.test(line) ||
    /^\s*[-*]\s+/.test(line) ||
    /^\s*\d+\.\s+/.test(line) ||
    /^\|.*\|$/.test(line)
  );
}

export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  // The project compiles with noUncheckedIndexedAccess; the loops below guard
  // with `i < lines.length`, this restores the string type in one place.
  const at = (n: number): string => lines[n] ?? "";
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = at(i);
    if (line.trim().length === 0) {
      i++;
      continue;
    }
    const fence = fenceLength(line);
    if (fence > 0) {
      const lang = line.slice(fence).trim();
      const body: string[] = [];
      i++;
      // An unclosed fence swallows the rest: mid-stream, the block so far is
      // already what the writer meant, and closing it when the delta arrives
      // changes nothing.
      while (i < lines.length && fenceLength(at(i)) < fence) {
        body.push(at(i));
        i++;
      }
      if (i < lines.length) i++; // the closing fence
      blocks.push({ kind: "code", lang, text: body.join("\n") });
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading !== null) {
      blocks.push({
        kind: "heading",
        level: (heading[1] ?? "#").length as 1 | 2 | 3,
        text: (heading[2] ?? "").trim(),
      });
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^>\s?/.test(at(i))) {
        body.push(at(i).replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ kind: "quote", text: body.join("\n") });
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(at(i))) {
        items.push(at(i).replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      blocks.push({ kind: "list", ordered: false, items });
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(at(i))) {
        items.push(at(i).replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      blocks.push({ kind: "list", ordered: true, items });
      continue;
    }
    if (/^\|.*\|$/.test(line) && /^\|[-: |]+\|$/.test(at(i + 1))) {
      const rows: string[][] = [splitRow(line)];
      i += 2; // header + separator
      while (i < lines.length && /^\|.*\|$/.test(at(i))) {
        rows.push(splitRow(at(i)));
        i++;
      }
      blocks.push({ kind: "table", rows });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && at(i).trim().length > 0 && !startsBlock(at(i))) {
      para.push(at(i));
      i++;
    }
    blocks.push({ kind: "para", text: para.join("\n") });
  }
  return blocks;
}

// Code first so `**not bold**` inside backticks stays literal; bold before
// italic so **x** is not read as two italics. Links must be http(s): anything
// else stays plain text, so a model cannot smuggle javascript: URLs.
const INLINE =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\s][^*\n]*\*)|(\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))/g;

export function parseInline(source: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let last = 0;
  for (const match of source.matchAll(INLINE)) {
    const raw = match[0];
    const at = match.index ?? 0;
    if (at > last) tokens.push({ kind: "text", text: source.slice(last, at) });
    if (raw.startsWith("`")) {
      tokens.push({ kind: "code", text: raw.slice(1, -1) });
    } else if (raw.startsWith("**")) {
      tokens.push({ kind: "bold", text: raw.slice(2, -2) });
    } else if (raw.startsWith("[")) {
      const link = /^\[([^\]]+)\]\((.*)\)$/.exec(raw);
      tokens.push(
        link === null
          ? { kind: "text", text: raw }
          : { kind: "link", text: link[1] ?? raw, href: link[2] ?? "" },
      );
    } else {
      tokens.push({ kind: "italic", text: raw.slice(1, -1) });
    }
    last = at + raw.length;
  }
  if (last < source.length) tokens.push({ kind: "text", text: source.slice(last) });
  return tokens;
}
