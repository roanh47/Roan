# Plan: one Roan, many doors, no center

## What you asked for

One agent that doesn't live in one place. Your phone, your PC and your server sit
next to each other; none of them is the remote control of another. No central
service, no head agent, no middleman.

Short answer: **it works**, but only if you divide the right things. The
conversation history is the same everywhere; the hands are in different places.

Telegram is out. A bot is a remote by definition: some process has to sit
somewhere and forward messages into a session, and that is exactly the middle you
don't want.

---

## The chain

The chain is the unit, not the machine and not the session. You start Roan and get
one question: **new chain, or join one.**

- **New chain** creates an ID and a key. You hand that to a second machine and it
  joins.
- **Joining** means: everything that is there is here, and everything that happens
  here goes there.

Everything the agent is lives in the chain: conversations, skills, MCP definitions,
tool settings. Not per session, not per machine — one whole that is the same
everywhere.

Roan is a service, not a command you start and stop. It listens and sends all the
time. The TUI, the web UI and the app are windows onto the same chain; close one and
the rest keeps running.

---

## Why this works where a remote control doesn't

With a remote control the phone is a window onto the PC: if the PC is off, the phone
is useless. Not here.

- **PC off?** The phone starts anyway. Steps that need the PC fail with a message —
  not silently, and not the whole session.
- **Phone off?** The PC doesn't notice.
- **Both on?** You can continue the same conversation from either side, and the
  other sees it immediately.

The price: the phone must be able to call a model. Either it has its own key and
goes straight to the provider, or it borrows the model from a node that is online.
That is a per-device setting, not an architectural choice.

---

## What can't be avoided

A project folder lives on one disk. You can't merge two versions of the same folder
the way you merge two lists — files overwrite each other.

So: a folder belongs to one node. The session knows which tools belong to which
node and asks there. If that node is offline, that one tool is offline — not the
session.

The folder itself is synced with git, not with the agent. Git solves the merging;
the agent only needs to know where it may commit and pull.

---

## How sync works

Every event in the chain gets a number and a sender: your message, the model's
answer, the tool call, the output. That's all it is.

Two machines that find each other say "I have up to 412" and the other sends
everything after that. No database pointing at one side, no service that has to be
running.

**Two laptops, one chain, you type on the first.** The turn runs there — model,
tools. Every fragment that appears goes into the chain and straight to the second
one. It shows the same conversation, live. Turn the first one off and the second
continues with the same history. When the first comes back it catches up and is
level again.

So the message isn't sent to a machine. It's added to the chain, and every machine
in that chain has it. Only the turn is local, and only for the length of that turn.

One rule: **only the node running the turn writes events.** The others read and send
requests. That keeps the order unambiguous without anyone being the boss.

And one rule that follows from it: **two nodes may not start a turn at the same
time.** That's not ownership but a lock — the first to start has the turn, the second
waits or gets "busy". Without that lock you get two models answering over each other
and two tools overwriting the same file. The lock belongs to the turn: once it's
done, the next one can come from any machine.

---

## What you build

One binary, same code on every machine:

```
roan                 start: new chain, or join with a code
roan invite          create a code for the next machine
roan daemon          stays in the background listening and syncing
```

There is no `attach` and no `peer add`. You're in a chain or you're not; connecting
machines is joining once, after that it takes care of itself.

`roan daemon` is not a server in the sense of a boss: it's the same machine that
keeps listening. The TUI starts it and doesn't stop it when you close the window.

**Web and app.** Every machine serves the web UI itself on `/app`. The Android app
is a thin shell with a pairing screen — address and token, or a QR — but with the
agent loop inside, so the phone can work on its own when the rest is offline.

**Consistency without boxing yourself in.** Ink and the browser can't share
components; don't try. What you do share:

- the protocol types (one file, imported by everyone)
- the session state and the reducer (nanostores, outside React)
- the command grammar (`/new`, `/sessions`, `/model`, `/chain`)

Only the last layer — how a block of text reaches the screen — differs per target.

---

## Settings, skills and keys

The agent is more than conversations and tools. What it knows — skills, MCP servers,
prompts, tool settings — and what it uses to reach the outside — API keys — has to be
right on every node. There is a split there you shouldn't ignore.

**Everything that isn't secret travels in the chain.** Skills, MCP definitions and
tool settings are text and travel as ordinary events, just like your conversations.
They're the same everywhere, versioned, and reversible, without building a second
sync mechanism.

**Secrets don't go in there.** A key doesn't belong in the chain and doesn't belong
in the session log — that goes over the network and is readable everywhere, so even
a key that ends up in an error message is one too many.

