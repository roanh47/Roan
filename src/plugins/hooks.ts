/**
 * Plugin hooks: a command a plugin asked to run at a moment the turn reaches.
 *
 * The turn calls `runHooks` once per point and moves on. A hook that exits
 * non-zero, throws or never answers is collected as a failure and the remaining
 * hooks still run: automation is allowed to be broken, but it is never allowed
 * to take the turn down with it.
 *
 * The runner is injected — `(command, stdin) => {exitCode, output}` — so the
 * policy here (order, isolation, timeouts, who sees the payload) is pinned by
 * tests without spawning anything. `src/hooks/run.ts` is the real spawner.
 */

/** The points a hook may attach to. Anything else is ignored, not run. */
export const HOOK_EVENTS = ["turn_start", "turn_end", "before_tool", "after_tool"] as const;

export type HookEvent = (typeof HOOK_EVENTS)[number];

const KNOWN: ReadonlySet<string> = new Set<string>(HOOK_EVENTS);

/** True for a point the agent actually reaches. */
export function isHookEvent(value: string): value is HookEvent {
  return KNOWN.has(value);
}

/** One hook as a plugin declares it. */
export interface Hook {
  readonly id: string;
  /** One of `HOOK_EVENTS`; an unknown value means the hook never runs. */
  readonly event: string;
  readonly command: string;
  /** How long to wait before giving up; defaults to `DEFAULT_HOOK_TIMEOUT_MS`. */
  readonly timeoutMs?: number;
}

/** What a hook command answered. The runner decides how to spawn it. */
export interface HookRunResult {
  readonly exitCode: number;
  readonly output: string;
}

/**
 * Injected runner. `stdin` is the payload as JSON — that is the contract a real
 * runner has to honour, and the reason the payload never travels by argv (a
 * prompt with quotes or newlines would be mangled by a shell).
 */
export type HookRunner = (command: string, stdin: string) => Promise<HookRunResult>;

/** One failure, as a plugin author needs to read it. */
export interface HookFailure {
  readonly id: string;
  readonly error: string;
}

/** What one hook did, whether it worked or not. */
export interface HookOutcome {
  readonly id: string;
  readonly command: string;
  /** The exit code, or null when the hook never produced one. */
  readonly exitCode: number | null;
  readonly output: string;
  /** Present exactly when the hook failed. */
  readonly error?: string;
}

export interface HookReport {
  readonly event: string;
  /** Every hook that ran, in order — including the ones that failed. */
  readonly outcomes: readonly HookOutcome[];
  /** The subset of `outcomes` that failed, as `{id, error}`. */
  readonly failures: readonly HookFailure[];
}

export const DEFAULT_HOOK_TIMEOUT_MS = 30_000;

class HookTimeout extends Error {}

function messageOf(error: unknown): string {
  if (error instanceof HookTimeout) return error.message;
  if (error instanceof Error) return error.message;
  return typeof error === "string" && error.length > 0 ? error : "hook failed";
}

/** A payload is JSON on stdin; `undefined` travels as `null` rather than as nothing. */
function stdinFor(payload: unknown): string {
  return JSON.stringify(payload === undefined ? null : payload) ?? "null";
}

async function runOne(
  hook: Hook,
  stdin: string,
  runner: HookRunner,
  defaultTimeoutMs: number,
): Promise<HookOutcome> {
  const timeoutMs =
    typeof hook.timeoutMs === "number" && Number.isFinite(hook.timeoutMs) && hook.timeoutMs > 0
      ? hook.timeoutMs
      : defaultTimeoutMs;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new HookTimeout(`timed out after ${String(timeoutMs)}ms`)), timeoutMs);
  });

  try {
    const result = await Promise.race([runner(hook.command, stdin), expired]);
    if (typeof result !== "object" || result === null || typeof result.exitCode !== "number") {
      return { id: hook.id, command: hook.command, exitCode: null, output: "", error: "runner returned no exit code" };
    }
    const output = typeof result.output === "string" ? result.output : "";
    if (result.exitCode !== 0) {
      return {
        id: hook.id,
        command: hook.command,
        exitCode: result.exitCode,
        output,
        error: `exited with code ${String(result.exitCode)}`,
      };
    }
    return { id: hook.id, command: hook.command, exitCode: result.exitCode, output };
  } catch (error) {
    return { id: hook.id, command: hook.command, exitCode: null, output: "", error: messageOf(error) };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Runs the hooks that belong to `event`, one at a time, in declaration order.
 *
 * An unknown event runs nothing — including hooks that attach to a point the
 * agent does not have — and is not an error. The returned report lists what ran
 * so the caller can log a failure without the turn failing.
 */
export async function runHooks(
  hooks: readonly Hook[],
  event: string,
  payload: unknown,
  runner: HookRunner,
  defaultTimeoutMs = DEFAULT_HOOK_TIMEOUT_MS,
): Promise<HookReport> {
  const outcomes: HookOutcome[] = [];
  if (!isHookEvent(event)) return { event, outcomes, failures: [] };

  const stdin = stdinFor(payload);
  for (const hook of hooks) {
    if (hook.event !== event) continue;
    // Sequential on purpose: two hooks that write the same file must not race.
    outcomes.push(await runOne(hook, stdin, runner, defaultTimeoutMs));
  }

  const failures = outcomes
    .filter((outcome): outcome is HookOutcome & { readonly error: string } => outcome.error !== undefined)
    .map((outcome) => ({ id: outcome.id, error: outcome.error }));

  return { event, outcomes, failures };
}
