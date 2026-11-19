import { describe, expect, it } from "vitest";

import { shellClassName } from "./shell";

describe("the status-bar floors belong to the shells only", () => {
  it("a Tauri shell gets the class", () => {
    expect(shellClassName({ tauriInternals: true, hostname: "tauri.localhost" })).toBe("app-shell");
  });

  it("the Android shell's origin gets the class even without the internals flag", () => {
    expect(shellClassName({ tauriInternals: false, hostname: "tauri.localhost" })).toBe("app-shell");
  });

  it("a plain browser never gets the class — no dead strip at the top", () => {
    expect(shellClassName({ tauriInternals: false, hostname: "roan.roanheemstra.nl" })).toBe("");
    expect(shellClassName({ tauriInternals: false, hostname: "localhost" })).toBe("");
  });
});