Choose per service, not globally:

- **Model key:** on every node. Otherwise your phone can't work on its own and it's a
  remote after all.
- **Services like Notion:** on one node, the others ask there. Same rule as with
  tools: whoever has the key makes the call.
- **MCP over stdio:** belongs to one node, because it's a process next to the binary.
  **MCP over HTTP:** usable from any node as long as you have the token.

Storage: an age-encrypted file in `~/.roan/secrets/`, with the decryption key in the
OS keychain (or the Android Keystore). On Linux, macOS and Windows 0600 would be
enough, but encrypting costs nothing and makes Android safe, where the filesystem
isn't a boundary. `roan secrets` shows only *what* is present per node, never the
value.

---

## Folders on every machine

The agent has one home, and it's hidden: `~/.roan/`. Inside it, what it **is** sits
next to where it **works**.

**The env always travels in the chain.** Config, skills, MCP definitions, its
identity: that's the agent itself, so it's identical everywhere. It doesn't go
through a file synchroniser but through the chain, as ordinary events — the same
mechanism as your conversations. One truth, no second system beside it.

Two things never enter the chain:

- `workspace/` stays per machine: scratch work, caches, logs, running things.
- `secrets/` stays per machine and is encrypted at rest.

**The layout:**

```
~/.roan/
├── config.json
├── AGENTS.md            how it behaves
├── SOUL.md              tone and boundaries
├── USER.md              who you are
├── MEMORY.md            what it remembers
├── memory/              daily notes
├── skills/              procedures that load only when relevant
├── mcp/
├── secrets/             per machine, encrypted
├── workspace/           per machine — scratch work, caches, state
└── synced-workspace/    identical everywhere — projects live here
    └── projects/calculator/
```

Everything lowercase, for a hard reason: `.Roan` and `.roan` are the same file on
Windows and macOS but two different ones on Linux and Android. One machine that
writes it with a capital somewhere and you have two folders that look identical.
Unix dotfolders are lowercase anyway, so your `ls -a` stays readable.

The identity files sit in the root of `~/.roan/` and not in the workspace, on
purpose: `AGENTS.md` and `MEMORY.md` are what the agent *is*, not what it works on.
They travel in the chain, like its skills. `workspace/` and `synced-workspace/` are
pure content, with exactly one boundary between them: what's in `workspace/` stays
here, what's in `synced-workspace/` is everywhere.

One rule keeps that folder small: **always true → `AGENTS.md`, sometimes true → a
skill.** There is no third category, so there is no `prompts/` folder.

Why hidden rather than visible: it's the Unix convention (like `~/.ssh` and
`~/.config`), it keeps your home folder clean, and the folder holds keys. The price
is that on Android you don't easily reach it — it's a hidden folder in shared
storage. For Syncthing that doesn't matter; you type the path once.

### Why not its own user

`/home/roan` as a separate Unix account sounds tidy but is the wrong trade. The agent
has to reach *your* files; with a second user you fight permissions from day one and
widen them until the isolation is gone anyway. You pay the price and don't get the
benefit.

It also has to be the same on four systems. Android has no second user, Windows and
macOS do it differently from Linux. The moment the paths differ you've lost the
consistency.

A separate account *is* right when the machine serves more people: then it runs as a
service account with the workspace in `/srv/roan` or `/home/roan/.roan`. For a
machine that's only yours, `~/.roan` is the normal place — like `~/.ssh` and
`~/.config`.

If you still want to limit what it can touch, do it with a sandbox (container or OS
sandbox) instead of a second user. Same paths, fewer rights.

### Paths per system

```
LINUX      /home/<user>/.roan/
MACOS      /Users/<user>/.roan/
WINDOWS    C:\Users\<user>\.roan\
ANDROID    /storage/emulated/0/.roan/
```

On Windows the variable is `%USERPROFILE%`; on Android `/storage/emulated/0` is what
you see in a file manager as "Internal storage". Android has no home folder like the
other three, so everything sits in shared storage — not in `Android/data/`, because
synchronisation tools can't reliably reach that.

One consequence: on Android the filesystem is not a boundary. Any app with storage
access can look inside `~/.roan/`, and therefore inside `secrets/`. That's why the
latter is encrypted, with the key in app-private storage or the Keystore. On the
other three systems 0600 is enough, but encrypting works everywhere.

### Rules you have to follow, or it breaks

- **Everything lowercase.** Windows and macOS are case-insensitive by default, Linux
  and Android are not. `Skills` and `skills` are one file on one machine and two on
  the others.
