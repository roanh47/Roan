import { useEffect, useState, type ReactElement } from "react";
import {
  appVersion,
  checkForUpdate,
  describeUpdateCheck,
  installUpdate,
  runsInApp,
  type UpdateCheck,
} from "../update";

/**
 * Version and updating, in the settings.
 *
 * In the browser it only shows which version was built; the button shows up
 * only once the app really runs as an app, because that is the only place an
 * update can land. The message under the button is the check's own conclusion:
 * "newest" and "could not reach the feed" are different sentences, and a failed
 * check clears any earlier update button rather than leaving a stale offer.
 */
/** The minimum of the control client this card needs; the app passes the real one. */
export interface UpdateDaemon {
  request<T = unknown>(kind: string, data?: Record<string, unknown>): Promise<T>;
}

interface DaemonCheck {
  check?: { kind?: string; version?: string; current?: string; latest?: string; notes?: string; reason?: string };
  plan?: { action?: string; notes?: string[] };
  download?: { ok?: boolean; path?: string; reason?: string } | null;
}

export function UpdateCard({ daemon }: { daemon?: UpdateDaemon } = {}): ReactElement {
  const [version, setVersion] = useState<string | null>(null);
  const [check, setCheck] = useState<UpdateCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void appVersion().then((value) => {
      if (live) setVersion(value);
    });
    return () => {
      live = false;
    };
  }, []);

  async function controleren(): Promise<void> {
    setBusy(true);
    setInstallError(null);
    setProgress(null);
    try {
      // The daemon asks the release on this platform; without a client the card
      // falls back to the shell's own updater.
      if (daemon !== undefined) {
        const answer = await daemon.request<DaemonCheck>("update_check");
        const kind = answer.check?.kind;
        if (kind === "update") {
          setCheck({
            status: "available",
            update: {
              version: String(answer.check?.latest ?? ""),
              ...(typeof answer.check?.notes === "string" ? { notes: answer.check.notes } : {}),
            },
          });
        } else if (kind === "current") {
          setCheck({ status: "newest" });
        } else {
          setCheck({ status: "unreachable", reason: String(answer.check?.reason ?? "the release could not be read") });
        }
        return;
      }
      setCheck(await checkForUpdate());
    } finally {
      setBusy(false);
    }
  }

  async function installeren(): Promise<void> {
    if (check?.status !== "available") return;

    setBusy(true);
    setInstallError(null);
    try {
      if (daemon !== undefined) {
        setProgress("Downloading...");
        const answer = await daemon.request<DaemonCheck>("update_download");
        const notes = answer.plan?.notes ?? [];
        if (answer.download?.ok === true) {
          setProgress(`Downloaded to ${String(answer.download.path ?? "")}`);
        } else {
          const reason = answer.download?.reason ?? (notes.join("; ") || "unknown reason");
          setInstallError("Download failed: " + String(reason));
        }
        setBusy(false);
        return;
      }
      await installUpdate((done, total) => {
        const mb = (n: number): string => (n / 1_048_576).toFixed(1);
        setProgress(total === null ? `${mb(done)} MB` : `${mb(done)} of ${mb(total)} MB`);
      });
    } catch (error: unknown) {
      setInstallError("Install failed: " + (error instanceof Error ? error.message : String(error)));
      setBusy(false);
      setProgress(null);
    }
  }

  const statusText = check === null ? null : describeUpdateCheck(check);

  return (
    <div className="panel__group">
      <h3 className="panel__subtitle">App</h3>
      <p className="panel__hint">
        {version === null ? "This version runs in the browser; updating goes through the app." : `Version ${version}`}
      </p>

      {runsInApp() || daemon !== undefined ? (
        <div className="panel__row">
          <button className="button" type="button" onClick={() => void controleren()} disabled={busy}>
            {busy && progress === null ? "Working..." : "Check for updates"}
          </button>
          {check?.status === "available" ? (
            <button className="button button--primary" type="button" onClick={() => void installeren()} disabled={busy}>
              {busy ? (progress ?? "Installing...") : `Update to ${check.update.version}`}
            </button>
          ) : null}
        </div>
      ) : null}

      {statusText !== null ? (
        <p className="panel__hint" role="status">
          {statusText}
        </p>
      ) : null}
      {check?.status === "available" && check.update.notes ? (
        <p className="panel__hint">{check.update.notes}</p>
      ) : null}
      {installError !== null ? <p className="panel__hint">{installError}</p> : null}
    </div>
  );
}
