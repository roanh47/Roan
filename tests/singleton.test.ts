import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  DaemonAlreadyRunningError,
  DaemonLock,
  DAEMON_LOCK_FILE,
  daemonLockPath,
} from "../src/daemon/singleton.js";

function tempWorkspace(): string {
  return mkdtempSync(join(tmpdir(), "roan-daemon-lock-"));
}

function readRecord(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function capture(fn: () => unknown): unknown {
  try {
    fn();
    return null;
  } catch (err) {
    return err;
  }
}

/** A pid that existed in this process tree but is now gone. */
async function exitedPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
  const pid = child.pid;
  if (pid === undefined) throw new Error("child never started");
  await once(child, "exit");
  return pid;
}

function writeRecord(path: string, record: Record<string, unknown>): void {
  writeFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
}

function ageFile(path: string, ageMs: number): void {
  const when = new Date(Date.now() - ageMs);
  utimesSync(path, when, when);
}

describe("daemonLockPath", () => {
  it("puts daemon.lock inside the workspace", () => {
    assert.equal(DAEMON_LOCK_FILE, "daemon.lock");
    assert.equal(daemonLockPath("/home/roan/.roan/workspace"), "/home/roan/.roan/workspace/daemon.lock");
  });

  it("rejects an empty workspace", () => {
    assert.throws(() => daemonLockPath(""), TypeError);
  });
});

