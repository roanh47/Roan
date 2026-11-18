import assert from "node:assert/strict";
import test from "node:test";

import { decodeJoinCode, encodeJoinCode, type JoinCode } from "./control-protocol.js";

/**
 * A join code has to outlive the version that made it: an old phone joins a
 * new server and the other way around. v1 carries one `host`, v2 carries a
 * `hosts` list — both decode into the same shape, and the joiner dials every
 * address in it.
 */
test("a v2 code round-trips with its whole route list", () => {
  const code: JoinCode = {
    v: 2,
    chain: "c1",
    token: "t1",
    hosts: ["100.64.0.1", "192.168.1.20"],
    port: 7412,
  };
  const decoded = decodeJoinCode(encodeJoinCode(code));
  assert.deepEqual(decoded.hosts, ["100.64.0.1", "192.168.1.20"]);
  assert.equal(decoded.chain, "c1");
  assert.equal(decoded.port, 7412);
});

test("a v1 code with a single host still joins", () => {
  const v1 = Buffer.from(
    JSON.stringify({ v: 1, chain: "c1", token: "t1", host: "192.168.1.20", port: 7412 }),
    "utf8",
  ).toString("base64url");
  const decoded = decodeJoinCode(v1);
  assert.deepEqual(decoded.hosts, ["192.168.1.20"]);
});

test("a code from the broken era, carrying 0.0.0.0, is refused honestly", () => {
  const broken = Buffer.from(
    JSON.stringify({ v: 1, chain: "c1", token: "t1", host: "0.0.0.0", port: 7412 }),
    "utf8",
  ).toString("base64url");
  assert.throws(() => decodeJoinCode(broken), /no address/);
});

test("a code without any address is refused", () => {
  const empty = Buffer.from(JSON.stringify({ v: 2, chain: "c1", token: "t1", hosts: [], port: 7412 }), "utf8").toString("base64url");
  assert.throws(() => decodeJoinCode(empty), /no address/);
});

test("a code from an unknown version is refused", () => {
  const future = Buffer.from(JSON.stringify({ v: 9, chain: "c1", token: "t1", hosts: ["x"], port: 7412 }), "utf8").toString("base64url");
  assert.throws(() => decodeJoinCode(future), /another version/);
});
