import { useEffect, useState, type ReactElement } from "react";
import type { ChainClient } from "../chain.js";

/**
 * The switch for reaching this device's Roan from outside the app.
 *
 * Open, a browser on a device or on another device in the tailnet can load
 * the UI on the daemon's port. Closed, only the device itself can. Like every
 * setting it is synced: it holds on all your devices.
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
            ? "Open: a browser on a device, or on another device in your tailnet, can open Roan on port 6769."
            : "Closed: each device only opens Roan for itself. Browsers on other devices are refused."}
      </p>
      <button
        type="button"
        className="panel__secondary"
        aria-pressed={open}
        disabled={deviceOnly === null}
        onClick={() => change(open)}
      >
        {open ? "Close it" : "Open it to my tailnet"}
      </button>
      <p className="panel__sub">This applies to all your devices, like every setting.</p>
      {note !== null ? <p className="panel__status">{note}</p> : null}
    </section>
  );
}

export default WebAccessCard;
