/**
 * Bijwerken via de GitHub-releases.
 *
 * Dezelfde bundel draait ook in de browser (`scripts/webui.mjs`), waar geen
 * Tauri-API bestaat. Daarom wordt alles pas geladen als de app echt in een
 * Tauri-venster draait, en zegt de knop in de browser eerlijk dat bijwerken
 * daar niet kan.
 */

export interface UpdateInfo {
  readonly version: string;
  readonly notes?: string;
  readonly date?: string;
}

/** True als de UI in de desktop- of Android-app draait in plaats van de browser. */
export function runsInApp(): boolean {
  if (typeof window === "undefined") return false;
  const scope = window as unknown as Record<string, unknown>;
  return "__TAURI_INTERNALS__" in scope || "__TAURI__" in scope;
}

/** Versie van de app die nu draait, of null in de browser. */
export async function appVersion(): Promise<string | null> {
  if (!runsInApp()) return null;
  const { getVersion } = await import("@tauri-apps/api/app");
  return getVersion();
}

/** Kijkt of er een nieuwere versie in de release-feed staat. */
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
 * Haalt de update op, installeert hem en start de app opnieuw.
 * `onProgress` krijgt het aantal binnengehaalde en het totaal aantal bytes.
 */
export async function installUpdate(onProgress?: (done: number, total: number | null) => void): Promise<void> {
  if (!runsInApp()) throw new Error("bijwerken kan alleen in de app, niet in de browser");
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  if (!update) throw new Error("er is geen update om te installeren");

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
