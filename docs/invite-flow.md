# The invite flow

An invite is how a second device joins a chain that already exists. This page
describes the flow as the code implements it today, and names what is not built.
One caveat changes how the rest reads: the join side is half wired. Creating a
chain produces a real code, and entering a code writes a real identity. Nothing
yet dials the other node or pulls its data. Section 6 lists what is missing.

## 1. What an invite is

A single opaque string: base64url of a small JSON object.

```
{ v: 1, chain, token, host, port }
```

`chain` is the chain's UUID. `token` is 32 random bytes; every peer must present
it, the peer server compares it in constant time and refuses the connection
otherwise. The code is a bearer credential: whoever has it can read the chain.
`host` is `ROAN_PEER_HOST`, default `127.0.0.1`; `port` is `ROAN_PEER_PORT`,
default `7412`.

It is produced only in the `create_chain` reply, as `invite` on the
`ChainResponse`; a join reply carries no `invite`, so a joined node cannot pass
the invitation on. It is not signed: integrity is the base64url/JSON parse plus
field checks. No expiry, no single use, no record of issued codes. The token in
it is the chain token, so the code works as long as the chain does.

## 2. Who talks to whom

Two sockets. The **control socket** is local only, bound to `127.0.0.1:7411`
(`ROAN_CONTROL_PORT`), so the app on the same machine can ask for state and send
`create_chain` / `join_chain`; peers never see these frames. The **peer socket**
is the network path: `host:port` from the code, speaking `hello`, `events`,
`append`, `tool_req` and `tool_res`.

The intended sequence, illustrative and not a screenshot:

```
inviting node A                       joining node B
app -> control: create_chain
  identity -> secrets/ ; code = base64url({v,chain,token,host,port})
  app shows the code
                  --- you type or scan the code ---
                                      app -> control: join_chain { code }
                                        decodeJoinCode -> chain, token, host, port
                                      B saves chain id + token as its identity
                  === TCP/WS to host:port ===         (planned)
                                      hello { chain, node, haveSeq }
                  <== events after haveSeq ==         (catch-up, planned)
                                      env: park local, write chain's (planned)
```

What the code does at each step today:

| Step | Today |
| --- | --- |
| A creates the chain | `createIdentity`, store opened, invite encoded and returned |
| B receives and validates it | the app passes the string through untouched; field checks, then section 5 |
| B reaches A | **not wired.** `dial` exists in `src/net/connect.ts`; the join never calls it, and `host`/`port` are read then ignored |
| B adopts chain data | **not wired.** `onJoin` writes the identity and opens an empty local store |
| B parks its local env | **not wired.** `parkEnv` and `applyEnvSnapshot` exist and are tested; the daemon never calls them |

The route order, once wired, is fixed by `orderCandidates`: tailnet first, LAN
second, duplicates dropped, and a LAN route never precedes or replaces a tailnet
route. Candidates come from `tailscale status`, `tailscale ip -4` or a MagicDNS
lookup that accepts only a tailnet address.

## 3. The ground rules it must not break

From `AGENTS.md`, ground rules. Quoted, not paraphrased.

> **1. No central service.** No node owns a session, and no component may assume
> it does. There is no gateway, no hub, no dispatcher.

> **2. The session is an event chain.** Ordered events with a sender. A session
> has an ID, not an address. Nothing may address a session "on machine X".

> **3. One writer per turn.** Only the node running the turn appends events. The
> others read and send requests. Two nodes may not run a turn at the same time.

> **9. Joining adopts the chain.** When you join a chain, that chain's data
> becomes yours: its sessions, its env, its skills. Your device does not merge
> its local state into the chain and does not push it up. The only way local
> data becomes chain data is **creating a new chain**, and that happens once per
> person. Before joining replaces the local state, park it aside so nothing is
> lost silently.

For the invite that means: the code names a chain and an address, never a
session, and the inviting node has no privileged role after the handshake. B may
read events it pulled, but not append, until it runs a turn itself. Its
pre-existing env is never offered to the chain, not even as a diff.

## 4. What the joining device discards, and where it is parked

The env is the part of `~/.roan` that travels in the chain: `AGENTS.md`,
`SOUL.md`, `USER.md`, `MEMORY.md`, `config.json`, `memory/`, `skills/`, `mcp/`.
Nothing outside that list is read, written or moved. `secrets/`, `workspace/`
and `synced-workspace/` stay on the machine and are never touched by a join, so
a joined node keeps its own keys and gets a new node id while belonging to the
inviter's chain.

