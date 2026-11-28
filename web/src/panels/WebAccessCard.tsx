import { useEffect, useState, type ReactElement } from "react";
import type { ChainClient } from "../chain.js";

/**
 * The switch for reaching this device's Roan from outside the app.
 *
 * Open, a browser on this device or on another device in the tailnet can load
 * the UI on the daemon's port. Closed, only this device itself can. The
 * setting belongs to this device and is not shared with the others.
 */
export function WebAccessCard({ client }: { client: ChainClient }): ReactElement {
  const [deviceOnly, setDeviceOnly] = useState<boolean | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void client
      .request<{ deviceOnly?: boolean }>("access")
      .then((answer) => {
        if (alive && typeof answer.deviceOnly === "boolean") setDeviceOnly(answer.deviceOnly);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [client]);

  function change(next: boolean): void {
    setNote(null);
    void client
      .request<{ ok?: boolean; deviceOnly?: boolean; error?: string }>("access", { deviceOnly: next })
      .then((answer) => {
        if (answer.ok === true && typeof answer.deviceOnly === "boolean") setDeviceOnly(answer.deviceOnly);
        else setNote(answer.error ?? "could not change the setting");
      })
      .catch((error: unknown) => setNote(error instanceof Error ? error.message : "could not change the setting"));
  }

  const open = deviceOnly === false;
  return (
    <section className="panel">
      <header className="panel__head">
        <h2 className="panel__title">Access outside the app</h2>
      </header>
      <p className="panel__sub">
        {deviceOnly === null
          ? "Checking…"
          : open
            ? "Open: a browser on this device or on your tailnet can open Roan on port 6769."
            : "Closed: only this device itself can open Roan. Other devices in your tailnet are refused."}
      </p>
      <button
        type="button"
        className="panel__secondary"
        aria-pressed={open}
        disabled={deviceOnly === null}
        onClick={() => change(open)}
      >
        {open ? "Close it to this device only" : "Open it to my tailnet"}
      </button>
      <p className="panel__sub">This setting is for this device only; your other devices keep their own.</p>
      {note !== null ? <p className="panel__status">{note}</p> : null}
    </section>
  );
}

export default WebAccessCard;
