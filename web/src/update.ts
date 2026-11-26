/**
 * Updating through the app's update feed.
 *
 * The same bundle also runs in the browser (`scripts/webui.mjs`), where no
 * Tauri API exists. So everything is loaded only once the app really runs in a
 * Tauri window, and the card says honestly that updating is not possible
 * there.
 *
 * A check has four outcomes, and the first three are deliberately distinct:
 * the browser cannot check, the feed answered "you are current", or the feed
 * answered with a newer version. The fourth is the one this module refuses to
 * hide: the feed could not be read. It carries the reason and is never folded
 * into "newest", because "no update" is not a thing an unreachable feed can
 * tell us.
 */

export interface UpdateInfo {
  readonly version: string;
  readonly notes?: string;
  readonly date?: string;
}

/** What one check for updates concluded. */
export type UpdateCheck =
  | { readonly status: "browser" }
  | { readonly status: "newest" }
  | { readonly status: "available"; readonly update: UpdateInfo }
  | { readonly status: "unreachable"; readonly reason: string };

/** The shape `check()` from the updater plugin returns, narrowed for tests. */
interface FeedUpdate {
  readonly version: string;
  readonly body?: string | null;
  readonly date?: string;
}

/** One call to the feed, injectable so the decision can be tested without Tauri. */
export type UpdateCheckCall = () => Promise<FeedUpdate | null>;

export interface CheckForUpdateOptions {
  /** Overrides the Tauri-window detection in tests. */
  readonly inApp?: boolean;
  /** Overrides the plugin call in tests. */
  readonly check?: UpdateCheckCall;
}

/** True when the UI runs in the desktop or Android app instead of the browser. */
export function runsInApp(): boolean {
  if (typeof window === "undefined") return false;
  const scope = window as unknown as Record<string, unknown>;
  return "__TAURI_INTERNALS__" in scope || "__TAURI__" in scope;
}

/** Version of the app that is running now, or null in the browser. */
export async function appVersion(): Promise<string | null> {
  if (!runsInApp()) return null;
  const { getVersion } = await import("@tauri-apps/api/app");
  return getVersion();
}

/** One short reason from an arbitrary thrown value. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The real check: the updater plugin reads the configured feed endpoints. */
async function pluginCheck(): Promise<FeedUpdate | null> {
  const { check } = await import("@tauri-apps/plugin-updater");
  return check();
}

/**
 * Ask the feed whether a newer build exists.
 *
 * A thrown check (no network, a refused endpoint, a broken feed) becomes
 * `{ status: "unreachable" }` with the reason; it never becomes `newest`.
 * Tests pass `inApp` and `check` to exercise those outcomes without a Tauri
 * window.
 */
export async function checkForUpdate(options: CheckForUpdateOptions = {}): Promise<UpdateCheck> {
  if (!(options.inApp ?? runsInApp())) return { status: "browser" };

  try {
    const found = options.check === undefined ? await pluginCheck() : await options.check();
    if (found === null) return { status: "newest" };
    return {
      status: "available",
      update: {
        version: found.version,
        notes: found.body ?? undefined,
        date: found.date,
      },
    };
  } catch (error) {
    return { status: "unreachable", reason: reasonOf(error) };
  }
}

/** The one sentence the card shows for a check, or null when there is none. */
export function describeUpdateCheck(result: UpdateCheck): string | null {
  switch (result.status) {
    case "browser":
      return null;
    case "newest":
      return "You are on the newest version.";
    case "available":
      return `There is an update: ${result.update.version}`;
    case "unreachable":
      return `Could not reach the update feed (${result.reason}).`;
  }
}

/**
 * Fetches the update, installs it and restarts the app.
 * `onProgress` receives the number of bytes downloaded and the total.
 */
export async function installUpdate(onProgress?: (done: number, total: number | null) => void): Promise<void> {
  if (!runsInApp()) throw new Error("updating is only possible in the app, not in the browser");
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  if (!update) throw new Error("there is no update to install");

  let totaal: number | null = null;
  let gehaald = 0;
  await update.downloadAndInstall((event) => {
    if (event.event === "Started") {
      totaal = event.data.contentLength ?? null;
      onProgress?.(0, totaal);
    } else if (event.event === "Progress") {
      gehaald += event.data.chunkLength;
      onProgress?.(gehaald, totaal);
    }
  });

  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
