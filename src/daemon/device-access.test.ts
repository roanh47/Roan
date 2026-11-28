import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mayControl, mayLoadUi } from "./device-access.js";

const LOOPBACK = "127.0.0.1";
const TAILNET = "100.101.102.103";
const LAN = "192.168.1.20";

describe("device access", () => {
  it("open: this device and the tailnet control, everyone loads the UI", () => {
    const open = { deviceOnly: false };
    assert.equal(mayControl(open, LOOPBACK, false), true);
    assert.equal(mayControl(open, TAILNET, false), true);
    assert.equal(mayControl(open, LAN, false), false);
    assert.equal(mayControl(open, LAN, true), true);
    assert.equal(mayControl(open, undefined, false), false);
    assert.equal(mayLoadUi(open, LAN), true);
  });

  it("device only: nothing but loopback gets in, whatever the environment says", () => {
    const closed = { deviceOnly: true };
    assert.equal(mayControl(closed, LOOPBACK, false), true);
    assert.equal(mayControl(closed, TAILNET, true), false);
    assert.equal(mayControl(closed, LAN, true), false);
    assert.equal(mayLoadUi(closed, LOOPBACK), true);
    assert.equal(mayLoadUi(closed, TAILNET), false);
  });
});
