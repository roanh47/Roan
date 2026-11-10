/**
 * In-memory takenlijst voor de sessie.
 *
 * Bewust zonder bestandssysteem en zonder `console`: de store is pure staat die
 * de caller zelf mag tonen. Alle mutaties gaan via de methodes, zodat de
 * interne lijst nooit per ongeluk door een caller aangepast wordt.
 */

/** Eén taak in de lijst. */
export interface TodoItem {
  /** Sequentiële id, start bij 1 en wordt nooit hergebruikt. */
  id: number;
  /** Getrimde tekst zoals meegegeven aan {@link TodoStore.add}. */
  text: string;
  /** Waar zodra {@link TodoStore.complete} deze id gezien heeft. */
  done: boolean;
}

export class TodoStore {
  /** Interne staat; de volgorde van toevoegen blijft behouden. */
  private readonly items = new Map<number, TodoItem>();
  /** Laatst uitgegeven id; 0 betekent nog niets uitgegeven. */
  private nextId = 0;

  /** Voegt een taak toe en geeft deze terug. Lege of alleen-spatie tekst gooit. */
  add(text: string): TodoItem {
    const trimmed = text.trim();
    if (trimmed === "") {
      throw new Error(`todo text must not be empty: ${JSON.stringify(text)}`);
    }

    this.nextId += 1;
    const item: TodoItem = { id: this.nextId, text: trimmed, done: false };
    this.items.set(item.id, item);
    return { ...item };
  }

  /**
   * Markeert een taak als done. Idempotent: een al afgeronde taak blijft done
   * en gooit niet. Een onbekende id gooit wel.
   */
  complete(id: number): TodoItem {
    const item = this.require(id);
    item.done = true;
    return { ...item };
  }

  /** Verwijdert een taak; de id wordt daarna nooit meer uitgegeven. */
  remove(id: number): void {
    this.require(id);
    this.items.delete(id);
  }

  /**
   * Geeft een bevroren kopie van de lijst. De array én de items zijn bevroren,
   * en het zijn kopieën: een caller kan de store dus niet aanpassen.
   */
  list(): readonly TodoItem[] {
    const copy = [...this.items.values()].map((item) => Object.freeze({ ...item }));
    return Object.freeze(copy);
  }

  /** Zoekt een item op of gooit een fout die de gevraagde id noemt. */
  private require(id: number): TodoItem {
    const item = this.items.get(id);
    if (item === undefined) {
      throw new Error(`unknown todo id: ${String(id)}`);
    }
    return item;
  }
}
