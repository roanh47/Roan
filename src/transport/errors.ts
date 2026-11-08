/**
 * Transport failures a caller may want to distinguish from bugs.
 *
 * `retryable` is the reconnect decision: network and timeout errors are
 * retryable, auth/chain/version rejections and protocol violations are not.
 */
export class TransportError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "TransportError";
    this.retryable = retryable;
  }
}