Parking is a move, never a delete. The target is
`~/.roan/workspace/parked/<UTC timestamp>/` with `:` and `.` replaced by `-`
(`2026-11-08T21-46-12-123Z`); a collision appends `-2`, `-3`, up to 100. A
`park.json` manifest records `createdAt`, `home`, `reason` and every relative
path moved. On another mount (`EXDEV`) the path is copied first and the source
removed only after the copy completes. If a path fails to move, the error says
how many of how many moved and gives the parked directory; nothing is deleted.
An empty local env parks nothing and returns `null`, so a first join on a fresh
machine writes no manifest.

The join discards the local env as a whole, not per file: after a successful
apply, any managed path the chain's snapshot does not contain is gone from
`~/.roan`, parked, not merged. Applying the same snapshot twice is a no-op,
decided by a content hash over the entries, so it does not depend on who packed
it. None of this runs during a join today: it runs when `applyEnvSnapshot` is
called, and `onJoin` does not call it.

## 5. Failure modes and what the user sees

A failed join reaches the app as one frame, `{ t: "control_error", message }`,
and the message is the error's own text. Nothing is swallowed or rewritten.
Wrong code, in the order the checks run:

| Condition | Message |
|---|---|
| not base64url, or not JSON | `this is not a Roan invite code` |
| not an object | `this is not a Roan invite code` |
| `v` is not 1 | `this invite code is from another version of Roan` |
| `chain` missing or empty | `invite code has no chain` |
| `token` missing or empty | `invite code has no token` |
| `host` missing or empty | `invite code has no address` |
| `port` not an integer in 1-65535 | `invite code has no usable port` |

Node unreachable, from the dial path (written, not called by the join). With no
address to try: `cannot reach peer "<name>" on port <port>: no address to try
(<reason>).` plus guidance that differs by cause — Tailscale not installed, not
up (`tailscale up` on both nodes), or not listing the peer. With every route
failed: `cannot reach peer "<name>" on port <port>: no route connected (<kind>
<address>:<port>: <error>; ...)`, so "the machine is off" and "Tailscale is not
logged in" stay distinguishable. Each candidate has its own timeout, default
2000 ms, so a dead tailnet route does not eat the LAN fallback.

Chain already joined. There is no guard. `join_chain` and `create_chain` both
overwrite `secrets/identity.json` without checking for an existing chain, and
neither parks the previous identity. A second join on a machine already in a
chain silently replaces its chain id and token; the old identity is gone, not
parked. That is a gap, not a decision.

## 6. Not implemented yet

- **Joining pulls the chain's data.** `PLAN.md`: joining means that chain's data
  becomes yours. Today the join adopts an id and a token and nothing else;
  sessions, env and skills are not fetched.
- **The join dials the inviting node.** `dial`, the peer server and the backfill
  loop exist; the daemon starts none of them, and `PEER_PORT` is used only to
  write the number into the code string.
- **Env is applied and parked on join.** Modules and tests exist; the call
  sequence does not.
- **A peer listener runs in the daemon.** `src/transport/server.ts` accepts
  peers with token auth; `src/daemon/main.ts` never starts it, so a running
  daemon does not listen on 7412.
- **The peers list is filled.** The state frame always reports `peers: []`.
- **A scanned code.** `PLAN.md` says typed or scanned; only a pasted or typed
  string reaches `join_chain`.
- **Any screen at all.** `PLAN.md` puts create, join and invite in the app;
  neither app is built, so the invite is a control-frame field and nothing more.
- **A third device.** A join reply omits `invite`, so a joined node cannot
  invite further nodes through this path.

## Where this comes from

`AGENTS.md`, `PLAN.md`, `README.md`, `src/daemon/main.ts`,
`src/daemon/control.ts`, `src/daemon/control-protocol.ts`,
`src/daemon/identity.ts`, `src/daemon/turn-runner.ts`, `src/turn/lock.ts`,
`src/env/types.ts`, `src/env/park.ts`, `src/env/apply.ts`,
`src/net/connect.ts`, `src/net/peer-address.ts`, `src/net/tailscale.ts`,
`src/protocol/types.ts`, `src/transport/server.ts`, `src/chain/store.ts`.
