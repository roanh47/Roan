/**
 * Which chrome this page runs in.
 *
 * The native shells (Android app, desktop) draw edge to edge: the system bars
 * overlay the window and Android's WebView reports `env(safe-area-inset-*)`
 * as 0, so the mobile CSS keeps fixed floors to stay below the status bar.
 * A plain browser already sits inside its own chrome — for it those floors
 * are a dead strip at the top of the page. The floors are therefore scoped to
 * `app-shell`, which is only set when a shell is detected.
 */
export function shellClassName(facts: { tauriInternals: boolean; hostname: string }): string {
  return facts.tauriInternals || facts.hostname === "tauri.localhost" ? "app-shell" : "";
}
