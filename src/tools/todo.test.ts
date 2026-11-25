import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TodoStore } from "./todo.js";

describe("TodoStore", () => {
  it("adds tasks and returns them in order", () => {
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

  it("does not reuse ids after remove", () => {
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

  it("marks a task as done and stays idempotent", () => {
    const store = new TodoStore();
    const item = store.add("afwassen");

    const first = store.complete(item.id);
    const second = store.complete(item.id);

    assert.equal(first.done, true);
    assert.equal(second.done, true);
    assert.deepEqual(store.list(), [{ id: item.id, text: "afwassen", done: true }]);
  });

  it("throws on empty or whitespace-only text and names the input", () => {
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

  it("throws on an unknown id at complete and remove", () => {
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

  it("returns a frozen copy that cannot modify the store", () => {
    const store = new TodoStore();
    store.add("een");
    const snapshot = store.list();

    assert.equal(Object.isFrozen(snapshot), true);
    const [first] = snapshot;
    assert.ok(first !== undefined);
    assert.equal(Object.isFrozen(first), true);

    // ESM is strict mode: mutating the array or an item throws a TypeError.
    assert.throws(() => {
      (snapshot as TodoItemMutable[]).push({ id: 99, text: "stiekem", done: false });
    }, TypeError);
    assert.throws(() => {
      first.done = true;
    }, TypeError);
    assert.throws(() => {
      first.text = "aangepast";
    }, TypeError);

    // And the store itself is unchanged.
    assert.deepEqual(store.list(), [{ id: 1, text: "een", done: false }]);
  });

  it("returns a new array every time", () => {
    const store = new TodoStore();
    store.add("een");

    const a = store.list();
    const b = store.list();

    assert.notEqual(a, b);
    assert.deepEqual(a, b);
  });
});

/** For this test only: a non-frozen shape so that push may be called on it. */
interface TodoItemMutable {
  id: number;
  text: string;
  done: boolean;
}
