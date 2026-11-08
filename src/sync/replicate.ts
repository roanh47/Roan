import type {
  AppendOutcome,
  ConflictReport,
  Event,
  Frame,
  Logger,
  NodeStore,
  PeerTransport,
} from "./types.js";

/** Aantal events per `events`-frame; houdt frames behapbaar op een langzame lijn. */
const SEND_BATCH = 200;
/** Hoeveel van peers ontvangen id's we onthouden om echo's te dempen. */
const ECHO_MEMORY = 2048;
/** Bovengrens aan events die op een ontbrekende seq wachten. */
const MAX_PENDING = 10_000;

export type ReplicationStatus = "idle" | "live" | "conflicted" | "failed" | "closed";

export type SyncErrorCode =
  | "bad-frame"
  | "chain-mismatch"
  | "version-mismatch"
  | "invalid-event"
  | "store-hole";

export class SyncError extends Error {
  constructor(
    readonly code: SyncErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SyncError";
  }
}

export interface ReplicateOptions {
  store: NodeStore;
  transport: PeerTransport;
  logger: Logger;
  /** Wordt één keer aangeroepen bij het eerste harde conflict. */
  onConflict?: (report: ConflictReport) => void;
  /** Protocolfouten die niet over inhoud gaan (verkeerde keten, kapot frame). */
  onError?: (error: SyncError) => void;
}

type Parsed =
  | { kind: "frame"; frame: Frame }
  | { kind: "foreign"; t: string }
  | { kind: "bad"; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEvent(value: unknown): value is Event {
  if (!isRecord(value)) return false;
  const seq = value["seq"];
  return (
    value["v"] === 1 &&
    typeof value["chain"] === "string" &&
    typeof seq === "number" &&
    Number.isInteger(seq) &&
    seq >= 1 &&
    typeof value["id"] === "string" &&
    value["id"].length > 0 &&
    typeof value["node"] === "string" &&
    typeof value["ts"] === "number" &&
    typeof value["type"] === "string"
  );
}

function parseFrame(raw: string): Parsed {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { kind: "bad", reason: "geen geldige JSON" };
  }
  if (!isRecord(value)) return { kind: "bad", reason: "frame is geen object" };

  const t = value["t"];
  if (t === "hello") {
    const chain = value["chain"];
    const node = value["node"];
    const haveSeq = value["haveSeq"];
    if (value["v"] !== 1) return { kind: "bad", reason: "hello met onbekende versie" };
    if (typeof chain !== "string" || typeof node !== "string") {
      return { kind: "bad", reason: "hello zonder chain of node" };
    }
    if (typeof haveSeq !== "number" || !Number.isInteger(haveSeq) || haveSeq < 0) {
      return { kind: "bad", reason: "hello met ongeldige haveSeq" };
    }
    return { kind: "frame", frame: { t: "hello", v: 1, chain, node, haveSeq } };
  }

  if (t === "events") {
    const events = value["events"];
    if (!Array.isArray(events)) return { kind: "bad", reason: "events zonder lijst" };
    const parsed: Event[] = [];
    for (const rawEvent of events) {
      const item: unknown = rawEvent;
      if (!isEvent(item)) return { kind: "bad", reason: "events bevat een ongeldig event" };
      parsed.push(item);
    }
    return { kind: "frame", frame: { t: "events", events: parsed } };
  }

  if (t === "append") {
    const event = value["event"];
    if (!isEvent(event)) return { kind: "bad", reason: "append zonder geldig event" };
    return { kind: "frame", frame: { t: "append", event } };
  }

  if (typeof t === "string") return { kind: "foreign", t };
  return { kind: "bad", reason: "frame zonder type" };
}

/**
 * Replicatie van één keten naar één peer.
 *
 * Werking:
 * 1. Beide kanten sturen bij het starten een `hello` met hun hoogste seq.
 * 2. Wie achterloopt laat dat weten door (opnieuw) een `hello` te sturen; wie
 *    voorloopt antwoordt daarop met de events die de ander mist. Een expliciet
 *    request-frame is dus niet nodig: de hello is het verzoek.
 * 3. Bij gelijke seq stuurt de voorlopende kant één overlap-event (de anchor).
 *    Heeft de ander daar een andere id, dan is dat een hard conflict.
 * 4. Losse `append`-frames houden daarna de live gang erin.
 */
