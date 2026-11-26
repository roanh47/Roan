# sdk

A typed, dependency-free client for the daemon's control port.

```ts
import { connect } from "./client.js";

const client = connect("ws://127.0.0.1:7411/");
console.log(await client.state());
await client.send("hello");
client.close();
```

`docs/api.md` is the protocol this speaks, frame by frame. `client.ts` uses the
runtime's global `WebSocket` (Node 22 has one) and imports nothing, so it does
not pull `ws` into an embedder.

The package sits outside `tsconfig.json`'s `src` tree, so it has its own config:

```
npx tsc -p sdk/tsconfig.json --noEmit
```

Tests live in `tests/sdk-client.test.ts` (run with `npx tsx --test
tests/*.test.ts`) and drive it against a fake WebSocket server, never a real
daemon.