- **No `: * ? " < > |` in names, no `CON`, `NUL`, `AUX`.** Windows refuses them,
  Linux creates them happily, and then you can't open the file there.
- **No symlinks in the workspace.** Android doesn't support them on shared storage,
  and a synchroniser does nothing sensible with them.
- **No permissions that matter.** Android has no executable bit, so never make
  something runnable via `chmod`.
- **No SQLite, no live databases in `synced-workspace`.** A file synchroniser copies
  a database mid-write and then it's broken. Sessions travel through the chain, not
  through the folder.
- **No keys in `synced-workspace`.** They live in `~/.roan/secrets/`, per machine.

### What syncs the workspace

For `synced-workspace`, **Syncthing** is the best choice, and that's not a guess:

- Peer-to-peer, no cloud and no account. Your machines talk directly, also outside
  your network.
- Continuous: no commits, no manual step.
- `.stignore` in the root decides what stays behind.
- On a simultaneous edit it writes a conflict copy instead of picking one.

One thing you should know: the **official Android app was retired in December 2024**
because Google made publishing impossible. The active successor is Syncthing-Fork
(`researchxxl/syncthing-android`, still releasing; also on F-Droid as
`com.github.catfriend1.syncthingfork` and in the Play Store). On Android it asks for
access to all files — unavoidable for a synchronisation tool, and the reason Google
blocked the official app.

What I wouldn't use: **git** (text only, and you have to commit), **rclone** (needs a
cloud), **iCloud** (doesn't exist on Android), **Resilio** (works, but closed source).

### What it costs

No code. Install Syncthing on three machines, share one folder, drop in a
`.stignore`, and turn off battery optimisation so it syncs while your phone sits on
the table. The chain handles the rest of the folder.

---

## Phases

**F0 — done.** Core, tools, streaming, TUI. Lives in `~/Roan-TS`.

**F1 — the chain.** Start with a choice: new chain or join with a code. Numbered
events with a sender, storage, catch-up protocol ("I have up to N"), and a daemon that
keeps running when you close the window. `~/.roan` travels in the same chain, except
`workspace/` and `secrets/`. After this your phone and your PC are in the same chain
and see the same conversation.

**F2 — remote tools.** A tool call that can't run locally becomes a request to the
node that does have it, with the result back in the same turn. An offline node means a
clear error on that step, not on the session.

**F3 — web UI.** React app speaking the same protocol, served by every machine.
Login with a token per device.

**F4 — Android with its own loop.** The app runs the agent itself, with the web UI as
its screen. This is the phase where your phone becomes a real node instead of a
window.

**F5 — distribution.** `bun build --compile` for `.exe`, `.dmg`, Linux binary.
`npm i -g` with a thin launcher package. Docker image for the server.

---

## Choices I'd make now

**Every machine runs the agent, not just the UI.** Otherwise the phone is a remote
again and you're back where you started.

**No central service.** The nodes are equal. What you share is the chain, not a
server that owns everything.

**Tailscale as the network.** You already have it, end-to-end encrypted, works
anywhere. Building your own NAT traversal is weeks of work for something you already
own.

**WebSocket, not REST with polling.** Live output and approvals need two directions.

**The chain on every node.** Offline keeps working, and no third party holds your
conversations.

**No Telegram.** A bot is a remote and therefore a middle.

**Approvals from day one.** `run_shell` over a network is arbitrary code execution.
Policy per node: automatic or ask. On "ask" the first answer from a node in the chain
wins; if nothing is connected, the default applies (deny).

---

## What this costs

F1 is the heaviest: a weekend, because registration, the catch-up protocol and
storage have to be right. F2 another weekend — this is the part that actually
matters, so it may take longer. F3 a weekend. F4 a day plus CI. F5 a day.

---

## Open questions for you

1. **Does the phone get its own model key, or borrow one from a node that's online?**
   Its own key is simpler and faster; borrowing means your phone can do nothing when
   everything else is off.
2. **What does a node need to know about the other?** Only "which tools do you have",
   or also "which projects are there" — the latter means announcing folder names.
3. **When the only machine with the project is offline: hard fail on that step, or
   carry on with the tools that are available?** Carrying on is friendlier, failing
   hard is more predictable.
4. **Approvals: a tap for every shell command, or only for writes outside the
   workspace?**
5. **Which keys may live on your phone?** The model key must, otherwise it isn't
   independent. But Notion, GitHub and your server access — do you want those there
   too, or rather not?
