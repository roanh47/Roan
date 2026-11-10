import type {
  Event,
  EventsFrame,
  HelloFrame,
  Logger,
  NodeStore,
  PeerTransport,
} from "./types.js";

/** Events per `events`-frame; klein genoeg voor een langzame lijn, groot genoeg om te werken. */
const DEFAULT_PAGE_SIZE = 200;
/** Harde bovengrens aan `pageSize`, ook als de caller iets groters meegeeft. */
const MAX_PAGE_SIZE = 2_000;
/** Aantal mislukte `send`-pogingen op een pagina voordat we opgeven. */
const MAX_SEND_RETRIES = 2;
/** Wachtijd voor die ene herkansing; er is nooit meer dan één timer. */
const RETRY_DELAY_MS = 1_000;

export type BackfillStatus = "idle" | "sending" | "complete" | "failed" | "stopped";

/** Momentopname van wat de backfill doet; veilig om te loggen of te tonen. */
export interface BackfillProgress {
  status: BackfillStatus;
  /** Laatste `haveSeq` die de peer in een hello noemde. */
  peerHaveSeq: number;
  /** Eerste seq van het huidige plan; 0 als er niets te sturen is. */
  from: number;
  /** Laatste seq van het huidige plan (de lokale head op planmoment); 0 als er niets is. */
  to: number;
  /** Volgende seq die nog de deur uit moet. */
  nextSeq: number;
  /** Hoogste seq die daadwerkelijk op de lijn is gezet. */
  lastSeqSent: number;
  eventsSent: number;
  pagesSent: number;
  /** Telt alleen opeenvolgende mislukte send-pogingen; reset na een geslaagde pagina. */
  retries: number;
  pendingRetry: boolean;
}

export interface BackfillDeps {
  store: NodeStore;
  transport: PeerTransport;
  /** Aantal events per frame; standaard 200, begrensd op 2000. */
  pageSize?: number;
  logger?: Logger;
}

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * Berekent het aaneengesloten seq-bereik dat de peer mist en wij kunnen leveren.
 *
 * `remoteHead` is wat de peer zegt te hebben (de `haveSeq` uit zijn hello),
 * `localHead` is wat wij hebben (standaard `store.head()`). Het resultaat loopt
 * van `remoteHead + 1` tot en met `localHead`. Loopt de peer gelijk of voor, of
 * is de invoer geen geldige seq, dan is er niets te sturen en volgt `null`.
 *
 * De functie raakt de store niet aan en Verzint niets: ze rekent alleen de
 * grenzen uit. Of er echt een event op elke seq staat, controleert de
 * `Backfiller` bij het inpakken van de pagina's.
 */
export function planBackfill(
  local: NodeStore,
  remoteHead: number,
  localHead?: number,
): { from: number; to: number } | null {
  if (!Number.isInteger(remoteHead) || remoteHead < 0) return null;
  const head = localHead ?? local.head();
  if (!Number.isInteger(head) || head < 0) return null;
  const from = remoteHead + 1;
  if (from > head) return null;
  return { from, to: head };
}

/**
 * Serveert één keten aan één peer die achterloopt.
 *
 * De peer vraagt met een `hello` (haveSeq = wat hij heeft); wij antwoorden met
 * `events`-frames, één per pagina, tot onze head is bereikt. Een expliciet
 * request-frame bestaat niet in dit protocol, dus de hello is het verzoek.
 *
 * Regels die deze klasse bewaakt:
 * - alleen events uit `store.since()`, in seq-volgorde en zonder gaten;
 * - een frame gaat alleen de deur uit als elk event een geldige seq en id heeft;
 * - ids die al naar deze peer zijn gestuurd gaan niet nog een keer;
 * - een tweede `start()` of een herhaalde hello met hetzelfde bereik start geen
 *   tweede loper en stuurt geen dubbele pagina;
 * - bij een send die gooit is er precies één `setTimeout`-herkansing, en `stop()`
 *   ruimt die op.
 */
export class Backfiller {
  private readonly store: NodeStore;
  private readonly transport: PeerTransport;
  private readonly logger: Logger;
  private readonly pageSize: number;

  private running = false;
  private pumping = false;
  private closed = false;
  private statusValue: BackfillStatus = "idle";

  private plan: { from: number; to: number } | null = null;
  private cursor = 0;
  private peerHaveSeq = 0;
  private lastSeqSent = 0;
  private eventsSent = 0;
  private pagesSent = 0;
  private retries = 0;

