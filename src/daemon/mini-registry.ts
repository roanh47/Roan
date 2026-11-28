/**
 * The Mini Roans that are working, and the ones that finished.
 *
 * A Mini Roan may be waited for or left to work in the background, and
 * several may run side by side. Either way it is registered here, so the
 * owner can see it work and stop it, and a background one that finishes is
 * told once to the next turn that runs (`takeFinished`), the same way a
 * background job is.
 *
 * A Mini Roan is a running thing on one device: it lives as long as this
 * daemon does. Its result reaches the chain through the conversation that
 * reads it.
 */

export type MiniStatus = "working" | "done" | "failed" | "stopped";

export interface MiniRun {
  readonly id: number;
  readonly task: string;
  readonly status: MiniStatus;
  /** What it did so far, newest last: the tools it used. */
  readonly activity: readonly string[];
  /** Its summary when done, the reason when failed. */
  readonly result: string;
  readonly background: boolean;
}

/** How many Mini Roans may work at the same time. */
export const MAX_WORKING_MINIS = 4;

const ACTIVITY_KEPT = 30;

interface MiniState {
  id: number;
  task: string;
  status: MiniStatus;
  activity: string[];
  result: string;
  background: boolean;
  reported: boolean;
  stop: () => void;
}

/** What a registered run is given: where to report activity, and its stop signal. */
export interface MiniHandle {
  readonly note: (line: string) => void;
  readonly signal: AbortSignal;
}

function snapshot(state: MiniState): MiniRun {
  return {
    id: state.id,
    task: state.task,
    status: state.status,
    activity: [...state.activity],
    result: state.result,
    background: state.background,
  };
}

export class MiniRegistry {
  private readonly runs = new Map<number, MiniState>();
  private nextId = 0;

  /**
   * Starts a Mini Roan. The returned promise settles with its summary; a
   * caller that wants it in the background simply does not wait for it.
   */
  start(
    task: string,
    background: boolean,
    work: (handle: MiniHandle) => Promise<string>,
  ): { readonly id: number; readonly finished: Promise<string> } {
    const working = [...this.runs.values()].filter((run) => run.status === "working").length;
    if (working >= MAX_WORKING_MINIS) {
      throw new Error(`${String(MAX_WORKING_MINIS)} Mini Roans are already working; wait for one to finish`);
    }
    this.nextId += 1;
    const controller = new AbortController();
    const state: MiniState = {
      id: this.nextId,
      task: task.trim(),
      status: "working",
      activity: [],
      result: "",
      background,
      reported: false,
      stop: () => controller.abort(),
    };
    this.runs.set(state.id, state);
    const finished = work({
      note: (line) => {
        state.activity = [...state.activity, line].slice(-ACTIVITY_KEPT);
      },
      signal: controller.signal,
    }).then(
      (summary) => {
        if (state.status === "working") state.status = "done";
        state.result = summary;
        return summary;
      },
      (error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error);
        if (state.status === "working") state.status = "failed";
        state.result = reason;
        throw error instanceof Error ? error : new Error(reason);
      },
    );
    // A background run has nobody waiting; its failure is in the registry.
    if (background) finished.catch(() => undefined);
    return { id: state.id, finished };
  }

  list(): MiniRun[] {
    return [...this.runs.values()].map(snapshot);
  }

  /** Stops one that is working. Stopping one that already ended changes nothing. */
  stop(id: number): MiniRun {
    const state = this.runs.get(id);
    if (state === undefined) throw new Error(`no Mini Roan ${String(id)}`);
    if (state.status === "working") {
      state.status = "stopped";
      state.stop();
    }
    return snapshot(state);
  }

  /** Background runs that ended since this was last asked, each told once. */
  takeFinished(): MiniRun[] {
    const finished: MiniRun[] = [];
    for (const state of this.runs.values()) {
      if (state.reported || state.status === "working") continue;
      state.reported = true;
      if (state.background && state.status !== "stopped") finished.push(snapshot(state));
    }
    return finished;
  }
}

/** What the next turn is told about Mini Roans that finished meanwhile, or "". */
export function finishedMinisNote(runs: readonly MiniRun[]): string {
  if (runs.length === 0) return "";
  return [
    "# Mini Roans that finished in the background",
    "",
    ...runs.map(
      (run) =>
        `## Mini Roan ${String(run.id)} — ${run.status === "done" ? "done" : "failed"}\nTask: ${run.task}\n${run.status === "done" ? "Summary" : "Reason"}: ${run.result}`,
    ),
  ].join("\n\n");
}