export class ReplicationSession {
  private statusValue: ReplicationStatus = "idle";
  private peerNode: string | undefined;
  /** Hoogste seq waarvan we weten dat de peer hem heeft. */
  private lastSentSeq = 0;
  private readonly pending = new Map<number, Event>();
  /** Ids die we van deze peer kregen; voorkomt dat we ze terugsturen. */
  private readonly remoteIds = new Set<string>();
  private readonly requested = new Set<string>();
  private readonly conflictList: ConflictReport[] = [];
  private readonly unsubscribe: () => void;
  private closed = false;

  constructor(private readonly opts: ReplicateOptions) {
    this.unsubscribe = opts.store.subscribe((event) => this.onLocalEvent(event));
    opts.transport.onMessage((raw) => this.handleRaw(raw));
    opts.transport.onClose((reason) => this.handleClose(reason));
  }

  get status(): ReplicationStatus {
    return this.statusValue;
  }

  get conflicts(): readonly ConflictReport[] {
    return this.conflictList;
  }

  /** Aantal events dat op een ontbrekende seq wacht. */
  get buffered(): number {
    return this.pending.size;
  }

  /** Stuurt de eerste hello. Idempotent; nog een keer aanroepen is een nieuw verzoek. */
  start(): this {
    this.sendHello("start");
    return this;
  }

  close(reason = "local"): void {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe();
    this.pending.clear();
    if (this.statusValue !== "conflicted") this.statusValue = "closed";
    this.opts.transport.close(reason);
  }

  // --- inkomend ---------------------------------------------------------

  private handleRaw(raw: string): void {
    if (this.statusValue === "conflicted" || this.statusValue === "failed" || this.closed) return;

    const parsed = parseFrame(raw);
    if (parsed.kind === "bad") {
      this.fail(new SyncError("bad-frame", `ongeldig frame van ${this.opts.transport.label}: ${parsed.reason}`));
      return;
    }
    if (parsed.kind === "foreign") {
      // tool_req/tool_res en alles wat niet van replicatie is, laten we met rust.
      this.opts.logger.debug("vreemd frame genegeerd", { t: parsed.t, peer: this.opts.transport.label });
      return;
    }

    const frame = parsed.frame;
    if (frame.t === "hello") {
      this.onHello(frame);
      return;
    }
    if (frame.t === "events") {
      this.markLive();
      for (const event of frame.events) {
        if (!this.applyRemote(event)) break;
      }
      return;
    }
    this.markLive();
    this.applyRemote(frame.event);
  }

  /**
   * Een peer die later aansluit krijgt geen hello terug maar direct events;
   * ook dan is de handshake klaar en loopt de sessie.
   */
  private markLive(): void {
    if (this.statusValue !== "idle") return;
    this.statusValue = "live";
    this.opts.logger.debug("sessie live", { peer: this.opts.transport.label });
  }

  private onHello(frame: Extract<Frame, { t: "hello" }>): void {
    if (frame.v !== 1) {
      this.fail(new SyncError("version-mismatch", `peer ${frame.node} spreekt protocol ${frame.v}`));
      return;
    }
    if (frame.chain !== this.opts.store.chain) {
      this.fail(
        new SyncError(
          "chain-mismatch",
          `peer ${frame.node} stuurt keten "${frame.chain}", wij hebben "${this.opts.store.chain}"`,
        ),
      );
      return;
    }
    if (frame.node === this.opts.store.nodeId) {
      this.opts.logger.warn("hello van onszelf genegeerd", { peer: this.opts.transport.label });
      return;
    }

    this.peerNode = frame.node;
    this.statusValue = "live";
    const local = this.opts.store.head();

    if (frame.haveSeq > local) {
      // Peer loopt voor: vraag de ontbrekende events op met een nieuwe hello.
      // De sleutel voorkomt dat we bij elke herhaalde hello opnieuw gaan vragen.
      const key = `${frame.node}:${frame.haveSeq}:${local}`;
      this.opts.logger.info("peer loopt voor; ontbrekende events opgevraagd", {
        peer: frame.node,
        peerSeq: frame.haveSeq,
        localSeq: local,
      });
      this.lastSentSeq = Math.max(this.lastSentSeq, frame.haveSeq);
      if (!this.requested.has(key)) {
        this.requested.add(key);
        this.sendHello("catch-up");
      }
      return;
    }

    // Peer loopt achter of gelijk: wij sturen wat hij mist. Bij gelijke seq is dat
    // precies één anchor-event, zodat hij een afwijkende id op die seq kan zien.
    this.lastSentSeq = Math.max(this.lastSentSeq, frame.haveSeq);
    this.sendSince(frame.haveSeq);
    this.lastSentSeq = Math.max(this.lastSentSeq, this.opts.store.head());
  }

