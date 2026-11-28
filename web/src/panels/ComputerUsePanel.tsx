import { useCallback, useEffect, useState, type ReactElement } from "react";
import type { ChainClient } from "../chain.js";

/**
 * Computer use: letting Roan move the mouse and type on this device.
 *
 * It is off until you allow it, it is allowed for one conversation at a time,
 * and it switches itself off after a few minutes. Stop takes it back at once.
 */
interface ComputerState {
  ok?: boolean;
  available?: boolean;
  reason?: string | null;
  allowed?: boolean;
  expiresAt?: number | null;
  error?: string;
}

const DURATIONS: readonly number[] = [5, 10, 30];

function minutesLeft(expiresAt: number | null | undefined, now: number): number {
  if (typeof expiresAt !== "number") return 0;
  return Math.max(0, Math.ceil((expiresAt - now) / 60_000));
}

export function ComputerUsePanel({
  client,
  session,
  sessionTitle,
}: {
  client: ChainClient;
  session: string | null;
  sessionTitle: string;
}): ReactElement {
  const [state, setState] = useState<ComputerState | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const ask = useCallback(
    (kind: "computer_state" | "computer_allow" | "computer_stop", data: Record<string, unknown> = {}): void => {
      if (session === null) return;
      void client
        .request<ComputerState>(kind, { session, ...data })
        .then((answer) => {
          setState(answer);
          setNow(Date.now());
        })
        .catch(() => setState({ ok: false, error: "could not reach this device's Roan" }));
    },
    [client, session],
  );

  useEffect(() => {
    ask("computer_state");
    const timer = setInterval(() => ask("computer_state"), 15_000);
    return () => clearInterval(timer);
  }, [ask]);

  const allowed = state?.allowed === true;
  const left = minutesLeft(state?.expiresAt, now);

  return (
    <section className="panel">
      <header className="panel__head">
        <h2 className="panel__title">Computer use</h2>
      </header>
      <p className="panel__sub">
        Roan looks at a device's screen and uses its mouse and keyboard. You allow it for one chat, for a few
        minutes, from any of your devices; it switches off by itself.
      </p>

      {session === null ? <p className="panel__status">Open a chat first.</p> : null}
      {state === null && session !== null ? <p className="panel__sub">Checking…</p> : null}
      {state !== null && state.ok !== true ? (
        <p className="panel__status">{state.error ?? "could not read the state"}</p>
      ) : null}

      {state?.ok === true && state.available !== true ? (
        <p className="panel__status">{state.reason ?? "This device cannot be controlled."}</p>
      ) : null}

      {state?.ok === true && state.available === true ? (
        <div className="panel__form">
          <span className="panel__path">{sessionTitle}</span>
          <span className="panel__sub" role="status">
            {allowed
              ? `Allowed for this chat — ${String(left)} ${left === 1 ? "minute" : "minutes"} left.`
              : "Not allowed for this chat."}
          </span>
          {allowed ? (
            <button type="button" className="panel__primary" onClick={() => ask("computer_stop")}>
              Stop now
            </button>
          ) : (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {DURATIONS.map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  className="panel__secondary"
                  onClick={() => ask("computer_allow", { minutes })}
                >
                  Allow for {String(minutes)} minutes
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

export default ComputerUsePanel;
