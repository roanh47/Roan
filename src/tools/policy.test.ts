import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { decide, defaultPolicy, pathAccessViolation, type Policy } from "./policy.js";

let workspace = "";

before(() => {
  workspace = mkdtempSync(path.join(tmpdir(), "roan-policy-"));
  writeFileSync(path.join(workspace, "notes.txt"), "hello\n");
});

after(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function policy(fullDisk: boolean): Policy {
  return {
    tools: { read_file: "allow", write_file: "ask", apply_patch: "ask" },
    workspace,
    fullDisk,
  };
}

describe("access.fullDisk off (default)", () => {
  it("keeps the workspace containment rule", () => {
    const verdict = decide(policy(false), "read_file", { path: path.join(workspace, "notes.txt") });
    assert.equal(verdict.decision, "allow");
  });

  it("denies a path outside the workspace and names access.fullDisk", () => {
    const verdict = decide(policy(false), "read_file", { path: "/etc/hostname" });
    assert.equal(verdict.decision, "deny");
    assert.match(verdict.reason, /access\.fullDisk/);
    assert.match(verdict.reason, /escapes the workspace/);
  });

  it("still denies traversal and absolute escapes for a write tool", () => {
    for (const target of ["../outside.txt", "/tmp/outside.txt"]) {
      const verdict = decide(policy(false), "write_file", { path: target });
      assert.equal(verdict.decision, "deny", target);
      assert.match(verdict.reason, /access\.fullDisk/);
    }
  });

  it("is the default of defaultPolicy", () => {
    const built = defaultPolicy(workspace);
    assert.equal(built.fullDisk, false);
    assert.equal(defaultPolicy(workspace, { fullDisk: true }).fullDisk, true);
    assert.equal(decide(built, "read_file", { path: "/etc/hostname" }).decision, "deny");
  });
});

describe("access.fullDisk on", () => {
  it("allows reads outside the workspace", () => {
    const verdict = decide(policy(true), "read_file", { path: "/etc/hostname" });
    assert.equal(verdict.decision, "allow");
  });

  it("allows writes outside the workspace, still asking per policy", () => {
    const verdict = decide(policy(true), "write_file", { path: "/tmp/roan-outside-probe.txt" });
    assert.equal(verdict.decision, "ask");
  });

  it("keeps the workspace rules for paths inside it", () => {
    assert.equal(decide(policy(true), "read_file", { path: "notes.txt" }).decision, "allow");
  });

  it("refuses process and kernel memory", () => {
    for (const target of ["/proc/self/mem", "/proc/1/mem", "/proc/kcore", "/proc/kallsyms"]) {
      const verdict = decide(policy(true), "read_file", { path: target });
      assert.equal(verdict.decision, "deny", target);
      assert.match(verdict.reason, /memory/i, target);
    }
  });

  it("refuses device nodes", () => {
    for (const target of ["/dev/sda", "/dev/null"]) {
      const verdict = decide(policy(true), "read_file", { path: target });
      assert.equal(verdict.decision, "deny", target);
      assert.match(verdict.reason, /device node/, target);
    }
    const memory = decide(policy(true), "read_file", { path: "/dev/mem" });
    assert.equal(memory.decision, "deny");
    assert.match(memory.reason, /memory/i);
  });

  it("refuses writes into /boot and /sys but allows reading them", () => {
    for (const target of ["/boot/grub/grub.cfg", "/sys/kernel/mm/transparent_hugepage/enabled"]) {
      const write = decide(policy(true), "write_file", { path: target });
      assert.equal(write.decision, "deny", target);
      assert.match(write.reason, /never writable/, target);

      const read = decide(policy(true), "read_file", { path: target });
      assert.equal(read.decision, "allow", target);
    }
  });

  it("still refuses protected directories and .pem files anywhere", () => {
    for (const target of [
      "/home/someone/.ssh/id_rsa",
      "/home/someone/project/secrets/token.txt",
      "/home/someone/.gnupg/private.key",
      "/tmp/certificate.pem",
    ]) {
      const verdict = decide(policy(true), "read_file", { path: target });
      assert.equal(verdict.decision, "deny", target);
    }
  });

  it("exposes the same verdict through pathAccessViolation", () => {
    assert.equal(pathAccessViolation(policy(true), "/etc/hostname", false), null);
    assert.match(pathAccessViolation(policy(false), "/etc/hostname", false) ?? "", /access\.fullDisk/);
    assert.match(pathAccessViolation(policy(true), "/boot/vmlinuz", true) ?? "", /never writable/);
  });
});
