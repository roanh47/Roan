import { useMemo } from "react";
import type { ReactElement } from "react";
import { openTurn } from "../chain";
import type { ChainEvent, PendingMessage } from "../chain";
import { Composer } from "../components/Composer";
import { Transcript } from "../components/Transcript";
import { cssVar, fonts, space } from "../theme";

/**
 * The conversation screen: transcript, one compact status line, composer.
 *
 * It owns no connection and no socket. Everything it shows arrives through
 * props, so it can be rendered against a fixture in a test and dropped into
 * either shell unchanged. The only state it derives is the open turn, which is
 * a pure function of the event list — the same rule the client uses to lock
 * the composer.
 */
export interface ChatScreenProps {
  events: readonly ChainEvent[];
  pending: readonly PendingMessage[];
  /** This device's node name, so the transcript can tell "you" apart. */
  node: string;
  onSend: (text: string) => void;
  /** A turn is open, or the chain cannot take a message right now. */
  disabled: boolean;
}

type Tone = "working" | "ready" | "offline";

interface StatusView {
  tone: Tone;
  headline: string;
  detail: string;
}

function statusOf(
  turn: ReturnType<typeof openTurn>,
  pending: number,
  disabled: boolean,
  node: string,
): StatusView {
  if (turn) {
    return {
      tone: "working",
      headline: `${turn.owner} is working`,
      detail:
        turn.owner === node
          ? "This turn runs on this device. The composer unlocks when it ends."
          : `The turn runs on ${turn.owner}. One turn at a time across the chain.`,
    };
  }
  if (disabled) {
    return {
      tone: "offline",
      headline: "Input locked",
      detail: "The chain cannot take a message right now. The composer stays locked until it can.",
    };
  }
  if (pending > 0) {
    return {
      tone: "working",
      headline: pending === 1 ? "Sending one message" : `Sending ${pending} messages`,
      detail: "Waiting for the daemon to echo them back with a sequence number.",
    };
  }
  return {
    tone: "ready",
    headline: "Ready",
    detail: "Messages you send are appended to the chain for every device to see.",
  };
}

export function ChatScreen({
  events,
  pending,
  node,
  onSend,
  disabled,
}: ChatScreenProps): ReactElement {
  const turn = useMemo(() => openTurn(events), [events]);
  const view = useMemo(
    () => statusOf(turn, pending.length, disabled, node),
    [turn, pending.length, disabled, node],
  );

  const placeholder = turn
    ? `${turn.owner} is working…`
    : disabled
      ? "Waiting for the chain…"
      : "Message Roan";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100dvh",
        minHeight: 0,
        background: cssVar("bg"),
        color: cssVar("fg"),
        fontFamily: fonts.sans,
      }}
    >
      <main
        aria-label="Conversation"
        style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}
      >
        <Transcript events={events} pending={pending} node={node} />
      </main>

      <section
        className="status"
        aria-label="Turn and connection"
        style={{ padding: `0 ${space.lg}px ${space.sm}px` }}
      >
        <p
          className={`status__headline status__headline--${view.tone}`}
          id="turn-status"
          role="status"
          aria-live="polite"
        >
          <span className="status__dot" aria-hidden="true" />
          <span>{view.headline}</span>
        </p>
        <p className="status__detail">{view.detail}</p>
      </section>

      <footer
        style={{
          padding: `${space.xs}px ${space.lg}px calc(${space.sm}px + env(safe-area-inset-bottom))`,
          background: `linear-gradient(to top, ${cssVar("bg")} 65%, transparent)`,
        }}
      >
        <Composer disabled={disabled} placeholder={placeholder} onSend={onSend} />
      </footer>
    </div>
  );
}
