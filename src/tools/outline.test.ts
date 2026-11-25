import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_OUTLINE_ENTRIES, outline } from "./outline.js";

describe("outline", () => {
  it("recognises the declaration forms with 1-based line numbers", () => {
    const source = [
      "/**",
      " * Module-doc.",
      " */",
      "export class Alpha {}",
      "interface Beta { x: number }",
      "type Gamma = string;",
      "export function delta(): void {}",
      "const epsilon = 1;",
      "let zeta = 2;",
      "export default class Omega {}",
      "export async function eta(): Promise<void> {}",
      "export const theta = 3;",
      "class Inner { method() { const lokaal = 1; } }",
      "export type { Beta as BetaAlias };",
      "",
    ].join("\n");

    assert.deepEqual(outline(source, "sample.ts"), [
      { kind: "class", name: "Alpha", line: 4 },
      { kind: "interface", name: "Beta", line: 5 },
      { kind: "type", name: "Gamma", line: 6 },
      { kind: "function", name: "delta", line: 7 },
      { kind: "const", name: "epsilon", line: 8 },
      { kind: "let", name: "zeta", line: 9 },
      { kind: "class", name: "Omega", line: 10 },
      { kind: "function", name: "eta", line: 11 },
      { kind: "const", name: "theta", line: 12 },
      { kind: "class", name: "Inner", line: 13 },
    ]);
  });

  it("gives an anonymous default export the name default", () => {
    const source = ["export default class {}", "export default function () {}", "export default {}"].join(
      "\n",
    );

    assert.deepEqual(outline(source, "anon.ts"), [
      { kind: "class", name: "default", line: 1 },
      { kind: "function", name: "default", line: 2 },
    ]);
  });

  it("skips hits inside comments", () => {
    const source = [
      "/* export class Hidden {}",
      "   interface AlsoHidden {}",
      "   export function ookWeg() {} */",
      "export class Visible {}",
      "// export class LineHidden {}",
      "const before = 1; /* export class Tail {} */",
      "",
    ].join("\n");

    assert.deepEqual(outline(source, "comments.ts"), [
      { kind: "class", name: "Visible", line: 4 },
      { kind: "const", name: "before", line: 6 },
    ]);
  });

  it("stops at the maximum of 200 entries", () => {
    const lines: string[] = [];
    for (let index = 0; index < 250; index += 1) {
      lines.push(`export const c${index} = ${index};`);
    }

    const entries = outline(lines.join("\n"), "veel.ts");

    assert.equal(entries.length, MAX_OUTLINE_ENTRIES);
    assert.equal(MAX_OUTLINE_ENTRIES, 200);
    assert.deepEqual(entries[0], { kind: "const", name: "c0", line: 1 });
    assert.deepEqual(entries[entries.length - 1], { kind: "const", name: "c199", line: 200 });
  });

  it("ignores indented declarations and nothing in the result is mutated", () => {
    const source = ["class Buiten {", "  const binnen = 1;", "}", ""].join("\n");

    assert.deepEqual(outline(source, "nested.ts"), [{ kind: "class", name: "Buiten", line: 1 }]);
    assert.deepEqual(outline("", "leeg.ts"), []);
  });

  it("throws on a non-string source and names the file and type", () => {
    assert.throws(
      () => outline(42 as unknown as string, "kapot.ts"),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(error.message.includes("kapot.ts"), error.message);
        assert.ok(error.message.includes("number"), error.message);
        return true;
      },
    );
  });
});
