/**
 * Starting and stopping the local daemon from the app.
 *
 * The app owns the daemon's lifetime: it is not a service and there is no
 * supervisor. Before the app opens its control socket it probes the port; if
 * nothing answers it starts `main.js` detached, waits for the port to come up
 * (five seconds by default) and fails with an error that names the port. The
 * process id is recorded next to the rest of the app's state so `stopDaemon`
 * can end exactly the process that was started, not whatever holds the port
 * today.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import net from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePaths } from "./paths.js";

export const DEFAULT_CONTROL_PORT = 7411;
export const DEFAULT_CONTROL_HOST = "127.0.0.1";

const DEFAULT_WAIT_MS = 5_000;
const DEFAULT_PROBE_TIMEOUT_MS = 500;
const DEFAULT_POLL_INTERVAL_MS = 100;
const DEFAULT_STOP_GRACE_MS = 5_000;
const DEFAULT_KILL_GRACE_MS = 1_000;

/** The control port, honouring the same variable the daemon itself reads. */
export function controlPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env["ROAN_CONTROL_PORT"];
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65_536 ? parsed : DEFAULT_CONTROL_PORT;
}

export function controlHost(env: NodeJS.ProcessEnv = process.env): string {
  return env["ROAN_CONTROL_HOST"] ?? DEFAULT_CONTROL_HOST;
}

export function defaultPidFile(): string {
  return join(resolvePaths().home, "daemon.pid");
}

/** The compiled entry point. `dist/daemon/autostart.js` -> `dist/daemon/main.js`. */
export function defaultEntry(): string {
  return fileURLToPath(new URL("./main.js", import.meta.url));
}

/** A single TCP connect: true when something accepts on host:port. */
export function probePort(host: string, port: number, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const socket = net.createConnection({ host, port });

    const finish = (open: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

export type PortProbe = (host: string, port: number, timeoutMs: number) => Promise<boolean>;

/** The part of a detached child that `ensureDaemon` needs, injectable for tests. */
export interface SpawnedDaemon {
  readonly pid: number | undefined;
  /** Resolves once the process is gone (exit code, or null when signalled/failed). */
  readonly exited: Promise<number | null>;
}

export type DetachedSpawner = (entry: string, env: NodeJS.ProcessEnv) => SpawnedDaemon;

export interface EnsureDaemonOptions {
  readonly port?: number;
  readonly host?: string;
  /** How long the port may take to answer. Default 5000 ms. */
  readonly waitMs?: number;
  readonly probeTimeoutMs?: number;
  readonly pollIntervalMs?: number;
  /** Compiled daemon entry point. Defaults to `main.js` beside this module. */
  readonly entry?: string;
  /** Where the spawned pid is recorded. Defaults to `<ROAN_HOME>/daemon.pid`. */
  readonly pidFile?: string;
  /** Extra variables for the child. The control port is always set. */
  readonly env?: NodeJS.ProcessEnv;
  readonly probe?: PortProbe;
  readonly spawn?: DetachedSpawner;
}

export interface EnsureDaemonResult {
  readonly running: true;
  /** True when this call started the daemon, false when it was already up. */
  readonly started: boolean;
  readonly port: number;
  readonly host: string;
  readonly pid: number | null;
}

export type DaemonErrorCode = "not_listening" | "no_pid_file" | "not_stoppable";

export class DaemonStartError extends Error {
  readonly code: DaemonErrorCode = "not_listening";
  readonly port: number;
  readonly host: string;
  readonly waitedMs: number;

  constructor(port: number, host: string, waitedMs: number, detail?: string) {
    super(
      `roan daemon did not answer on port ${port} (${host}) within ${waitedMs} ms` +
        (detail === undefined ? "" : `: ${detail}`),
    );
    this.name = "DaemonStartError";
    this.port = port;
    this.host = host;
    this.waitedMs = waitedMs;
  }
}

export class DaemonStopError extends Error {
  readonly code: DaemonErrorCode;
  readonly port: number;
  readonly pid: number | null;

  constructor(code: DaemonErrorCode, port: number, pid: number | null, message: string) {
    super(message);
    this.name = "DaemonStopError";
    this.code = code;
    this.port = port;
    this.pid = pid;
  }
}

interface PidRecord {
  readonly pid: number;
  readonly port: number;
}

async function readPidRecord(file: string): Promise<PidRecord | null> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const pid = parsed["pid"];
    const port = parsed["port"];
    if (typeof pid === "number" && Number.isInteger(pid) && pid > 0 && typeof port === "number") {
      return { pid, port };
    }
  } catch {
    // A corrupt pid file is the same as no pid file: we do not guess.
  }
  return null;
}

async function writePidRecord(file: string, record: PidRecord): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(record) + "\n", { encoding: "utf8", mode: 0o600 });
}

async function removePidFile(file: string): Promise<void> {
  try {
    await unlink(file);
  } catch {
    // Already gone.
  }
}

function spawnDetached(entry: string, env: NodeJS.ProcessEnv): SpawnedDaemon {
  const child = spawn(process.execPath, [entry], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env,
  });
  const exited = new Promise<number | null>((resolve) => {
    child.once("exit", (code) => resolve(code));
    child.once("error", () => resolve(null));
  });
  child.unref();
  return { pid: child.pid, exited };
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** True when the pid still exists (or we may not signal it). */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Poll until `check` is true or the deadline passes. */
async function waitFor(check: () => Promise<boolean>, deadline: number, intervalMs: number): Promise<boolean> {
  for (;;) {
    if (await check()) return true;
    if (Date.now() >= deadline) return false;
    await sleep(intervalMs);
  }
}

