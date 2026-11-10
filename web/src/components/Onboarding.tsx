import type { ReactElement } from "react";

interface OnboardingProps {
  /** Seeds a fresh chain on this device. */
  onCreate: () => void;
  /** Adopts the chain offered by another device. */
  onJoin: () => void;
  /** A request is in flight; both actions are locked. */
  busy?: boolean;
  /** Shown verbatim when the last attempt failed. */
  error?: string | null;
}

/**
 * First-run screen: there is no chain yet, so the user either starts one here
 * or joins one that already exists on another device. Pure props — the shell
 * owns the socket, the request lifecycle and any persistence.
 */
export function Onboarding({ onCreate, onJoin, busy = false, error = null }: OnboardingProps): ReactElement {
  return (
    <section className="onboarding" aria-labelledby="onboarding-title" aria-busy={busy}>
      <div className="onboarding__card">
        <h1 className="onboarding__title" id="onboarding-title">
          Start a chain
        </h1>
        <p className="onboarding__lede">
          A chain is the shared conversation between your devices. Starting a new one seeds it here, on
          this device, and every other device can then join it. Joining instead adopts the data that
          already lives on the other chain, so this device picks up its history as it is.
        </p>

        <div className="onboarding__actions">
          <button
            className="onboarding__action onboarding__action--primary"
            type="button"
            onClick={onCreate}
            disabled={busy}
            aria-describedby="onboarding-create-hint"
          >
            Start a new chain
          </button>
          <button
            className="onboarding__action"
            type="button"
            onClick={onJoin}
            disabled={busy}
            aria-describedby="onboarding-join-hint"
          >
            Join an existing chain
          </button>
        </div>

        <p className="onboarding__hint" id="onboarding-create-hint">
          Begins empty on this device and invites the others in.
        </p>
        <p className="onboarding__hint" id="onboarding-join-hint">
          Asks the other chain for its data and takes it over.
        </p>

        <p className="onboarding__state" role="status" aria-live="polite">
          {busy ? "Working…" : ""}
        </p>

        {error ? (
          <p className="onboarding__alert" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
