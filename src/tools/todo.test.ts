import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TodoStore } from "./todo.js";

describe("TodoStore", () => {
  it("voegt taken toe en geeft ze terug in volgorde", () => {
    const store = new TodoStore();

    const first = store.add("  melk halen  ");
    const second = store.add("brood");

    assert.deepEqual(first, { id: 1, text: "melk halen", done: false });
    assert.deepEqual(second, { id: 2, text: "brood", done: false });
    assert.deepEqual(store.list(), [
      { id: 1, text: "melk halen", done: false },
      { id: 2, text: "brood", done: false },
    ]);
  });

  it("hergebruikt ids niet na remove", () => {
    const store = new TodoStore();
    store.add("een");
    store.add("twee");
    const third = store.add("drie");

    store.remove(2);

    assert.deepEqual(
      store.list().map((item) => item.id),
      [1, 3],
    );
    assert.equal(third.id, 3);

    const fourth = store.add("vier");
    assert.equal(fourth.id, 4);
    assert.deepEqual(
      store.list().map((item) => item.id),
      [1, 3, 4],
    );
  });

  it("markeert een taak als done en blijft idempotent", () => {
    const store = new TodoStore();
    const item = store.add("afwassen");

    const first = store.complete(item.id);
    const second = store.complete(item.id);

    assert.equal(first.done, true);
    assert.equal(second.done, true);
    assert.deepEqual(store.list(), [{ id: item.id, text: "afwassen", done: true }]);
  });

  it("gooit op lege of alleen-spatie tekst en noemt de invoer", () => {
    const store = new TodoStore();

    for (const input of ["", "   ", "\t\n "]) {
      assert.throws(
        () => store.add(input),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /must not be empty/);
          assert.ok(error.message.includes(JSON.stringify(input)), error.message);
          return true;
        },
      );
    }

    assert.deepEqual(store.list(), []);
  });

  it("gooit op een onbekende id bij complete en remove", () => {
    const store = new TodoStore();
    const item = store.add("iets");

    for (const id of [0, 42, item.id + 1]) {
      assert.throws(
        () => store.complete(id),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.ok(error.message.includes(String(id)), error.message);
          return true;
        },
      );
      assert.throws(
        () => store.remove(id),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.ok(error.message.includes(String(id)), error.message);
          return true;
        },
      );
    }

    assert.deepEqual(store.list(), [{ id: item.id, text: "iets", done: false }]);
  });

  it("geeft een bevroren kopie die de store niet kan aanpassen", () => {
    const store = new TodoStore();
    store.add("een");
    const snapshot = store.list();

    assert.equal(Object.isFrozen(snapshot), true);
    const [first] = snapshot;
    assert.ok(first !== undefined);
    assert.equal(Object.isFrozen(first), true);

    // ESM is strict mode: muteren van de array of een item gooit een TypeError.
    assert.throws(() => {
      (snapshot as TodoItemMutable[]).push({ id: 99, text: "stiekem", done: false });
    }, TypeError);
    assert.throws(() => {
      first.done = true;
    }, TypeError);
    assert.throws(() => {
      first.text = "aangepast";
    }, TypeError);

    // En de store zelf is onveranderd.
    assert.deepEqual(store.list(), [{ id: 1, text: "een", done: false }]);
  });

  it("geeft elke keer een nieuwe array", () => {
    const store = new TodoStore();
    store.add("een");

    const a = store.list();
    const b = store.list();

    assert.notEqual(a, b);
    assert.deepEqual(a, b);
  });
});

/** Alleen voor de test: een niet-bevroren vorm om push op te mogen aanroepen. */
interface TodoItemMutable {
  id: number;
  text: string;
  done: boolean;
}
