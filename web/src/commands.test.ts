import { describe, expect, it } from "vitest";
import { BUILTIN_COMMANDS, slashCommands, slashPrefix } from "./commands.js";

describe("slash commands in the composer", () => {
  it("offers the built-ins first, then the chain's own commands", () => {
    const commands = slashCommands([
      { type: "command", data: { name: "review", prompt: "Review this carefully:\n$args" } },
      { type: "command", data: { name: "new", prompt: "shadowed by the built-in" } },
      { type: "command", data: { name: "gone", prompt: "x" } },
      { type: "command", data: { name: "gone", removed: true } },
    ]);
    expect(commands.slice(0, BUILTIN_COMMANDS.length)).toEqual([...BUILTIN_COMMANDS]);
    expect(commands.slice(BUILTIN_COMMANDS.length)).toEqual([
      { name: "review", description: "Review this carefully:" },
    ]);
  });

  it("knows when a draft is a command name still being typed", () => {
    expect(slashPrefix("/")).toBe("");
    expect(slashPrefix("/mo")).toBe("mo");
    expect(slashPrefix("/model ")).toBeNull();
    expect(slashPrefix("/review the parser")).toBeNull();
    expect(slashPrefix("hello /mo")).toBeNull();
    expect(slashPrefix("")).toBeNull();
  });
});
