import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CancelToken, type CancelListener } from "./cancel.js";

/**
 * Rule under test: cancelling is final and sticks to its reason.
 *
 * The first reason wins, a second `cancel` is a no-op, and listeners hear the
 * reason exactly once. The token holds no timer or clock, so every test is
 * deterministic and needs no fake timers.
 */

describe("CancelToken", () => {
  it("starts alive: not cancelled and without a reason", () => {
    const token = new CancelToken();

    assert.equal(token.isCancelled, false);
    assert.equal(token.reason, undefined);
    assert.doesNotThrow(() => token.throwIfCancelled());
  });

  it("remembers the reason and becomes cancelled", () => {
    const token = new CancelToken();
    token.cancel("user pressed stop");

    assert.equal(token.isCancelled, true);
    assert.equal(token.reason, "user pressed stop");
  });

  it("lets the first reason win on a second cancel", () => {
    const token = new CancelToken();
    token.cancel("first");
    token.cancel("second");

    assert.equal(token.reason, "first");
  });

  it("does not throw on a second cancel", () => {
    const token = new CancelToken();
    token.cancel("first");

    assert.doesNotThrow(() => {
      token.cancel("second");
    });
  });

  it("calls listeners only once, even on repeated cancel", () => {
    const token = new CancelToken();
    const seen: string[] = [];
    token.onCancel((reason) => {
      seen.push(reason);
    });

    token.cancel("first");
    token.cancel("second");

    assert.deepEqual(seen, ["first"]);
  });

  it("throwIfCancelled throws an Error with the reason in the message", () => {
    const token = new CancelToken();
    token.cancel("shutdown requested");

    assert.throws(
      () => token.throwIfCancelled(),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /shutdown requested/);
        return true;
      },
    );
  });
});

describe("CancelToken.onCancel", () => {
  it("calls a registered listener with the reason", () => {
    const token = new CancelToken();
    const seen: string[] = [];
    token.onCancel((reason) => {
      seen.push(reason);
    });

    token.cancel("budget exhausted");

    assert.deepEqual(seen, ["budget exhausted"]);
  });

  it("calls multiple listeners in registration order", () => {
    const token = new CancelToken();
    const seen: string[] = [];
    token.onCancel(() => seen.push("a"));
    token.onCancel(() => seen.push("b"));

    token.cancel("stop");

    assert.deepEqual(seen, ["a", "b"]);
  });

  it("no longer calls the listener after unsubscribing", () => {
    const token = new CancelToken();
    const seen: string[] = [];
    const unsubscribe = token.onCancel((reason) => {
      seen.push(reason);
    });

    unsubscribe();
    token.cancel("stop");

    assert.deepEqual(seen, []);
  });

  it("only unsubscribes its own registration", () => {
    const token = new CancelToken();
    const seen: string[] = [];
    const listener: CancelListener = (reason) => {
      seen.push(reason);
    };
    const first = token.onCancel(listener);
    token.onCancel(listener);

    first();
    token.cancel("stop");

    // Registering the same function twice yields two separate unsubscribes.
    assert.deepEqual(seen, ["stop"]);
  });

  it("unsubscribing a second time is a no-op", () => {
    const token = new CancelToken();
    const unsubscribe = token.onCancel(() => undefined);

    unsubscribe();
    assert.doesNotThrow(() => unsubscribe());
  });

  it("calls a late registration immediately with the reason", () => {
    const token = new CancelToken();
    token.cancel("too late");

    const seen: string[] = [];
    token.onCancel((reason) => {
      seen.push(reason);
    });

    assert.deepEqual(seen, ["too late"]);
  });

  it("returns a do-nothing unsubscribe for a late registration", () => {
    const token = new CancelToken();
    token.cancel("too late");

    let calls = 0;
    const unsubscribe = token.onCancel(() => {
      calls += 1;
    });

    assert.equal(calls, 1);
    assert.doesNotThrow(() => unsubscribe());
    assert.equal(calls, 1);
  });

  it("lets a listener see the token already cancelled", () => {
    const token = new CancelToken();
    let observed: boolean | undefined;
    let observedReason: string | undefined;
    token.onCancel(() => {
      observed = token.isCancelled;
      observedReason = token.reason;
    });

    token.cancel("stop");

    assert.equal(observed, true);
    assert.equal(observedReason, "stop");
  });

  it("keeps a throwing listener from blocking the other listeners", () => {
    const token = new CancelToken();
    const seen: string[] = [];
    token.onCancel(() => {
      throw new Error("listener exploded");
    });
    token.onCancel((reason) => {
      seen.push(reason);
    });

    assert.throws(() => token.cancel("stop"), AggregateError);
    assert.deepEqual(seen, ["stop"]);
    assert.equal(token.reason, "stop");
  });
});

describe("CancelToken.cancel validation", () => {
  it("refuses an empty or blank reason and then does not cancel", () => {
    for (const reason of ["", "   ", "\t\n"]) {
      const token = new CancelToken();
      assert.throws(
        () => {
          (token.cancel as (value: unknown) => void)(reason);
        },
        /cancel reason must be a non-empty string/,
      );
      assert.equal(token.isCancelled, false);
      assert.equal(token.reason, undefined);
    }
  });

  it("names the bad input in the message", () => {
    const token = new CancelToken();
    assert.throws(
      () => token.cancel("  "),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /" {2}"/);
        return true;
      },
    );
  });

  it("refuses a reason that is not a string", () => {
    const token = new CancelToken();
    assert.throws(
      () => {
        (token.cancel as (value: unknown) => void)(42);
      },
      /cancel reason must be a non-empty string, got 42/,
    );
  });

  it("refuses a listener that is not a function", () => {
    const token = new CancelToken();
    assert.throws(
      () => {
        (token.onCancel as (value: unknown) => void)("nope");
      },
      /onCancel listener must be a function/,
    );
  });
});