  /** Returns false als de sessie moet stoppen (conflict of fout). */
  private applyRemote(event: Event): boolean {
    if (this.statusValue === "conflicted" || this.statusValue === "failed" || this.closed) return false;

    if (event.v !== 1) {
      this.fail(new SyncError("invalid-event", `event ${event.id} heeft protocolversie ${event.v}`));
      return false;
    }
    if (event.chain !== this.opts.store.chain) {
      this.fail(
        new SyncError("invalid-event", `event ${event.id} hoort bij keten "${event.chain}"`),
      );
      return false;
    }
    if (this.opts.store.has(event.id)) {
      this.opts.logger.debug("dubbel event genegeerd", { id: event.id, seq: event.seq });
      return true;
    }

    const head = this.opts.store.head();
    if (event.seq > head + 1) {
      if (event.seq > head + MAX_PENDING) {
        this.fail(
          new SyncError(
            "invalid-event",
            `event ${event.id} ligt ${event.seq - head} voor op seq ${head}; dat is geen normale vertraging`,
          ),
        );
        return false;
      }
      this.buffer(event);
      return true;
    }
    if (event.seq === head + 1) {
      const ok = this.appendRemote(event);
      this.flushPending();
      return ok;
    }

    // seq <= head: bestaat er al iets op die plek?
    const existingId = this.opts.store.idAt(event.seq);
    if (existingId === undefined) {
      this.fail(
        new SyncError("store-hole", `store heeft geen event op seq ${event.seq}, maar head is ${head}`),
      );
      return false;
    }
    if (existingId !== event.id) {
      this.reportConflict(event.seq, existingId, event.id, event.node);
      return false;
    }
    this.opts.logger.debug("event was al aanwezig", { id: event.id, seq: event.seq });
    return true;
  }

  private buffer(event: Event): void {
    const queued = this.pending.get(event.seq);
    if (queued !== undefined) {
      if (queued.id !== event.id) {
        // Twee verschillende events voor dezelfde seq, nog voor we konden appenden.
        this.reportConflict(event.seq, queued.id, event.id, event.node);
      }
      return;
    }
    this.pending.set(event.seq, event);
    this.opts.logger.debug("event gebufferd tot het gat dicht is", {
      seq: event.seq,
      head: this.opts.store.head(),
    });
  }

  private appendRemote(event: Event): boolean {
    // Voor de append registreren, zodat de subscribe-callback hem als echo herkent.
    this.rememberRemoteId(event.id);
    const outcome: AppendOutcome = this.opts.store.append(event);
    if (outcome.status === "appended") {
      this.lastSentSeq = Math.max(this.lastSentSeq, event.seq);
      this.opts.logger.debug("event toegepast", { id: event.id, seq: event.seq, node: event.node });
      return true;
    }
    if (outcome.status === "duplicate") {
      this.opts.logger.debug("store noemde event dubbel", { id: event.id });
      return true;
    }
    this.reportConflict(event.seq, outcome.existingId, event.id, event.node);
    return false;
  }

