import type { EventStore } from "../chain/store.js";
import type { AppendOutcome, Event, NodeStore, Unsubscribe } from "../sync/types.js";

/**
 * The daemon's EventStore seen the way replication wants to see it.
 *
 * `sync` is written against `NodeStore` and knows nothing about SQLite; this is
 * the one place where the two meet. All state lives in the database, so a
 * second process opening the same file sees the same chain.
 */
export class ChainNodeStore implements NodeStore {
  constructor(
    private readonly store: EventStore,
    readonly nodeId: string,
    readonly chain: string,
  ) {}

  head(): number {
    return this.store.head(this.chain);
  }

  idAt(seq: number): string | undefined {
    if (seq < 1) return undefined;
    return this.store.read(this.chain, seq, 1)[0]?.id;
  }

  has(id: string): boolean {
    return this.store.eventById(this.chain, id) !== undefined;
  }

  /**
   * `since(0)` means "I have nothing", which the store cannot express: it reads
   * from seq 1 upward. The store also caps a page at 10.000, so a long chain is
   * read in pages instead of silently truncated.
   */
  since(from: number): Event[] {
    const start = from < 1 ? 1 : from;
    const events: Event[] = [];
    let cursor = start;
    for (;;) {
      const page = this.store.read(this.chain, cursor, 10000) as unknown as Event[];
      events.push(...page);
      if (page.length < 10000) break;
      cursor += page.length;
    }
    return events;
  }

  /**
   * Writes only on `head() + 1`. Same seq with the same id is a duplicate; same
   * seq with a different id means the chain diverged and the caller must be told
   * rather than have one side silently win.
   */
  append(event: Event): AppendOutcome {
    const head = this.head();
    if (event.seq <= head) {
      const existing = this.idAt(event.seq);
      if (existing === event.id) {
        return { status: "duplicate" };
      }
      return { status: "conflict", existingId: existing ?? "" };
    }
    if (event.seq !== head + 1) {
      return { status: "conflict", existingId: "" };
    }
    // notify:false — this came *from* a peer. The store must stay quiet so
    // replication does not send what it just received back out again.
    this.store.append(this.chain, event as never, { notify: false });
    return { status: "appended" };
  }

  /**
   * Local appends reach replication through the store, so every writer — the
   * app's message, a turn, a tool — is covered without being wired separately.
   */
  subscribe(listener: (event: Event) => void): Unsubscribe {
    return this.store.onAppend((event) => {
      if (event.chain === this.chain) listener(event);
    });
  }
}