describe("DaemonLock.acquire", () => {
  it("creates workspace/daemon.lock with our pid, host and start time", (t) => {
    const workspace = tempWorkspace();
    t.after(() => rmSync(workspace, { recursive: true, force: true }));

    const acquired = DaemonLock.acquire(workspace, { now: () => 1_700_000_000_000 });
    t.after(() => acquired.release());

    const path = join(workspace, "daemon.lock");
    assert.equal(acquired.path, path);
    assert.equal(acquired.reclaimed, false);
    assert.equal(existsSync(path), true);
    assert.deepEqual(readRecord(path), {
      version: 1,
      pid: process.pid,
      host: hostname(),
      startedAt: 1_700_000_000_000,
    });
    assert.deepEqual(acquired.info, readRecord(path));
  });

  it("creates a missing workspace directory", (t) => {
    const root = tempWorkspace();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const workspace = join(root, "nested", "workspace");

    const acquired = DaemonLock.acquire(workspace);
    t.after(() => acquired.release());

    assert.equal(existsSync(join(workspace, "daemon.lock")), true);
  });

  it("refuses a second acquire while this process holds the lock", (t) => {
    const workspace = tempWorkspace();
    t.after(() => rmSync(workspace, { recursive: true, force: true }));

    const first = DaemonLock.acquire(workspace);
    t.after(() => first.release());
    const before = readFileSync(first.path, "utf8");

    const error = capture(() => DaemonLock.acquire(workspace));

    assert.ok(error instanceof DaemonAlreadyRunningError, String(error));
    assert.equal(error.pid, process.pid);
    assert.equal(error.host, hostname());
    assert.equal(error.lockPath, join(workspace, "daemon.lock"));
    assert.equal(error.startedAt, first.info.startedAt);
    assert.match(error.message, new RegExp(`pid ${process.pid}`));
    assert.ok(error.message.includes(first.path), error.message);
    // The loser must not touch the winner's file.
    assert.equal(readFileSync(first.path, "utf8"), before);
  });

  it("refuses a live pid even when the record is ancient", (t) => {
    const workspace = tempWorkspace();
    t.after(() => rmSync(workspace, { recursive: true, force: true }));
    const path = join(workspace, "daemon.lock");
    writeRecord(path, {
      version: 1,
      pid: process.pid,
      host: hostname(),
      startedAt: 0,
    });
    ageFile(path, 7 * 24 * 60 * 60 * 1000);

    const error = capture(() => DaemonLock.acquire(workspace, { staleMs: 1 }));

    assert.ok(error instanceof DaemonAlreadyRunningError, String(error));
    assert.equal(error.pid, process.pid);
    assert.equal(readRecord(path).pid, process.pid);
  });

  it("reclaims a lock whose pid is gone", async (t) => {
    const workspace = tempWorkspace();
    t.after(() => rmSync(workspace, { recursive: true, force: true }));
    const path = join(workspace, "daemon.lock");
    const deadPid = await exitedPid();
    writeRecord(path, {
      version: 1,
      pid: deadPid,
      host: hostname(),
      startedAt: 1_600_000_000_000,
    });

    const acquired = DaemonLock.acquire(workspace);
    t.after(() => acquired.release());

    assert.equal(acquired.reclaimed, true);
    assert.deepEqual(readRecord(path), acquired.info);
    assert.equal(acquired.info.pid, process.pid);
  });

  it("lets the next daemon in once the first releases", (t) => {
    const workspace = tempWorkspace();
    t.after(() => rmSync(workspace, { recursive: true, force: true }));

    const first = DaemonLock.acquire(workspace, { now: () => 1_000 });
    first.release();
    assert.equal(existsSync(join(workspace, "daemon.lock")), false);

    const second = DaemonLock.acquire(workspace, { now: () => 2_000 });
    t.after(() => second.release());
    assert.equal(second.reclaimed, false);
    assert.equal(second.info.startedAt, 2_000);
  });

  it("refuses a fresh lock from another host", (t) => {
    const workspace = tempWorkspace();
    t.after(() => rmSync(workspace, { recursive: true, force: true }));
    const path = join(workspace, "daemon.lock");
    writeRecord(path, {
      version: 1,
      pid: process.pid,
      host: "some-other-machine",
      startedAt: 1_700_000_000_000,
    });

    const error = capture(() => DaemonLock.acquire(workspace));

    assert.ok(error instanceof DaemonAlreadyRunningError, String(error));
    assert.equal(error.host, "some-other-machine");
  });

  it("reclaims an old lock from another host", (t) => {
    const workspace = tempWorkspace();
    t.after(() => rmSync(workspace, { recursive: true, force: true }));
    const path = join(workspace, "daemon.lock");
    writeRecord(path, {
      version: 1,
      pid: process.pid,
      host: "some-other-machine",
      startedAt: 1_700_000_000_000,
    });
    ageFile(path, 60_000);

    const acquired = DaemonLock.acquire(workspace, { staleMs: 30_000 });
    t.after(() => acquired.release());

    assert.equal(acquired.reclaimed, true);
    assert.equal(acquired.info.host, hostname());
  });

  it("refuses an unreadable lock while it is fresh", (t) => {
    const workspace = tempWorkspace();
    t.after(() => rmSync(workspace, { recursive: true, force: true }));
    const path = join(workspace, "daemon.lock");
    writeFileSync(path, "{ half a rec", "utf8");

    const error = capture(() => DaemonLock.acquire(workspace));

    assert.ok(error instanceof DaemonAlreadyRunningError, String(error));
    assert.equal(error.pid, null);
    assert.equal(error.startedAt, null);
    assert.match(error.message, /too recent to reclaim/);
  });

  it("reclaims an unreadable lock after the grace period", (t) => {
    const workspace = tempWorkspace();
    t.after(() => rmSync(workspace, { recursive: true, force: true }));
    const path = join(workspace, "daemon.lock");
    writeFileSync(path, "{ half a rec", "utf8");
    ageFile(path, 10_000);

    const acquired = DaemonLock.acquire(workspace);
    t.after(() => acquired.release());

    assert.equal(acquired.reclaimed, true);
    assert.deepEqual(readRecord(path), acquired.info);
  });

  it("rejects a malformed pid rather than treating it as a holder", (t) => {
    const workspace = tempWorkspace();
    t.after(() => rmSync(workspace, { recursive: true, force: true }));
    const path = join(workspace, "daemon.lock");
    writeRecord(path, { version: 1, pid: -1, host: hostname(), startedAt: 1 });
    ageFile(path, 10_000);

    const acquired = DaemonLock.acquire(workspace);
    t.after(() => acquired.release());

    assert.equal(acquired.reclaimed, true);
  });
});

describe("DaemonLock.release", () => {
  it("removes the lock file", (t) => {
    const workspace = tempWorkspace();
    t.after(() => rmSync(workspace, { recursive: true, force: true }));
    const acquired = DaemonLock.acquire(workspace);

    acquired.release();

    assert.equal(existsSync(join(workspace, "daemon.lock")), false);
  });

  it("is idempotent", (t) => {
    const workspace = tempWorkspace();
    t.after(() => rmSync(workspace, { recursive: true, force: true }));
    const acquired = DaemonLock.acquire(workspace);

    acquired.release();
    acquired.release();

    assert.equal(existsSync(join(workspace, "daemon.lock")), false);
  });

  it("leaves a lock that another process has since taken", (t) => {
    const workspace = tempWorkspace();
    t.after(() => rmSync(workspace, { recursive: true, force: true }));
    const acquired = DaemonLock.acquire(workspace);
    const path = join(workspace, "daemon.lock");
    // Simulate a reclaim by a newer daemon: same path, different record.
    writeRecord(path, {
      version: 1,
      pid: process.pid,
      host: hostname(),
      startedAt: acquired.info.startedAt + 1,
    });

    acquired.release();

    assert.equal(existsSync(path), true);
    assert.equal(readRecord(path).startedAt, acquired.info.startedAt + 1);
  });
});
