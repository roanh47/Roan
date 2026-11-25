/**
 * In-memory task list for the session.
 *
 * Deliberately without a filesystem and without `console`: the store is pure state
 * that the caller may display itself. All mutations go through the methods, so the
 * internal list is never accidentally changed by a caller.
 */

/** One task in the list. */
export interface TodoItem {
  /** Sequential id, starts at 1 and is never reused. */
  id: number;
  /** Trimmed text as passed to {@link TodoStore.add}. */
  text: string;
  /** True as soon as {@link TodoStore.complete} has seen this id. */
  done: boolean;
}

export class TodoStore {
  /** Internal state; the order of insertion is preserved. */
  private readonly items = new Map<number, TodoItem>();
  /** Last issued id; 0 means nothing has been issued yet. */
  private nextId = 0;

  /** Adds a task and returns it. Empty or whitespace-only text throws. */
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
   * Marks a task as done. Idempotent: an already completed task stays done
   * and does not throw. An unknown id does throw.
   */
  complete(id: number): TodoItem {
    const item = this.require(id);
    item.done = true;
    return { ...item };
  }

  /** Removes a task; the id is never issued again afterwards. */
  remove(id: number): void {
    this.require(id);
    this.items.delete(id);
  }

  /**
   * Returns a frozen copy of the list. Both the array and the items are frozen,
   * and they are copies: a caller therefore cannot modify the store.
   */
  list(): readonly TodoItem[] {
    const copy = [...this.items.values()].map((item) => Object.freeze({ ...item }));
    return Object.freeze(copy);
  }

  /** Looks up an item or throws an error that names the requested id. */
  private require(id: number): TodoItem {
    const item = this.items.get(id);
    if (item === undefined) {
      throw new Error(`unknown todo id: ${String(id)}`);
    }
    return item;
  }
}
