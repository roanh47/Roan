import assert from "node:assert/strict";
import test from "node:test";
import type { NetworkInterfaceInfo } from "node:os";

import {
  advertiseHost,
  advertiseHosts,
  bindListenHost,
  resolvePeerBind,
  type PeerBind,
} from "./advertise.js";

function ipv4(address: string, internal = false): NetworkInterfaceInfo {
  return { address, netmask: "255.255.255.0", family: "IPv4", mac: "00:00", internal, cidr: address + "/24", scopeid: undefined };
}

const server = {
  lo: [ipv4("127.0.0.1", true)],
  tailscale0: [ipv4("100.64.0.1")],
  eth0: [ipv4("192.168.0.100")],
  docker0: [ipv4("172.25.0.1")],
  "br-deadbeef": [ipv4("192.168.16.1")],
  "veth0a1b2c": [ipv4("172.18.0.1")],
};

/** The default door: only the network every device can actually reach. */
test("no env: the bind is the tailnet address", () => {
  const bind = resolvePeerBind(server, {});
  assert.deepEqual(bind, { kind: "tailscale", address: "100.64.0.1" });
  assert.equal(bindListenHost(bind), "100.64.0.1");
});

test("no env and no tailscale: loopback, not listen-all", () => {
  const bind = resolvePeerBind({ eth0: [ipv4("192.168.1.20")] }, {});
  assert.deepEqual(bind, { kind: "loopback" });
  assert.equal(bindListenHost(bind), "127.0.0.1");
});

test("ROAN_PEER_BIND=lan is the deliberate listen-all", () => {
  const bind = resolvePeerBind(server, { ROAN_PEER_BIND: "lan" });
  assert.deepEqual(bind, { kind: "lan" });
  assert.equal(bindListenHost(bind), "0.0.0.0");
});

test("a legacy ROAN_PEER_HOST=0.0.0.0 still means lan", () => {
  assert.deepEqual(resolvePeerBind(server, { ROAN_PEER_HOST: "0.0.0.0" }), { kind: "lan" });
});

test("an explicit address is taken literally", () => {
  assert.deepEqual(resolvePeerBind(server, { ROAN_PEER_BIND: "10.1.2.3" }), {
    kind: "address",
    address: "10.1.2.3",
  });
});

/** The invite never claims a route the bind does not expose. */
test("a tailscale bind advertises exactly one route", () => {
  const bind: PeerBind = { kind: "tailscale", address: "100.64.0.1" };
  assert.deepEqual(advertiseHosts(bind, server), ["100.64.0.1"]);
});

test("a lan bind advertises tailnet before LAN, docker bridges never", () => {
  const bind: PeerBind = { kind: "lan" };
  assert.deepEqual(advertiseHosts(bind, server), ["100.64.0.1", "192.168.0.100"]);
});

test("a loopback bind carries no route: the invite honestly has no address", () => {
  const bind: PeerBind = { kind: "loopback" };
  assert.deepEqual(advertiseHosts(bind, server), []);
});

test("an explicit ROAN_PEER_ADVERTISE overrides the whole list", () => {
  const bind: PeerBind = { kind: "tailscale", address: "100.64.0.1" };
  assert.deepEqual(advertiseHosts(bind, server, "vpn.example.com, 10.9.9.9"), ["vpn.example.com", "10.9.9.9"]);
});

test("announce picks the best single route", () => {
  assert.equal(advertiseHost({ kind: "lan" }, server), "100.64.0.1");
});
