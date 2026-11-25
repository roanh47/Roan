import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { diffEnv, type EnvValues } from "./diff.js";

function diff(local: EnvValues, chain: EnvValues) {
  return diffEnv(local, chain);
}

describe("diffEnv", () => {
  it("adopts what the chain has and is missing locally", () => {
    const result = diff({}, { SOUL: "keten", MEMORY: "keten" });
    assert.deepEqual(result.adopted, ["MEMORY", "SOUL"]);
    assert.deepEqual(result.dropped, []);
    assert.deepEqual(result.unchanged, []);
  });

  it("adopts the chain value when the local value differs", () => {
    const result = diff({ config: "lokaal" }, { config: "keten" });
    assert.deepEqual(result.adopted, ["config"]);
    assert.deepEqual(result.dropped, []);
    assert.deepEqual(result.unchanged, []);
  });

  it("parks local keys the chain does not know", () => {
    const result = diff({ "skills/eigen": "lokaal", SOUL: "zelfde" }, { SOUL: "zelfde" });
    assert.deepEqual(result.adopted, []);
    assert.deepEqual(result.dropped, ["skills/eigen"]);
    assert.deepEqual(result.unchanged, ["SOUL"]);
  });

  it("reports equal values as unchanged", () => {
    const result = diff({ a: "1", b: "2" }, { a: "1", b: "2" });
    assert.deepEqual(result.adopted, []);
    assert.deepEqual(result.dropped, []);
    assert.deepEqual(result.unchanged, ["a", "b"]);
  });

  it("sorts all three lists, regardless of input order", () => {
    const local = { zeta: "lokaal", mu: "zelfde", alfa: "lokaal" };
    const chain = { zeta: "keten", mu: "zelfde", alfa: "lokaal", beta: "keten" };
    const result = diff(local, chain);
    assert.deepEqual(result.adopted, ["beta", "zeta"]);
    assert.deepEqual(result.dropped, []);
    assert.deepEqual(result.unchanged, ["alfa", "mu"]);
  });

  it("sorts dropped keys as well", () => {
    const result = diff({ omega: "x", alfa: "x", mu: "x" }, {});
    assert.deepEqual(result.dropped, ["alfa", "mu", "omega"]);
  });

  it("works with a Map as input", () => {
    const local = new Map<string, string>([["a", "1"]]);
    const chain = new Map<string, string>([
      ["a", "2"],
      ["b", "3"],
    ]);
    const result = diff(local, chain);
    assert.deepEqual(result.adopted, ["a", "b"]);
    assert.deepEqual(result.dropped, []);
    assert.deepEqual(result.unchanged, []);
  });

  it("leaves the input untouched", () => {
    const local = { a: "1", b: "2" };
    const chain = { b: "3" };
    diff(local, chain);
    assert.deepEqual(local, { a: "1", b: "2" });
    assert.deepEqual(chain, { b: "3" });
  });

  it("throws on a non-object and names the argument", () => {
    assert.throws(() => diff(null as unknown as EnvValues, {}), /local/);
    assert.throws(() => diff({}, "keten" as unknown as EnvValues), /chain/);
    assert.throws(() => diff({}, 42 as unknown as EnvValues), /chain/);
    assert.throws(() => diff(undefined as unknown as EnvValues, {}), /local/);
  });

  it("rejects an array as input", () => {
    assert.throws(() => diff([] as unknown as EnvValues, {}), /local.*array/);
    assert.throws(() => diff({}, [1, 2] as unknown as EnvValues), /chain.*array/);
  });

  it("names only the key on a bad value, never the value", () => {
    const local = { SOUL: "super-geheim" } as unknown as EnvValues;
    assert.throws(
      () => diff(local, { SOUL: 1 } as unknown as EnvValues),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /chain/);
        assert.match(err.message, /SOUL/);
        assert.doesNotMatch(err.message, /super-geheim/);
        return true;
      },
    );
  });
});
