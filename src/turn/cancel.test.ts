import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CancelToken, type CancelListener } from "./cancel.js";

/**
 * Regel onder test: annuleren is definitief en reden-vast.
 *
 * De eerste reden wint, een tweede `cancel` is een no-op en luisteraars horen
 * de reden precies één keer. Er zit geen timer of klok in de token, dus elke
 * test is deterministisch en heeft geen fake timers nodig.
 */

describe("CancelToken", () => {
  it("start levend: niet geannuleerd en zonder reden", () => {
    const token = new CancelToken();

    assert.equal(token.isCancelled, false);
    assert.equal(token.reason, undefined);
    assert.doesNotThrow(() => token.throwIfCancelled());
  });

  it("onthoudt de reden en wordt geannuleerd", () => {
    const token = new CancelToken();
    token.cancel("user pressed stop");

    assert.equal(token.isCancelled, true);
    assert.equal(token.reason, "user pressed stop");
  });

  it("laat de eerste reden winnen bij een tweede cancel", () => {
    const token = new CancelToken();
    token.cancel("first");
    token.cancel("second");

    assert.equal(token.reason, "first");
  });

  it("gooit niet bij een tweede cancel", () => {
    const token = new CancelToken();
    token.cancel("first");

    assert.doesNotThrow(() => {
      token.cancel("second");
    });
  });

  it("roept luisteraars maar één keer, ook bij herhaald cancel", () => {
    const token = new CancelToken();
    const seen: string[] = [];
    token.onCancel((reason) => {
      seen.push(reason);
    });

    token.cancel("first");
    token.cancel("second");

    assert.deepEqual(seen, ["first"]);
  });

  it("throwIfCancelled gooit een Error met de reden in het bericht", () => {
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
  it("roept een geregistreerde luisteraar met de reden", () => {
    const token = new CancelToken();
    const seen: string[] = [];
    token.onCancel((reason) => {
      seen.push(reason);
    });

    token.cancel("budget exhausted");

    assert.deepEqual(seen, ["budget exhausted"]);
  });

  it("roept meerdere luisteraars in registratievolgorde", () => {
    const token = new CancelToken();
    const seen: string[] = [];
    token.onCancel(() => seen.push("a"));
    token.onCancel(() => seen.push("b"));

    token.cancel("stop");

    assert.deepEqual(seen, ["a", "b"]);
  });

  it("belt de luisteraar niet meer na afmelden", () => {
    const token = new CancelToken();
    const seen: string[] = [];
    const unsubscribe = token.onCancel((reason) => {
      seen.push(reason);
    });

    unsubscribe();
    token.cancel("stop");

    assert.deepEqual(seen, []);
  });

  it("meldt alleen de eigen registratie af", () => {
    const token = new CancelToken();
    const seen: string[] = [];
    const listener: CancelListener = (reason) => {
      seen.push(reason);
    };
    const first = token.onCancel(listener);
    token.onCancel(listener);

    first();
    token.cancel("stop");

    // Dezelfde functie twee keer registreren geeft twee losse afmeldingen.
    assert.deepEqual(seen, ["stop"]);
  });

  it("tweede keer afmelden is een no-op", () => {
    const token = new CancelToken();
    const unsubscribe = token.onCancel(() => undefined);

    unsubscribe();
    assert.doesNotThrow(() => unsubscribe());
  });

  it("roept een late registratie meteen aan met de reden", () => {
    const token = new CancelToken();
    token.cancel("too late");

    const seen: string[] = [];
    token.onCancel((reason) => {
      seen.push(reason);
    });

    assert.deepEqual(seen, ["too late"]);
  });

  it("geeft bij een late registratie een afmelding die niets doet", () => {
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

  it("laat een luisteraar de token al geannuleerd zien", () => {
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

  it("laat een gooiende luisteraar de andere luisteraars niet blokkeren", () => {
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

describe("CancelToken.cancel validatie", () => {
  it("weigert een lege of blanco reden en annuleert dan niet", () => {
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

  it("noemt de foute invoer in het bericht", () => {
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

  it("weigert een reden die geen string is", () => {
    const token = new CancelToken();
    assert.throws(
      () => {
        (token.cancel as (value: unknown) => void)(42);
      },
      /cancel reason must be a non-empty string, got 42/,
    );
  });

  it("weigert een luisteraar die geen functie is", () => {
    const token = new CancelToken();
    assert.throws(
      () => {
        (token.onCancel as (value: unknown) => void)("nope");
      },
      /onCancel listener must be a function/,
    );
  });
});
