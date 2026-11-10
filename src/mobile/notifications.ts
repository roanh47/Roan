/**
 * Android notification channels for the Roan mobile shell.
 *
 * Channels are plain data so the shell can create them on first launch
 * (`NotificationChannel` in Android terms) and so they stay inspectable and
 * testable without an emulator.
 */

/** Android `NotificationManager.IMPORTANCE_*` levels. */
export type Importance = 0 | 1 | 2 | 3 | 4;

/** Frozen mirror of Android's importance constants. */
export const IMPORTANCE = Object.freeze({
  NONE: 0,
  MIN: 1,
  LOW: 2,
  DEFAULT: 3,
  HIGH: 4,
} as const) satisfies Readonly<Record<string, Importance>>;

export interface NotificationChannel {
  /** Stable Android channel id; must match `^[a-z0-9_]+$`. */
  readonly id: string;
  /** User-visible channel name. */
  readonly name: string;
  readonly importance: Importance;
  /** Shown in Android's channel settings screen. */
  readonly description: string;
  readonly showBadge: boolean;
}

/** Coarse sound/vibration bucket the shell maps to UI wording. */
export type ChannelLevel = "silent" | "quiet" | "normal" | "loud";

const LEVEL_BY_IMPORTANCE: Readonly<Record<Importance, ChannelLevel>> = Object.freeze({
  0: "silent",
  1: "quiet",
  2: "quiet",
  3: "normal",
  4: "loud",
});

/** Channels the app creates on first launch. */
export const CHANNELS: readonly NotificationChannel[] = Object.freeze([
  {
    id: "roan_sync",
    name: "Sync status",
    importance: IMPORTANCE.LOW,
    description: "Background sync progress and completed syncs.",
    showBadge: false,
  },
  {
    id: "roan_turn",
    name: "Turn finished",
    importance: IMPORTANCE.HIGH,
    description: "A turn finished and Roan is waiting for you.",
    showBadge: true,
  },
  {
    id: "roan_approval",
    name: "Tool approval",
    importance: IMPORTANCE.HIGH,
    description: "Roan needs permission before running a tool.",
    showBadge: true,
  },
  {
    id: "roan_errors",
    name: "Errors",
    importance: IMPORTANCE.DEFAULT,
    description: "Failed turns, connection problems and daemon errors.",
    showBadge: true,
  },
]);

/** Channel list flattened to the fields the app shell shows. */
export function describeChannels(): { id: string; name: string; level: string }[] {
  return CHANNELS.map((channel) => ({
    id: channel.id,
    name: channel.name,
    level: LEVEL_BY_IMPORTANCE[channel.importance],
  }));
}

const ID_PATTERN = /^[a-z0-9_]+$/;

/**
 * Checks a channel list and returns every problem found instead of throwing.
 * Use for data coming from JSON or a remote config where a bad list should not
 * crash the app shell.
 */
export function validateChannels(channels: readonly NotificationChannel[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  channels.forEach((channel, index) => {
    const label = channel.id ? `channel "${channel.id}"` : `channel at index ${index}`;

    if (!ID_PATTERN.test(channel.id)) {
      problems.push(`${label}: id must match ${ID_PATTERN.source} (got ${JSON.stringify(channel.id)})`);
    }

    if (seen.has(channel.id)) {
      problems.push(`${label}: duplicate id`);
    }
    seen.add(channel.id);

    if (channel.name.trim() === "") {
      problems.push(`${label}: name is empty`);
    }

    const importance: number = channel.importance;
    if (!Number.isInteger(importance) || importance < 0 || importance > 4) {
      problems.push(`${label}: importance must be an integer 0..4 (got ${String(importance)})`);
    }
  });

  return problems;
}

/** Throws one `Error` listing every problem when the channel list is invalid. */
export function assertValidChannels(channels: readonly NotificationChannel[]): void {
  const problems = validateChannels(channels);
  if (problems.length > 0) {
    throw new Error(
      `Invalid notification channels (${problems.length} problem${problems.length === 1 ? "" : "s"}): ${problems.join("; ")}`,
    );
  }
}
