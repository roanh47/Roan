import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  classifyPlatform,
  elevationStatus,
  escapeSudoersArgument,
  installPolkitRule,
  installSudoers,
  polkitText,
  sudoersText,
  uninstallPolkitRule,
  uninstallSudoers,
  validateCommands,
} from "./install.js";

const COMMANDS = ["/usr/bin/systemctl restart roan-daemon", "/usr/bin/journalctl -u roan-daemon -n 100"];
const ACTIONS = ["org.freedesktop.systemd1.manage-units"];

let root = "";
let sequence = 0;

before(() => {
  root = mkdtempSync(path.join(tmpdir(), "roan-sudo-"));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

function freshDir(): string {
  const dir = path.join(root, `case-${sequence++}`);
  // The install code expects the target directory to exist, exactly like /etc/sudoers.d.
  mkdirSync(dir);
  return dir;
}

describe("sudoers text", () => {
  it("contains exactly the injected allowlist and nothing broader", () => {
    const text = sudoersText(COMMANDS, "roan", "thinkpad");
    assert.ok(
      text.includes(
        "roan thinkpad=(root) NOPASSWD: /usr/bin/systemctl restart roan-daemon, /usr/bin/journalctl -u roan-daemon -n 100",
      ),
      text,
    );
    assert.doesNotMatch(text, /\bALL\b/);
    assert.doesNotMatch(text, /[*?[\]]/);
    assert.equal(text.trim().split("\n").length, 3);
  });

  it("escapes the sudoers special characters in arguments", () => {
    assert.equal(escapeSudoersArgument("/bin/echo a,b:c=d"), "/bin/echo a\\,b\\:c\\=d");
  });

  it("refuses wildcards, relative paths, ALL and negation", () => {
    for (const bad of [
      ["/usr/bin/systemctl restart *"],
      ["systemctl restart roan-daemon"],
      ["/usr/bin/ALL"],
      ["!/usr/bin/true"],
      ["/usr/bin/echo a#b"],
    ]) {
      const checked = validateCommands(bad);
      assert.equal(checked.ok, false, bad.join(" "));
    }
  });

  it("rejects an empty allowlist instead of granting everything", () => {
    assert.equal(validateCommands([]).ok, false);
  });
});

describe("installSudoers", () => {
  it("validates the staged file, then moves it into place at 0440", async () => {
    const dir = freshDir();
    let seen = "";
    let targetExistedDuringValidation = true;

    const result = await installSudoers({
      commands: COMMANDS,
      user: "roan",
      host: "thinkpad",
      sudoersDir: dir,
      validate: async (file) => {
        seen = readFileSync(file, "utf8");
        targetExistedDuringValidation = existsSync(path.join(dir, "roan-elevation"));
        return true;
      },
    });

    assert.deepEqual(result, { ok: true, path: path.join(dir, "roan-elevation") });
    assert.equal(targetExistedDuringValidation, false, "the live file must not exist before visudo passes");
    assert.match(seen, /NOPASSWD: \/usr\/bin\/systemctl restart roan-daemon/);

    const target = path.join(dir, "roan-elevation");
    assert.equal(readFileSync(target, "utf8"), seen);
    assert.equal(statSync(target).mode & 0o777, 0o440);
    assert.deepEqual(readdirSync(dir), ["roan-elevation"], "no temp file may survive a success");
  });

  it("aborts when visudo rejects the file and leaves nothing behind", async () => {
    const dir = freshDir();
    const result = await installSudoers({
      commands: COMMANDS,
      user: "roan",
      host: "thinkpad",
      sudoersDir: dir,
      validate: async () => false,
    });

    assert.equal(result.ok, false);
    assert.match(result.reason ?? "", /visudo rejected/);
    assert.deepEqual(readdirSync(dir), [], "a failed validation must not leave a temp or live file");
  });

  it("does not report the rule text in a validation failure", async () => {
    const dir = freshDir();
    const result = await installSudoers({
      commands: COMMANDS,
      sudoersDir: dir,
      user: "roan",
      host: "thinkpad",
      validate: async () => false,
    });
    assert.doesNotMatch(result.reason ?? "", /systemctl|journalctl|NOPASSWD/);
  });

  it("refuses a traversal file name and a missing directory", async () => {
    const dir = freshDir();
    assert.equal(
      (await installSudoers({ commands: COMMANDS, sudoersDir: dir, filename: "../escape" })).ok,
      false,
    );

    const missing = path.join(root, "does-not-exist");
    const result = await installSudoers({ commands: COMMANDS, sudoersDir: missing, user: "roan" });
    assert.equal(result.ok, false);
    assert.match(result.reason ?? "", /does not exist/);
  });

  it("refuses cleanly on macOS and Android", async () => {
    const mac = await installSudoers({ commands: COMMANDS, platform: "darwin", sudoersDir: freshDir() });
    assert.equal(mac.ok, false);
    assert.match(mac.reason ?? "", /macOS/);

    const android = await installSudoers({ commands: COMMANDS, platform: "linux", android: true, sudoersDir: freshDir() });
    assert.equal(android.ok, false);
    assert.match(android.reason ?? "", /Android/);

    const windows = await installSudoers({ commands: COMMANDS, platform: "win32", sudoersDir: freshDir() });
    assert.match(windows.reason ?? "", /Windows/);
  });
});

describe("uninstallSudoers", () => {
  it("removes only our file", async () => {
    const dir = freshDir();
    const other = path.join(dir, "90-unrelated");
    writeFileSync(other, "someone else\n");

    const installed = await installSudoers({
      commands: COMMANDS,
      user: "roan",
      host: "thinkpad",
      sudoersDir: dir,
      validate: async () => true,
    });
    assert.equal(installed.ok, true);

    const removed = await uninstallSudoers({ sudoersDir: dir });
    assert.equal(removed.ok, true);
    assert.equal(existsSync(path.join(dir, "roan-elevation")), false);
    assert.equal(readFileSync(other, "utf8"), "someone else\n");
  });

  it("is idempotent and says when nothing was installed", async () => {
    const dir = freshDir();
    const result = await uninstallSudoers({ sudoersDir: dir });
    assert.equal(result.ok, true);
    assert.match(result.reason ?? "", /no Roan elevation rule/);
  });
});

describe("polkit", () => {
  it("renders named actions for one user and never pkexec", () => {
    const text = polkitText(ACTIONS, "roan");
    assert.match(text, /org\.freedesktop\.systemd1\.manage-units/);
    assert.match(text, /subject\.user === "roan"/);
    assert.doesNotMatch(text, /policykit\.exec/);
    assert.doesNotMatch(text, /\bALL\b/);
  });

  it("refuses the pkexec action and empty action lists", async () => {
    const exec = await installPolkitRule({
      actions: ["org.freedesktop.policykit.exec"],
      rulesDir: freshDir(),
      user: "roan",
    });
    assert.equal(exec.ok, false);
    assert.match(exec.reason ?? "", /arbitrary program/);

    const empty = await installPolkitRule({ actions: [], rulesDir: freshDir(), user: "roan" });
    assert.equal(empty.ok, false);
  });

  it("installs at 0644, uninstalls only its own file, refuses on Android", async () => {
    const dir = freshDir();
    writeFileSync(path.join(dir, "10-unrelated.rules"), "// keep\n");

    const installed = await installPolkitRule({ actions: ACTIONS, rulesDir: dir, user: "roan" });
    assert.equal(installed.ok, true);
    const target = path.join(dir, "50-roan-elevation.rules");
    assert.equal(statSync(target).mode & 0o777, 0o644);

    const removed = await uninstallPolkitRule({ rulesDir: dir });
    assert.equal(removed.ok, true);
    assert.deepEqual(readdirSync(dir), ["10-unrelated.rules"]);

    const android = await installPolkitRule({
      actions: ACTIONS,
      rulesDir: freshDir(),
      user: "roan",
      android: true,
    });
    assert.match(android.reason ?? "", /Android/);
  });
});

describe("elevationStatus", () => {
  it("reports unsupported on macOS and Android with a reason", () => {
    for (const [input, pattern] of [
      [{ platform: "darwin" }, /macOS/],
      [{ platform: "linux", android: true }, /Android/],
      [{ platform: "win32" }, /Windows/],
    ] as const) {
      const status = elevationStatus(input);
      assert.equal(status.supported, false);
      assert.equal(status.installed, false);
      assert.equal(status.mechanism, "none");
      assert.deepEqual(status.commands, []);
      assert.match(status.reason ?? "", pattern);
    }
  });

  it("reports installed/not installed for the sudoers mechanism", () => {
    const present = elevationStatus({
      platform: "linux",
      sudoersPath: "/etc/sudoers.d/roan-elevation",
      commands: COMMANDS,
      exists: () => true,
    });
    assert.deepEqual(present, {
      supported: true,
      installed: true,
      mechanism: "sudoers",
      commands: COMMANDS,
    });

    const absent = elevationStatus({
      platform: "linux",
      sudoersPath: "/etc/sudoers.d/roan-elevation",
      commands: COMMANDS,
      exists: () => false,
    });
    assert.equal(absent.supported, true);
    assert.equal(absent.installed, false);
  });

  it("can report the polkit mechanism", () => {
    const status = elevationStatus({
      platform: "linux",
      mechanism: "polkit",
      polkitPath: "/etc/polkit-1/rules.d/50-roan-elevation.rules",
      exists: (file) => file.endsWith("50-roan-elevation.rules"),
    });
    assert.equal(status.mechanism, "polkit");
    assert.equal(status.installed, true);
  });
});

describe("classifyPlatform", () => {
  it("detects Android from the platform, the override or Termux env", () => {
    assert.equal(classifyPlatform("android"), "android");
    assert.equal(classifyPlatform("linux", {}, true), "android");
    assert.equal(classifyPlatform("linux", { TERMUX_VERSION: "0.118" }), "android");
    assert.equal(classifyPlatform("linux", { ANDROID_ROOT: "/system" }), "android");
    assert.equal(classifyPlatform("linux", {}), "linux");
    assert.equal(classifyPlatform("darwin"), "macos");
  });

  it("does not mistake another unix for Linux", () => {
    assert.equal(classifyPlatform("freebsd"), "other");
  });
});
