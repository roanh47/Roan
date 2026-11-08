/**
 * Draad-protocol en de minimale store-interface die replicatie nodig heeft.
 *
 * De store is de enige bron van waarheid voor de keten: hij kent de hoogste seq,
 * de id per seq en de events zelf. Replicatie schrijft nooit zelf in de keten en
 * verwacht dat `append` alleen toevoegt: nooit overschrijven, nooit gaten vullen
 * met iets anders dan het event dat op die seq hoort.
 */

/** Eén onveranderlijk event in de keten. */
export interface Event {
  /** Protocolversie van het event zelf. */
  v: 1;
  /** Naam van de keten; events van verschillende ketens worden nooit gemengd. */
  chain: string;
  /** Positie in de keten, 1-gebaseerd en aaneengesloten. */
  seq: number;
  /** Wereldwijd unieke id van dit event. Twee events met dezelfde seq horen dezelfde id te hebben. */
  id: string;
  /** Node die het event heeft gemaakt. */
  node: string;
  /** Unix-tijd in ms. */
  ts: number;
  /** Soort event, vrij te kiezen door de laag erboven. */
  type: string;
  /** Payload; replicatie kijkt er niet in. */
  data: unknown;
}

/** Handshake: "dit ben ik, zoveel heb ik al". */
export interface HelloFrame {
  t: "hello";
  v: 1;
  chain: string;
  node: string;
  /** Hoogste seq die de afzender heeft; 0 betekent een lege keten. */
  haveSeq: number;
}

/** Batch met events, oplopend op seq. */
export interface EventsFrame {
  t: "events";
  events: Event[];
}

/** Eén live event. */
export interface AppendFrame {
  t: "append";
  event: Event;
}

/** Frames die replicatie zelf verstuurt of begrijpt. */
export type Frame = HelloFrame | EventsFrame | AppendFrame;

/** Uitkomst van een append-poging; de store beslist, niet de replicatie. */
export type AppendOutcome =
  | { status: "appended" }
  | { status: "duplicate" }
  | { status: "conflict"; existingId: string };

export type Unsubscribe = () => void;

/**
 * Wat replicatie van de opslag verwacht.
 *
 * Invarianten die de implementatie moet bewaken:
 * - `append` schrijft alleen op `head() + 1` en weigert alles daarbuiten.
 * - `append` overschrijft nooit een bestaand event; zelfde seq + andere id is een conflict.
 * - `subscribe` meldt elke geslaagde append synchroon, in seq-volgorde.
 */
export interface NodeStore {
  /** Id van deze node, gebruikt in hello en in conflictrapporten. */
  readonly nodeId: string;
  /** Naam van de keten die deze store bijhoudt. */
  readonly chain: string;
  /** Hoogste seq in de keten, 0 als de keten leeg is. */
  head(): number;
  /** Id van het event op `seq`, of undefined als die seq niet bestaat. */
  idAt(seq: number): string | undefined;
  /** Of dit event-id al in de keten staat (waar dan ook). */
  has(id: string): boolean;
  /** Events met seq >= `from`, oplopend. `since(0)` geeft de hele keten. */
  since(from: number): Event[];
  /** Voegt toe; zie de invarianten hierboven. */
  append(event: Event): AppendOutcome;
  /** Luistert naar lokale appends; geeft een functie om te stoppen. */
  subscribe(listener: (event: Event) => void): Unsubscribe;
}

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Hard conflict: dezelfde seq, een andere id. Beide kanten hebben hun eigen
 * event al in hun keten staan. Er wordt niet gekozen; de sessie stopt.
 */
export interface ConflictReport {
  kind: "seq-id-mismatch";
  chain: string;
  seq: number;
  localNode: string;
  remoteNode: string;
  localId: string;
  remoteId: string;
}

/**
 * Transport naar één peer. De implementatie serialiseert zelf (JSON) en levert
 * binnenkomende tekst aan `onMessage`. Replicatie kent geen sockets.
 */
export interface PeerTransport {
  /** Leesbare naam voor logs, bijvoorbeeld "ws://host:1234". */
  readonly label: string;
  send(frame: Frame): void;
  close(reason?: string): void;
  onMessage(handler: (raw: string) => void): void;
  onClose(handler: (reason?: string) => void): void;
}
