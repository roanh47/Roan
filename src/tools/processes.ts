import { spawn } from "node:child_process";
import type { Tool } from "../types.js";

/**
 * Background processes: work that keeps running after the tool call returned.
 *
 * `run_shell` waits for its command. A dev server, a long build or a watcher
 * does not fit that, so `process` starts a command, hands back a job number
 * and lets a later call read its output or stop it. A job that finishes is
 * remembered until the next turn hears about it (`takeFinished`), which is how
 * the agent learns that something ended while nobody was looking.
 *
 * Jobs belong to this machine and this daemon run: they are running programs,
 * which is exactly what cannot travel in the chain.
 */

export type JobStatus = "running" | "exited" | "failed" | "stopped";

export interface Job {
  readonly id: number;
  readonly command: string;
  readonly cwd: string;
  readonly status: JobStatus;
  /** Exit code once the process ended; null while it runs or when it was killed. */
  readonly exitCode: number | null;
  /** The tail of stdout and stderr together. */
  readonly output: string;
}

/** The part of a child process the registry uses; a test hands in a fake. */
export interface ChildLike {
  readonly stdout: { on(event: "data", listener: (chunk: Buffer | string) => void): unknown } | null;
  readonly stderr: { on(event: "data", listener: (chunk: Buffer | string) => void): unknown } | null;
  onClose(listener: (code: number | null) => void): void;
  onError(listener: (error: Error) => void): void;
  kill(): void;
}

export type SpawnJob = (command: string, cwd: string) => ChildLike;

export const MAX_RUNNING_JOBS = 8;
export const JOB_OUTPUT_CHARS = 20_000;

const defaultSpawn: SpawnJob = (command, cwd) => {
  const child = spawn("/bin/bash", ["-c", command], { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  return {
    stdout: child.stdout,
    stderr: child.stderr,
    onClose: (listener) => {
      child.on("close", (code) => listener(code));
    },
    onError: (listener) => {
      child.on("error", (error) => listener(error));
    },
    kill: () => {
      // The whole group: a shell that started a server must not leave it behind.
      try {
        if (child.pid !== undefined) process.kill(-child.pid, "SIGTERM");
        else child.kill("SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    },
  };
};

interface JobState {
  id: number;
  command: string;
  cwd: string;
  status: JobStatus;
  exitCode: number | null;
  output: string;
  child: ChildLike;
  reported: boolean;
}

function snapshot(job: JobState): Job {
  return {
    id: job.id,
    command: job.command,
    cwd: job.cwd,
    status: job.status,
    exitCode: job.exitCode,
    output: job.output,
  };
}

export class ProcessRegistry {
  private readonly jobs = new Map<number, JobState>();
  private nextId = 0;

  constructor(private readonly spawnJob: SpawnJob = defaultSpawn) {}

  start(command: string, cwd: string): Job {
    const line = command.trim();
    if (line.length === 0) throw new Error("empty command");
    const running = [...this.jobs.values()].filter((job) => job.status === "running").length;
    if (running >= MAX_RUNNING_JOBS) {
      throw new Error(`${String(MAX_RUNNING_JOBS)} background jobs are already running; stop one first`);
    }
    this.nextId += 1;
    const child = this.spawnJob(line, cwd);
    const job: JobState = {
      id: this.nextId,
      command: line,
      cwd,
      status: "running",
      exitCode: null,
      output: "",
      child,
      reported: false,
    };
    const collect = (chunk: Buffer | string): void => {
      job.output = (job.output + String(chunk)).slice(-JOB_OUTPUT_CHARS);
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    child.onClose((code) => {
      if (job.status === "running") job.status = code === 0 ? "exited" : "failed";
      job.exitCode = code;
    });
    child.onError((error) => {
      if (job.status !== "running") return;
      job.status = "failed";
      collect(`\ncould not start: ${error.message}`);
    });
    this.jobs.set(job.id, job);
    return snapshot(job);
  }

  list(): Job[] {
    return [...this.jobs.values()].map(snapshot);
  }

  get(id: number): Job {
    return snapshot(this.require(id));
  }

  /** Stops a running job. Stopping one that already ended changes nothing. */
  stop(id: number): Job {
    const job = this.require(id);
    if (job.status === "running") {
      job.status = "stopped";
      job.child.kill();
    }
    return snapshot(job);
  }

  /**
   * The jobs that ended since this was last asked, each reported once. A job
   * the owner or the agent stopped on purpose is not news.
   */
  takeFinished(): Job[] {
    const finished: Job[] = [];
    for (const job of this.jobs.values()) {
      if (job.reported || job.status === "running") continue;
      job.reported = true;
      if (job.status !== "stopped") finished.push(snapshot(job));
    }
    return finished;
  }

  private require(id: number): JobState {
    const job = this.jobs.get(id);
    if (job === undefined) throw new Error(`no background job ${String(id)}`);
    return job;
  }
}

function describe(job: Job): string {
  const code = job.exitCode === null ? "" : `, exit ${String(job.exitCode)}`;
  return `${String(job.id)}. [${job.status}${code}] ${job.command}`;
}

/** What the next turn is told about jobs that ended meanwhile, or "". */
export function finishedJobsNote(jobs: readonly Job[]): string {
  if (jobs.length === 0) return "";
  return [
    "# Background jobs that finished since your last turn",
    "",
    ...jobs.map(describe),
    "",
    "Read a job's output with the process tool (action output) before you rely on it.",
  ].join("\n");
}

function jobId(value: unknown): number {
  const id = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(id) || id < 1) throw new Error("id must be the number of a job from the list");
  return id;
}

export function createProcessTool(registry: ProcessRegistry): Tool {
  return {
    name: "process",
    description:
      "Run a command in the background and come back to it: a dev server, a long build, a watcher. " +
      "start returns a job number at once; output reads what it printed so far; stop ends it; list shows all jobs. " +
      "Use run_shell for a command you can simply wait for.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["start", "list", "output", "stop"] },
        command: { type: "string", description: "The shell command, for start" },
        id: { type: "number", description: "Which job, for output and stop" },
        tail: { type: "number", description: "How many characters of output to return, default 4000" },
      },
      required: ["action"],
    },
    async run(args, ctx): Promise<string> {
      const action = String(args["action"] ?? "");
      if (action === "start") {
        const job = registry.start(typeof args["command"] === "string" ? args["command"] : "", ctx.cwd);
        return `started background job ${String(job.id)}: ${job.command}`;
      }
      if (action === "list") {
        const jobs = registry.list();
        return jobs.length === 0 ? "no background jobs" : jobs.map(describe).join("\n");
      }
      if (action === "output") {
        const job = registry.get(jobId(args["id"]));
        const asked = Number(args["tail"]);
        const tail = Number.isFinite(asked) && asked >= 1 ? Math.min(Math.floor(asked), JOB_OUTPUT_CHARS) : 4000;
        const text = job.output.slice(-tail).trim();
        return `${describe(job)}\n${text.length === 0 ? "(no output yet)" : text}`;
      }
      if (action === "stop") return describe(registry.stop(jobId(args["id"])));
      throw new Error("action must be start, list, output or stop");
    },
  };
}
