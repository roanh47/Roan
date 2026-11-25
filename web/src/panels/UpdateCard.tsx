import { useEffect, useState, type ReactElement } from "react";
import { appVersion, checkForUpdate, installUpdate, runsInApp, type UpdateInfo } from "../update";

/**
 * Version and updating, in the settings.
 *
 * In the browser it only shows which version was built; the button shows up
 * only once the app really runs as an app, because that is the only place an
 * update can land.
 */
export function UpdateCard(): ReactElement {
  const [version, setVersion] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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
    setMessage(null);
    try {
      const found = await checkForUpdate();
      setUpdate(found);
      setMessage(found === null ? "You are on the newest version." : `There is an update: ${found.version}`);
    } catch (error: unknown) {
      setMessage("Check failed: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      setBusy(false);
    }
  }

  async function installeren(): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      await installUpdate((done, total) => {
        const mb = (n: number): string => (n / 1_048_576).toFixed(1);
        setProgress(total === null ? `${mb(done)} MB` : `${mb(done)} of ${mb(total)} MB`);
      });
    } catch (error: unknown) {
      setMessage("Install failed: " + (error instanceof Error ? error.message : String(error)));
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <div className="panel__group">
      <h3 className="panel__subtitle">App</h3>
      <p className="panel__hint">
        {version === null ? "This version runs in the browser; updating goes through the app." : `Version ${version}`}
      </p>

      {runsInApp() ? (
        <div className="panel__row">
          <button className="button" type="button" onClick={() => void controleren()} disabled={busy}>
            {busy && progress === null ? "Working..." : "Check for updates"}
          </button>
          {update !== null ? (
            <button className="button button--primary" type="button" onClick={() => void installeren()} disabled={busy}>
              {busy ? (progress ?? "Installing...") : `Update to ${update.version}`}
            </button>
          ) : null}
        </div>
      ) : null}

      {message !== null ? <p className="panel__hint">{message}</p> : null}
      {update?.notes ? <p className="panel__hint">{update.notes}</p> : null}
    </div>
  );
}
