# Agent-to-agent (A2A)

A2A is an open protocol for one agent to hand a task to another agent it does not
control. An agent publishes a capability document, another agent reads it, sends a
task, and then follows that task's state until it produces a result. The wire
format is JSON-RPC over HTTPS and the published specification defines the
capability document, the message and task shapes, and the streaming variants.

This repository implements none of it. There is no A2A endpoint, no capability
document, no client and no adapter code — a stub module with no caller would be
dead code that reads like a feature, so the honest form of "not yet" is this page.
Nothing below describes an endpoint that exists.

## Why it is not enabled

Four of the ground rules in `AGENTS.md` each rule it out on their own.

**A session has an id, not an address.** Rule 2. A2A is built around reaching *an
agent* — a URL, a capability document, an identity that can be dialed. A chain in
Roan is a name and an ordered log. There is nowhere to send a task "to", because
the thing a task would run on is whichever node the user typed on.

**No central service.** Rule 1. Every A2A deployment needs at least one party that
is reachable at a stable address. That is a server by another name, and this
project does not have one — the daemon is started by the app on the machine its
owner uses.

**The turn runs where the user typed.** Rule 4. An inbound A2A task is a request
to run a turn somewhere. Honouring it would mean running a turn on a machine whose
user did not type it, and the rules forbid forwarding a turn. The reverse — the
receiving node refuses and asks its user — turns A2A into a notification channel,
which the chain already provides.

**One writer per turn, and a human in the loop.** Rule 3 plus the approval screen.
Tool calls are approved by a person in the app. An A2A task arrives with no person
attached, so every tool call it triggers would either block forever or run
unattended. There is no unattended approval policy in this codebase, and adding
one is a product decision, not a protocol adapter.

There is also a simpler reason: Roan is one agent over several machines. Two
instances already cooperate by replicating one chain (`src/sync/`), not by
delegating work to each other. A2A solves a problem — federation between agents
that do not share state — that this design deliberately avoids having.

## What already covers the same need

- **Inbound trigger.** `src/webhooks/dispatch.ts` accepts a signed POST and turns
  it into one event with a stable id. A CI job, a form or a script can start work
  without an agent on the other end. The shared secret lives in `secrets/`, and a
  replayed request is refused by the timestamp window and the replay guard.
- **Outbound notification.** `sendWebhook` posts a signed JSON body to an
  https endpoint when something ends. That is the "tell another system" half of
  A2A without the task lifecycle.
- **Peer cooperation.** Invite and join put two machines on one chain; the session
  is the same session on both. No messages are addressed between agents because
  there are no separate agents to address.
- **Read-only integrations.** `src/connectors/github.ts` reads issues and files
  through the REST API with a token from `secrets/`. It is a tool, not a peer.

The difference matters: a webhook is a *trigger into* an existing chain with a
shared secret; A2A is a *peer protocol* with identity, capability discovery and a
task lifecycle. Roan has the first and not the second, on purpose.

## What a future adapter would need

If this ever changes, these are the pieces, in the order they would have to exist.
Each one is a design decision, not a wrapper.

1. **An address for a chain.** A2A needs an identity that can be dialed, and the
   chain deliberately has none. The smallest honest version is: a node identity
   (already in `secrets/identity.json`) plus an explicit, user-enabled listening
   endpoint with its own port — opt-in per machine, never implied by joining.
2. **An inbound authority model.** Who approves a tool call that came from a peer?
   Without an answer, an adapter can only accept tasks that need no tools, which is
   not worth the protocol. The likely shape is a per-peer allowlist of tools stored
   in the chain (it travels, so every device agrees) and a hard refusal — not a
   prompt — for anything outside it.
3. **A task-to-chain mapping.** A2A tasks have a state machine (submitted, working,
   completed, failed, cancelled) and produce artifacts. The chain has events with
   ids and a single writer. The mapping has to preserve both: one A2A task maps to
   one turn, task states map to existing events, and a repeated task id must be a
   no-op rather than a second turn. That is the same idempotency rule the webhook
   path gets from its digest-derived event id.
4. **Key material and verification.** A2A peers authenticate with their own keys,
   which is a different problem from the HMAC secret a webhook uses: the receiver
   needs the sender's public key and a way to trust it. Those keys belong in
   `secrets/`, like the node identity, and never in the chain or in an event.
5. **A capability document that tells the truth.** It would be generated from the
   tools this node can actually run, with the same machine-addressing rule as a
   tool call: a capability that names a path is a capability on one specific
   machine, not on "Roan". A document that advertises a union of every node's tools
   would promise work no single node can do.
6. **Egress rules.** https only, redirects refused, a timeout, a size cap on the
   answer, and a per-peer rate limit. `src/webhooks/dispatch.ts` already applies
   the first four to a much simpler payload; an adapter should reuse the checks
   rather than re-derive them.
7. **A refusal that is visible.** A rejected task has to come back as an error the
   peer can read, not a silent drop, and the refusal has to be an event so the
   user sees that something tried. Webhooks get this from the `{accepted, reason}`
   result; A2A needs the same, mapped onto its own error shape.

Until all seven exist, the answer to "can Roan talk A2A?" is no, and the code says
so by not pretending otherwise.

## What an adapter must not do

- It must not introduce a hub, gateway or dispatcher that owns sessions.
- It must not forward a turn to another machine to execute it there.
- It must not merge a peer's state into the local chain; join adopts a chain, and
  only a new chain seeds one.
- It must not accept a task that runs tools without an explicit, per-peer policy.
- It must not put a peer's key, token or address in an event.
