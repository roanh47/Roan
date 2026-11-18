import assert from "node:assert/strict";
import test from "node:test";
import type { NetworkInterfaceInfo } from "node:os";

import { advertiseHost, advertiseHosts } from "./advertise.js";

function ipv4(address: string, internal = false): NetworkInterfaceInfo {
  return { address, netmask: "255.255.255.0", family: "IPv4", mac: "00:00", internal, cidr: address + "/24", scopeid: undefined };
}

/** An invite must carry an address a peer can actually dial. */
test("an explicit ROAN_PEER_ADVERTISE always wins", () => {
  const host = advertiseHost("0.0.0.0", {}, "100.10.0.9");
  assert.equal(host, "100.10.0.9");
});

test("a specific listen address is dialable as-is", () => {
  const host = advertiseHost("192.168.1.10", {});
  assert.equal(host, "192.168.1.10");
});

test("0.0.0.0 with a tailnet interface picks the tailnet IP", () => {
  const host = advertiseHost("0.0.0.0", {
    lo: [ipv4("127.0.0.1", true)],
    tailscale0: [ipv4("100.64.0.1")],
    eth0: [ipv4("192.168.1.20")],
  });
  assert.equal(host, "100.64.0.1");
});

test("0.0.0.0 without tailnet falls back to the first real interface", () => {
  const host = advertiseHost("0.0.0.0", {
    lo: [ipv4("127.0.0.1", true)],
    eth0: [ipv4("192.168.1.20")],
    wlan0: [ipv4("192.168.1.21")],
  });
  assert.equal(host, "192.168.1.20");
});

test("an invite never carries the listen-all address", () => {
  const host = advertiseHost("0.0.0.0", {});
  assert.equal(host, "");
  assert.notEqual(host, "0.0.0.0");
});

/** The joiner dials every address in the code: order decides which opens first. */
test("hosts collects every route, tailnet before LAN, no duplicates", () => {
  const hosts = advertiseHosts(
    "0.0.0.0",
    {
      lo: [ipv4("127.0.0.1", true)],
      tailscale0: [ipv4("100.64.0.1")],
      eth0: [ipv4("192.168.1.20")],
      eth0b: [ipv4("192.168.1.20")],
    },
    "",
  );
  assert.deepEqual(hosts, ["100.64.0.1", "192.168.1.20"]);
});

test("an explicit ROAN_PEER_ADVERTISE may list several, comma-separated", () => {
  const hosts = advertiseHosts(
    "0.0.0.0",
    { eth0: [ipv4("192.168.1.20")] },
    "100.10.0.9, 100.10.0.10",
  );
  assert.deepEqual(hosts, ["100.10.0.9", "100.10.0.10", "192.168.1.20"]);
});

test("the listen-all address never lands in the list", () => {
  const hosts = advertiseHosts("0.0.0.0", {});
  assert.deepEqual(hosts, []);
});
