/**
 * Pure-data description of the Android foreground service that keeps the
 * chain sync alive. No platform calls: the Kotlin side reads this plan and
 * translates it into a real `Service.startForeground(...)`.
 */

/** Channel the sync notification lives on; must match `^[a-z0-9_]+$`. */
export const SYNC_CHANNEL_ID = "roan_chain_sync";

/** Fixed notification id, so a new start replaces the old notification. */
export const SYNC_NOTIFICATION_ID = 1001;

/** Jitter as a fraction of the backoff, against a thundering reconnect herd. */
const RECONNECT_JITTER_RATIO = 0.2;

/** Ways the service can be started. */
export type StartAction = "chain-changed" | "manual-refresh" | "boot" | "network-available";

/** Retry policy for the connection; values are milliseconds. */
export interface SyncRetryPolicy {
  baseMs: number;
  maxMs: number;
  jitterRatio: number;
}

/** Everything the native side needs to set up the service. */
export interface SyncServicePlan {
  serviceName: string;
  foregroundServiceType: "dataSync";
  channelId: string;
  notification: {
    /** Title with `{}` placeholders, filled in order by the native side. */
    titleTemplate: string;
    /** Body with `{}` placeholders, filled in order by the native side. */
    bodyTemplate: string;
  };
  /** Intent action per start route, exactly as on the wire. */
  startActions: Record<StartAction, string>;
  /** Intent action to stop the service again. */
  stopAction: string;
  wakeLockTag: string;
  retry: SyncRetryPolicy;
}

/** Input for {@link buildSyncServicePlan}. */
export interface SyncServicePlanInput {
  serviceName: string;
  channelId: string;
  reconnectBaseMs: number;
  reconnectMaxMs: number;
}

/** One dot segment of a Java package/class name: starts with a letter or `_`. */
const SEGMENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Android channel ids are deliberately dull: lower-case, digits, underscore. */
const CHANNEL_ID = /^[a-z0-9_]+$/;

function assertServiceName(serviceName: string): void {
  const trimmed = serviceName.trim();
  if (trimmed.length === 0) {
    throw new Error('sync service: field "serviceName" must not be empty');
  }
  const segments = trimmed.split(".");
  const qualified = segments.length >= 2 && segments.every((part) => SEGMENT.test(part));
  if (!qualified) {
    throw new Error(
      `sync service: field "serviceName" must be a dot-qualified name, got "${serviceName}"`,
    );
  }
}

function assertChannelId(channelId: string): void {
  if (!CHANNEL_ID.test(channelId)) {
    throw new Error(
      `sync service: field "channelId" must match ${CHANNEL_ID.source}, got "${channelId}"`,
    );
  }
}

function assertRetry(reconnectBaseMs: number, reconnectMaxMs: number): void {
  if (!Number.isFinite(reconnectBaseMs) || reconnectBaseMs < 1_000) {
    throw new Error(
      `sync service: field "reconnectBaseMs" must be a finite number >= 1000, got ${String(reconnectBaseMs)}`,
    );
  }
  if (!Number.isFinite(reconnectMaxMs) || reconnectMaxMs < reconnectBaseMs) {
    throw new Error(
      `sync service: field "reconnectMaxMs" must be a finite number >= reconnectBaseMs (${reconnectBaseMs}), got ${String(reconnectMaxMs)}`,
    );
  }
}

/**
 * Builds the service plan. Throws an `Error` that names the offending field
 * as soon as a value is wrong.
 */
export function buildSyncServicePlan(input: SyncServicePlanInput): SyncServicePlan {
  const { serviceName, channelId, reconnectBaseMs, reconnectMaxMs } = input;

  assertServiceName(serviceName);
  assertChannelId(channelId);
  assertRetry(reconnectBaseMs, reconnectMaxMs);

  return {
    serviceName: serviceName.trim(),
    foregroundServiceType: "dataSync",
    channelId,
    notification: {
      titleTemplate: "Roan — sync actief",
      bodyTemplate: "{} keten-updates in de wachtrij",
    },
    startActions: {
      "chain-changed": "com.roan.action.CHAIN_CHANGED",
      "manual-refresh": "com.roan.action.MANUAL_REFRESH",
      boot: "com.roan.action.BOOT",
      "network-available": "com.roan.action.NETWORK_AVAILABLE",
    },
    stopAction: "com.roan.action.STOP_SYNC",
    wakeLockTag: `${serviceName.trim()}:chain-sync`,
    retry: {
      baseMs: reconnectBaseMs,
      maxMs: reconnectMaxMs,
      jitterRatio: RECONNECT_JITTER_RATIO,
    },
  };
}