  /** id → seq van wat deze peer al van ons kreeg; dedupe over herhaalde hello's. */
  private readonly sentIds = new Map<string, number>();

  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(deps: BackfillDeps) {
    this.store = deps.store;
    this.transport = deps.transport;
    this.logger = deps.logger ?? silentLogger;
    this.pageSize = normalizePageSize(deps.pageSize);

    this.transport.onMessage((raw) => this.handleRaw(raw));
    this.transport.onClose((reason) => this.handleClose(reason));
  }

  get status(): BackfillStatus {
    return this.statusValue;
  }

  /** Activeert het sturen. Idempotent: een tweede aanroep doet niets. */
  start(): this {
    if (this.closed || this.running) return this;
    this.running = true;
    if (this.plan !== null) {
      this.statusValue = "sending";
      this.logger.debug("backfill gestart", {
        peer: this.transport.label,
        from: this.plan.from,
        to: this.plan.to,
      });
      this.pump();
    }
    return this;
  }

  /** Stopt met sturen en ruimt de ene eventuele retry-timer op. Sluit het transport niet. */
  stop(): void {
    if (!this.running && this.retryTimer === null) return;
    this.running = false;
    this.clearRetry();
    if (this.statusValue !== "failed") this.statusValue = "stopped";
    this.logger.debug("backfill gestopt", { peer: this.transport.label, lastSeqSent: this.lastSeqSent });
  }

  /** Verwerkt een hello van de peer; dit is het verzoek om bij te vullen. */
  onHello(hello: HelloFrame): void {
    if (this.closed) return;
    if (hello.v !== 1) {
      this.logger.warn("backfill: hello met onbekende protocolversie", {
        peer: this.transport.label,
        version: hello.v,
      });
      return;
    }
    if (hello.chain !== this.store.chain) {
      this.logger.warn("backfill: hello voor een andere keten", {
        peer: this.transport.label,
        chain: hello.chain,
        expected: this.store.chain,
      });
      return;
    }
    if (hello.node === this.store.nodeId) {
      this.logger.debug("backfill: hello van onszelf genegeerd", { peer: this.transport.label });
      return;
    }
    if (!Number.isInteger(hello.haveSeq) || hello.haveSeq < 0) {
      this.logger.warn("backfill: hello met ongeldige haveSeq", {
        peer: this.transport.label,
        haveSeq: hello.haveSeq,
      });
      return;
    }

    this.peerHaveSeq = hello.haveSeq;
    const plan = planBackfill(this.store, hello.haveSeq);
    if (plan === null) {
      this.plan = null;
      this.cursor = 0;
      if (this.running) this.statusValue = "complete";
      this.logger.debug("backfill: peer heeft alles al", {
        peer: this.transport.label,
        haveSeq: hello.haveSeq,
        head: this.store.head(),
      });
      return;
    }

    const same = this.plan !== null && this.plan.from === plan.from && this.plan.to === plan.to;
    if (same) {
      // Herhaalde hello voor hetzelfde gat: geen nieuw plan, geen tweede loper.
      if (this.running) this.pump();
      return;
    }

    this.plan = plan;
    // Ids die de peer volgens deze hello al heeft hoeven we niet meer te onthouden.
    this.pruneSentIds(hello.haveSeq);
    if (this.pumping) {
      // Een pagina is al onderweg; schuif alleen op als het nieuwe bereik later begint.
      if (plan.from > this.cursor) this.cursor = plan.from;
    } else {
      this.cursor = plan.from;
    }
    this.logger.info("backfill: bereik gepland", {
      peer: this.transport.label,
      from: plan.from,
      to: plan.to,
      peerHaveSeq: hello.haveSeq,
    });
    if (this.running) {
      this.statusValue = "sending";
      this.pump();
    }
  }

  progress(): BackfillProgress {
    return {
      status: this.statusValue,
      peerHaveSeq: this.peerHaveSeq,
      from: this.plan?.from ?? 0,
      to: this.plan?.to ?? 0,
      nextSeq: this.cursor,
      lastSeqSent: this.lastSeqSent,
      eventsSent: this.eventsSent,
      pagesSent: this.pagesSent,
      retries: this.retries,
      pendingRetry: this.retryTimer !== null,
    };
  }

  // --- inkomend ---------------------------------------------------------

  private handleRaw(raw: string): void {
    if (this.closed) return;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      this.logger.debug("backfill: ongeldig JSON-frame genegeerd", { peer: this.transport.label });
      return;
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) return;
    const record = value as Record<string, unknown>;
    if (record["t"] !== "hello") return;

