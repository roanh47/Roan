import { describe, expect, test } from "vitest";
import { parseBlocks, parseInline } from "./markdown.js";

describe("parseBlocks", () => {
  test("empty input is no blocks", () => {
    expect(parseBlocks("")).toEqual([]);
    expect(parseBlocks("\n\n  \n")).toEqual([]);
  });

  test("plain paragraphs merge their lines and stop at a blank line", () => {
    const blocks = parseBlocks("first line\nsecond line\n\nsecond para");
    expect(blocks).toEqual([
      { kind: "para", text: "first line\nsecond line" },
      { kind: "para", text: "second para" },
    ]);
  });

  test("headings levels 1 to 3", () => {
    const blocks = parseBlocks("# one\n## two\n### three");
    expect(blocks).toEqual([
      { kind: "heading", level: 1, text: "one" },
      { kind: "heading", level: 2, text: "two" },
      { kind: "heading", level: 3, text: "three" },
    ]);
  });

  test("fenced code with backticks and a fence-like line inside", () => {
    const source = "before\n```js\nconst a = `template`;\n```\nafter";
    const blocks = parseBlocks(source);
    expect(blocks).toEqual([
      { kind: "para", text: "before" },
      { kind: "code", lang: "js", text: "const a = `template`;" },
      { kind: "para", text: "after" },
    ]);
  });

  test("an unclosed fence swallows the rest (mid-stream)", () => {
    const blocks = parseBlocks("text\n```py\nprint(1)");
    expect(blocks).toEqual([
      { kind: "para", text: "text" },
      { kind: "code", lang: "py", text: "print(1)" },
    ]);
  });

  test("a longer fence does not close on a shorter one", () => {
    const blocks = parseBlocks("````md\n```\nstill inside\n````\ndone");
    expect(blocks).toEqual([
      { kind: "code", lang: "md", text: "```\nstill inside" },
      { kind: "para", text: "done" },
    ]);
  });

  test("lists, ordered and unordered", () => {
    const blocks = parseBlocks("- a\n- b\n\n1. one\n2. two");
    expect(blocks).toEqual([
      { kind: "list", ordered: false, items: ["a", "b"] },
      { kind: "list", ordered: true, items: ["one", "two"] },
    ]);
  });

  test("a paragraph stops when a list starts on the next line", () => {
    const blocks = parseBlocks("intro:\n- item");
    expect(blocks).toEqual([
      { kind: "para", text: "intro:" },
      { kind: "list", ordered: false, items: ["item"] },
    ]);
  });

  test("blockquote lines merge", () => {
    const blocks = parseBlocks("> quoted\n> more\nplain");
    expect(blocks).toEqual([
      { kind: "quote", text: "quoted\nmore" },
      { kind: "para", text: "plain" },
    ]);
  });

  test("a table with a separator row", () => {
    const blocks = parseBlocks("| a | b |\n|---|---|\n| 1 | 2 |");
    expect(blocks).toEqual([{ kind: "table", rows: [["a", "b"], ["1", "2"]] }]);
  });

  test("a pipe line without a separator stays a paragraph", () => {
    const blocks = parseBlocks("| not a table");
    expect(blocks).toEqual([{ kind: "para", text: "| not a table" }]);
  });
});

describe("parseInline", () => {
  test("plain text passes through", () => {
    expect(parseInline("just words")).toEqual([{ kind: "text", text: "just words" }]);
  });

  test("bold, italic, code and a safe link", () => {
    expect(parseInline("**b**")).toEqual([{ kind: "bold", text: "b" }]);
    expect(parseInline("*i*")).toEqual([{ kind: "italic", text: "i" }]);
    expect(parseInline("`c`")).toEqual([{ kind: "code", text: "c" }]);
    expect(parseInline("[t](https://x.dev)")).toEqual([{ kind: "link", text: "t", href: "https://x.dev" }]);
  });

  test("code wins over bold inside backticks", () => {
    expect(parseInline("`**x**`")).toEqual([{ kind: "code", text: "**x**" }]);
  });

  test("a non-http link stays plain text", () => {
    expect(parseInline("[t](javascript:alert(1))")).toEqual([{ kind: "text", text: "[t](javascript:alert(1))" }]);
  });

  test("mixed content keeps the untouched spans", () => {
    expect(parseInline("a *b* c")).toEqual([
      { kind: "text", text: "a " },
      { kind: "italic", text: "b" },
      { kind: "text", text: " c" },
    ]);
  });

  test("a lone star is not italics", () => {
    expect(parseInline("5 * 3 = 15")).toEqual([{ kind: "text", text: "5 * 3 = 15" }]);
  });
});
