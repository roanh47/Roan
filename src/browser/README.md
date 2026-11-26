# Browser

A local browser the model can drive over the Chrome DevTools Protocol, and
nothing more. It is one tool (`browser`) with four actions: `navigate`, `read`,
`click`, `screenshot`.

```ts
import { defineBrowserTool } from "./browser/provider.js";
import { toolSurface } from "./tools/surface.js";

toolSurface.register(defineBrowserTool(), { set: "core", source: "core" });
```

## Files

```text
cdp.ts       one websocket, id-correlated send(), event subscriptions, close()
page.ts      navigate / readText / click / screenshot on top of a client
surface.ts   the tool surface: name, action list, JSON schema
provider.ts  availability, session, action dispatch, the Tool adapter
```

`src/testing/fake-cdp.ts` is the test endpoint: a real websocket on 127.0.0.1
that answers methods by name, can stay silent, and can answer with an error.

## Local only

The endpoint comes from `BROWSER_CDP_URL` or an explicit url, and must be a
loopback address (`localhost`, `*.localhost`, `127.*`, `::1`). A CDP endpoint is
full control of a logged-in browser, so a LAN address is refused with a reason
rather than dialled.

## No reconnection

A dropped socket is reported to the caller. Reconnecting would let a call answer
about a different page than the one the model was looking at, so the next action
opens a fresh session instead.

## Honest failures

- no endpoint: `browser: no CDP endpoint; set BROWSER_CDP_URL or pass a url`
- not local: `browser: ws://192.168.1.20:9222/... is not local; browser control is local-only`
- unknown action: names the four that exist
- no such element: `browser: no element matches "#pay-now"`
- load failure: `browser: cannot navigate to <url>: net::ERR_...`
- slow call: `cdp: <method> timed out after <ms>ms`

## Tests

```bash
npx tsc -p tsconfig.json
node --test dist/browser/*.test.js
```

The tests run against `startFakeCdp()` only; no real browser is launched and
nothing leaves 127.0.0.1.