/**
 * Make sure a daemon is listening on the control port.
 *
 * Returns once the port answers. When nothing is there, the entry point is
 * started detached with the control port in its environment and the caller is
 * expected to use the app, not a terminal. A daemon that never answers is a
 * named `DaemonStartError` whose message includes the port and the wait.
 */
export async function ensureDaemon(options: EnsureDaemonOptions = {}): Promise<EnsureDaemonResult> {
  const port = options.port ?? controlPort();
  const host = options.host ?? controlHost();
  const waitMs = options.waitMs ?? DEFAULT_WAIT_MS;
  const probeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const pidFile = options.pidFile ?? defaultPidFile();
  const probe = options.probe ?? probePort;
  const start = options.spawn ?? spawnDetached;

  if (await probe(host, port, probeTimeoutMs)) {
    const record = await readPidRecord(pidFile);
    return { running: true, started: false, port, host, pid: record?.port === port ? record.pid : null };
  }

  const entry = options.entry ?? defaultEntry();
  if (!existsSync(entry)) {
    throw new DaemonStartError(port, host, 0, `daemon entry not found at ${entry}`);
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...options.env,
    ROAN_CONTROL_PORT: String(port),
  };
  const child = start(entry, env);

  let exited = false;
  let exitCode: number | null = null;
  void child.exited.then((code) => {
    exited = true;
    exitCode = code;
  });

  if (child.pid === undefined) {
    throw new DaemonStartError(port, host, 0, "the daemon process could not be spawned");
  }
  await writePidRecord(pidFile, { pid: child.pid, port });

  const deadline = Date.now() + waitMs;
  const up = await waitFor(() => probe(host, port, probeTimeoutMs), deadline, pollIntervalMs);

  if (!up) {
    const alive = isAlive(child.pid);
    const detail = alive
      ? "the process is running but has not opened the port"
      : exited
        ? `the daemon exited with ${exitCode === null ? "a signal" : `code ${String(exitCode)}`}`
        : "the daemon is no longer running";
    if (!alive) await removePidFile(pidFile);
    throw new DaemonStartError(port, host, waitMs, detail);
  }

  return { running: true, started: true, port, host, pid: child.pid };
}

export interface StopDaemonOptions {
  readonly port?: number;
  readonly host?: string;
  readonly pidFile?: string;
  /** How long SIGTERM gets before SIGKILL. Default 5000 ms. */
  readonly graceMs?: number;
  readonly probeTimeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly probe?: PortProbe;
}

export interface StopDaemonResult {
  /** False when the port was already closed and nothing was signalled. */
  readonly wasRunning: boolean;
  readonly stopped: boolean;
  readonly port: number;
  readonly pid: number | null;
}

/**
 * End the daemon started by `ensureDaemon`: SIGTERM, wait for the port to
 * close, SIGKILL if it does not, and remove the pid file. Refuses to guess a
 * pid — killing whatever happens to hold the port is worse than an error.
 */
export async function stopDaemon(options: StopDaemonOptions = {}): Promise<StopDaemonResult> {
  const port = options.port ?? controlPort();
  const host = options.host ?? controlHost();
  const pidFile = options.pidFile ?? defaultPidFile();
  const graceMs = options.graceMs ?? DEFAULT_STOP_GRACE_MS;
  const probeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const probe = options.probe ?? probePort;

  if (!(await probe(host, port, probeTimeoutMs))) {
    await removePidFile(pidFile);
    return { wasRunning: false, stopped: false, port, pid: null };
  }

  const record = await readPidRecord(pidFile);
  if (record === null || record.port !== port) {
    throw new DaemonStopError(
      "no_pid_file",
      port,
      null,
      `roan daemon is listening on port ${port} but no pid file for it exists at ${pidFile}`,
    );
  }
  const pid = record.pid;
  if (pid === process.pid) {
    throw new DaemonStopError("not_stoppable", port, pid, "refusing to kill the process that is asking");
  }

  const closed = async (): Promise<boolean> => !(await probe(host, port, probeTimeoutMs));

  const signal = (sig: NodeJS.Signals): "sent" | "gone" => {
    try {
      process.kill(pid, sig);
      return "sent";
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ESRCH") return "gone";
      throw err;
    }
  };

  if (signal("SIGTERM") === "sent") {
    if (await waitFor(closed, Date.now() + graceMs, pollIntervalMs)) {
      await removePidFile(pidFile);
      return { wasRunning: true, stopped: true, port, pid };
    }
    signal("SIGKILL");
    if (await waitFor(closed, Date.now() + DEFAULT_KILL_GRACE_MS, pollIntervalMs)) {
      await removePidFile(pidFile);
      return { wasRunning: true, stopped: true, port, pid };
    }
    throw new DaemonStopError(
      "not_stoppable",
      port,
      pid,
      `roan daemon (pid ${pid}) still holds port ${port} after SIGTERM and SIGKILL`,
    );
  }

  // The process was already gone; the port may just have closed.
  if (await waitFor(closed, Date.now() + DEFAULT_KILL_GRACE_MS, pollIntervalMs)) {
    await removePidFile(pidFile);
    return { wasRunning: true, stopped: true, port, pid };
  }
  throw new DaemonStopError("not_listening", port, pid, `roan daemon (pid ${pid}) is gone but port ${port} is still in use`);
}