  private flushPending(): void {
    let next = this.opts.store.head() + 1;
    let event = this.pending.get(next);
    while (event !== undefined) {
      this.pending.delete(next);
      if (!this.appendRemote(event)) return;
      next = this.opts.store.head() + 1;
      event = this.pending.get(next);
    }
  }

  // --- uitgaand ---------------------------------------------------------

  private sendHello(reason: string): void {
    const frame: Frame = {
      t: "hello",
      v: 1,
      chain: this.opts.store.chain,
      node: this.opts.store.nodeId,
      haveSeq: this.opts.store.head(),
    };
    this.opts.transport.send(frame);
    this.opts.logger.debug("hello verstuurd", {
      reason,
      haveSeq: frame.haveSeq,
      peer: this.opts.transport.label,
    });
  }

  /** Stuurt alles vanaf `from` (inclusief), in batches. */
  private sendSince(from: number): void {
    const events = this.opts.store.since(Math.max(0, from));
    if (events.length === 0) return;
    for (let i = 0; i < events.length; i += SEND_BATCH) {
      const batch: Frame = { t: "events", events: events.slice(i, i + SEND_BATCH) };
      this.opts.transport.send(batch);
    }
    this.opts.logger.debug("events verstuurd", {
      from,
      count: events.length,
      peer: this.opts.transport.label,
    });
  }

  private onLocalEvent(event: Event): void {
    if (this.statusValue === "conflicted" || this.statusValue === "failed" || this.closed) return;

    if (this.remoteIds.has(event.id)) {
      this.remoteIds.delete(event.id);
      return;
    }

    if (event.seq !== this.lastSentSeq + 1) {
      // De peer mist geschiedenis (of we weten niet beter): stuur de reeks opnieuw
      // in plaats van een los event dat hij toch niet kan plaatsen.
      this.opts.logger.debug("gat in wat de peer heeft; catch-up verstuurd", {
        seq: event.seq,
        peerHas: this.lastSentSeq,
      });
      this.sendSince(this.lastSentSeq);
      this.lastSentSeq = Math.max(this.lastSentSeq, this.opts.store.head());
      return;
    }

    this.lastSentSeq = event.seq;
    this.opts.transport.send({ t: "append", event });
  }

  // --- afsluiten --------------------------------------------------------

  private reportConflict(seq: number, localId: string, remoteId: string, remoteNode: string): void {
    if (this.statusValue === "conflicted") return;
    const report: ConflictReport = {
      kind: "seq-id-mismatch",
      chain: this.opts.store.chain,
      seq,
      localNode: this.opts.store.nodeId,
      remoteNode: this.peerNode ?? remoteNode,
      localId,
      remoteId,
    };
    this.statusValue = "conflicted";
    this.conflictList.push(report);
    this.pending.clear();
    this.opts.logger.error(
      `hard conflict op seq ${seq}: lokale id ${localId}, remote id ${remoteId}; geen kant gekozen`,
      { ...report },
    );
    this.opts.onConflict?.(report);
    this.closed = true;
    this.unsubscribe();
    this.opts.transport.close("conflict");
  }

  private fail(error: SyncError): void {
    if (this.statusValue === "failed" || this.statusValue === "conflicted") return;
    this.statusValue = "failed";
    this.opts.logger.error(error.message, { code: error.code, peer: this.opts.transport.label });
    this.opts.onError?.(error);
    this.pending.clear();
    this.closed = true;
    this.unsubscribe();
    this.opts.transport.close(error.code);
  }

  private handleClose(reason?: string): void {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe();
    this.pending.clear();
    this.statusValue = "closed";
    this.opts.logger.info("verbinding met peer gesloten", {
      reason: reason ?? "onbekend",
      peer: this.opts.transport.label,
    });
  }

  private rememberRemoteId(id: string): void {
    this.remoteIds.add(id);
    if (this.remoteIds.size <= ECHO_MEMORY) return;
    const oldest = this.remoteIds.values().next().value;
    if (typeof oldest === "string") this.remoteIds.delete(oldest);
  }
}

/** Maakt en start een replicatiesessie voor één keten en één peer. */
export function replicate(options: ReplicateOptions): ReplicationSession {
  return new ReplicationSession(options).start();
}
