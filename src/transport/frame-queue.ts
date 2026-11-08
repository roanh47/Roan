/**
 * A bounded async queue for inbound frames.
 *
 * The bound is the point: a peer that produces faster than the consumer reads
 * must be disconnected, not buffered forever. `push` returns false when full so
 * the caller can decide what to close.
 */
export class BoundedFrameQueue<T> implements AsyncIterableIterator<T> {
  private readonly items: T[] = [];
  private readonly waiters: Array<{
    resolve: (result: IteratorResult<T>) => void;
    reject: (error: Error) => void;
  }> = [];
  private finished = false;
  private pendingError: Error | null = null;

  constructor(
    private readonly capacity: number,
    private readonly onOverflow: () => void,
  ) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error(`queue capacity must be a positive integer, got ${String(capacity)}`);
    }
  }

  get size(): number {
    return this.items.length;
  }

  /** Enqueue without blocking. False means the queue is full or finished. */
  push(item: T): boolean {
    if (this.finished) return false;

    const waiter = this.waiters.shift();
    if (waiter !== undefined) {
      waiter.resolve({ done: false, value: item });
      return true;
    }
    if (this.items.length >= this.capacity) {
      this.onOverflow();
      return false;
    }
    this.items.push(item);
    return true;
  }

  next(): Promise<IteratorResult<T>> {
    const item = this.items.shift();
    if (item !== undefined) return Promise.resolve({ done: false, value: item });

    if (this.pendingError !== null) {
      const error = this.pendingError;
      this.pendingError = null;
      return Promise.reject(error);
    }
    if (this.finished) return Promise.resolve({ done: true, value: undefined });

    return new Promise<IteratorResult<T>>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }

  /** End cleanly; pending readers see `done`. */
  close(): void {
    if (this.finished) return;
    this.finished = true;
    while (true) {
      const waiter = this.waiters.shift();
      if (waiter === undefined) break;
      waiter.resolve({ done: true, value: undefined });
    }
  }

  /** End with an error; the next read rejects once, then reads are done. */
  fail(error: Error): void {
    if (this.finished) return;
    this.finished = true;
    while (true) {
      const waiter = this.waiters.shift();
      if (waiter === undefined) break;
      waiter.reject(error);
    }
    this.pendingError = error;
  }

  return(): Promise<IteratorResult<T>> {
    this.close();
    return Promise.resolve({ done: true, value: undefined });
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<T> {
    return this;
  }
}
