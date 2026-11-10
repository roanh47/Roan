/**
 * Pure-data beschrijving van de Android foreground service die de keten-sync
 * in leven houdt. Geen platformaanroepen: de Kotlin-kant leest dit plan en
 * vertaalt het naar een echte `Service.startForeground(...)`.
 */

/** Kanaal waarop de sync-melding leeft; moet op `^[a-z0-9_]+$` passen. */
export const SYNC_CHANNEL_ID = "roan_chain_sync";

/** Vaste notification-id, zodat een nieuwe start de oude melding vervangt. */
export const SYNC_NOTIFICATION_ID = 1001;

/** Jitter als fractie van de backoff, tegen een dansende reconnect-kudde. */
const RECONNECT_JITTER_RATIO = 0.2;

/** Manieren waarop de service gestart kan worden. */
export type StartAction = "chain-changed" | "manual-refresh" | "boot" | "network-available";

/** Herhaalbeleid voor de verbinding; waarden zijn milliseconden. */
export interface SyncRetryPolicy {
  baseMs: number;
  maxMs: number;
  jitterRatio: number;
}

/** Alles wat de native kant nodig heeft om de service op te zetten. */
export interface SyncServicePlan {
  serviceName: string;
  foregroundServiceType: "dataSync";
  channelId: string;
  notification: {
    /** Titel met `{}`-placeholders, in volgorde gevuld door de native kant. */
    titleTemplate: string;
    /** Body met `{}`-placeholders, in volgorde gevuld door de native kant. */
    bodyTemplate: string;
  };
  /** Intent-actie per startroute, precies zoals op de draad. */
  startActions: Record<StartAction, string>;
  /** Intent-actie om de service weer te stoppen. */
  stopAction: string;
  wakeLockTag: string;
  retry: SyncRetryPolicy;
}

/** Invoer voor {@link buildSyncServicePlan}. */
export interface SyncServicePlanInput {
  serviceName: string;
  channelId: string;
  reconnectBaseMs: number;
  reconnectMaxMs: number;
}

/** Eén punt-segment van een Java-package/klassenaam: begint met letter of `_`. */
const SEGMENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Android-kanaal-id's zijn bewust saai: kleine letters, cijfers, underscore. */
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
 * Bouwt het serviceplan. Gooit een `Error` die het gewraakte veld bij naam
 * noemt zodra een waarde niet klopt.
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
