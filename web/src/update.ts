/**
 * Updating through the GitHub releases.
 *
 * The same bundle also runs in the browser (`scripts/webui.mjs`), where no
 * Tauri API exists. So everything is loaded only once the app really runs in a
 * Tauri window, and the button in the browser says honestly that updating is
 * not possible there.
 */

export interface UpdateInfo {
  readonly version: string;
  readonly notes?: string;
  readonly date?: string;
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

/** Checks whether a newer version is up in the release feed. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!runsInApp()) return null;
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  if (!update) return null;
  return {
    version: update.version,
    notes: update.body ?? undefined,
    date: update.date,
  };
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