    const v = record["v"];
    const chain = record["chain"];
    const node = record["node"];
    const haveSeq = record["haveSeq"];
    if (v !== 1 || typeof chain !== "string" || typeof node !== "string") return;
    if (typeof haveSeq !== "number" || !Number.isInteger(haveSeq) || haveSeq < 0) return;
    this.onHello({ t: "hello", v: 1, chain, node, haveSeq });
  }

  private handleClose(reason?: string): void {
    if (this.closed) return;
    this.closed = true;
    this.running = false;
    this.clearRetry();
    if (this.statusValue !== "failed") this.statusValue = "stopped";
    this.logger.info("backfill: transport gesloten", {
      peer: this.transport.label,
      reason: reason ?? "onbekend",
    });
  }

  // --- uitgaand ---------------------------------------------------------

  private pump(): void {
    if (!this.running || this.pumping || this.retryTimer !== null) return;
    this.pumping = true;
    try {
      this.pumpLoop();
    } finally {
      this.pumping = false;
    }
  }

  private pumpLoop(): void {
    while (this.running) {
      const plan = this.plan;
      if (plan === null) {
        this.statusValue = "complete";
        return;
      }
      // Nooit verder dan de head van dit moment; wat daarna komt is live-werk.
      const to = Math.min(plan.to, this.store.head());
      if (this.cursor > to) {
        this.statusValue = "complete";
        this.logger.debug("backfill: klaar", {
          peer: this.transport.label,
          lastSeqSent: this.lastSeqSent,
          pages: this.pagesSent,
        });
        return;
      }

      const page = this.collectPage(to);
      if (page === null) return;
      if (page.events.length === 0) {
        // Alles in dit stuk was al verstuurd; schuif op zonder frame.
        this.cursor = page.next;
        continue;
      }
      if (!this.sendPage(page.events, page.next)) return;
    }
  }

  /**
   * Pakt de volgende pagina uit de store. Geeft `null` bij een fout die we niet
   * mogen maskeren: een gat in de store of een event zonder bruikbare id/seq.
   */
  private collectPage(to: number): { events: Event[]; next: number } | null {
    const from = this.cursor;
    const candidates = this.store.since(from);
    const events: Event[] = [];
    let expected = from;

    for (const event of candidates) {
      if (event.seq < expected) continue;
      if (event.seq > to) break;
      if (event.seq !== expected) {
        return this.fail(
          `store heeft geen aaneengesloten seq: verwacht ${expected}, kreeg ${event.seq}`,
        );
      }
      if (!this.isSendable(event)) {
        return this.fail(`event op seq ${event.seq} heeft geen bruikbare id of keten`);
      }
      expected = event.seq + 1;
      if (this.sentIds.has(event.id)) continue;
      events.push(event);
      if (events.length >= this.pageSize) break;
    }

    return { events, next: expected };
  }

  /** Eén frame per pagina; bij een throw hooguit `MAX_SEND_RETRIES` herkansingen. */
  private sendPage(events: Event[], next: number): boolean {
    const frame: EventsFrame = { t: "events", events };
    try {
      this.transport.send(frame);
    } catch (error) {
      this.retries += 1;
      const reason = error instanceof Error ? error.message : String(error);
      if (this.retries > MAX_SEND_RETRIES) {
        this.fail(`send naar ${this.transport.label} mislukte ${this.retries} keer: ${reason}`);
        return false;
      }
      this.logger.warn("backfill: send mislukt; één herkansing ingepland", {
        peer: this.transport.label,
        attempt: this.retries,
        reason,
      });
      this.scheduleRetry();
      return false;
    }

    for (const event of events) {
      this.sentIds.set(event.id, event.seq);
      this.lastSeqSent = Math.max(this.lastSeqSent, event.seq);
    }
    this.cursor = next;
    this.eventsSent += events.length;
    this.pagesSent += 1;
    this.retries = 0;
    return true;
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== null) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.pump();
    }, RETRY_DELAY_MS);
  }

  private clearRetry(): void {
    if (this.retryTimer === null) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private pruneSentIds(haveSeq: number): void {
    for (const [id, seq] of this.sentIds) {
      if (seq <= haveSeq) this.sentIds.delete(id);
    }
  }

  private isSendable(event: Event): boolean {
    return (
      event.chain === this.store.chain &&
      Number.isInteger(event.seq) &&
      event.seq >= 1 &&
      typeof event.id === "string" &&
      event.id.length > 0
    );
  }

  private fail(reason: string): null {
    this.statusValue = "failed";
    this.running = false;
    this.clearRetry();
    this.logger.error(`backfill gestopt: ${reason}`, {
      peer: this.transport.label,
      lastSeqSent: this.lastSeqSent,
    });
    return null;
  }
}

function normalizePageSize(pageSize: number | undefined): number {
  if (pageSize === undefined || !Number.isInteger(pageSize) || pageSize < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(pageSize, MAX_PAGE_SIZE);
}
