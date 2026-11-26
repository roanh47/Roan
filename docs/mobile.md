# The phone app

The phone is a node, not a window. It runs the daemon itself: its own identity,
its own `~/.Roan`, its own chain, and it reaches the other machines as a peer
over Tailscale.

## How the daemon gets onto the phone

Android refuses to start a binary that is not in the apk, and Tauri has no
`externalBin` there, so the daemon cannot be a sidecar the way it is on desktop.
It runs inside the app instead.

- **The runtime is a library.** `libnode.so` — Node 24 built from the
  nodejs-mobile recipe, `arm64-v8a`, 16 kB pages, NDK r27 — goes into
  `jniLibs/<abi>/`. `System.loadLibrary("node")` loads it; there is no separate
  `node` executable on the device.
- **The bridge is small.** `src-tauri/android/start-node.cpp` exposes
  `RoanNode.startNodeWithArguments` and calls `node::Start(argc, argv)` on a
  worker thread. It also points stdout/stderr at a log file, because a WebView
  host has no terminal: `filesDir/roan-daemon.log`.
- **The daemon is one file.** `src/daemon/main.js` is bundled by esbuild
  (`scripts/bundle-daemon.mjs`) into `assets/roan-daemon.js`, ~3 MB, CommonJS,
  with `ws` inside it and `node:sqlite` built into the runtime.
- **`RoanNode.ensureStarted()`** runs from `MainActivity.onCreate`, copies the
  bundle to `filesDir`, then sets `ROAN_HOME=filesDir/.Roan`,
  `ROAN_ENGINE=builtin`, `ROAN_HOST=127.0.0.1`, `ROAN_PORT=6769` and starts it.
  That one port is the page, `/ws` and `/peer`; there is no separate peer port.
  (The Android bridge still passes `ROAN_CONTROL_*`/`ROAN_PEER_*`; both are read
  as aliases.)
- **The WebView talks to loopback.** `ws://127.0.0.1:6769/ws`, the same socket
  the desktop app uses. Cleartext to loopback is allowed by
  `res/xml/network_security_config.xml` and nowhere else.
- **The engine is the loop in this repo.** `ROAN_ENGINE=builtin` selects
  `src/agent.ts`: there is no `hermes` binary on Android and no way to spawn one,
  so a turn is model → tool → model in-process.

`scripts/android-daemon.sh [abi ...]` does all of it, idempotently, after
`tauri android init`: it fetches libnode (cached in `~/.cache/roan/libnode`),
prunes `jniLibs` to the requested ABIs, copies the bridge and headers, bundles
the daemon, and patches the generated gradle project, manifest and activity.
`scripts/build-local.sh` calls it, and so does the Android job in
`release.yml`. Default is `arm64-v8a` only: four unstripped ABIs of the Rust
shell is what made the 0.0.2 apk 623 MB.

## What the phone does now

- Its own daemon on `127.0.0.1:6769`, from the moment the app opens.
- Its own identity: the first launch shows **create a chain** or **join one**,
  and creating works on the device without another machine being up.
- Every chain feature the daemon has: sessions, checkpoints, workspace sync,
  cron, env, remote `run_on_node`.
- Peers over Tailscale: with `ROAN_HOST=lan` the one port is reachable from the
  tailnet on `/peer`, and discovery finds the other machines the same way they
  find it.
- **Where is the daemon?** in the app is now only for looking at another
  machine's daemon; empty means the daemon on this device. The value is stored
  under `roan.daemon.remote`, so an address saved by an older build is ignored
  rather than quietly pointing the phone at another machine.

## What is still missing

- **A foreground service.** The daemon is a thread in the app process, so it
  stops when Android kills the app. The design is the section below; it is not
  implemented.
- **Background sync of any kind.** Same service; without it a closed app syncs
  nothing.
- **The share sheet.** Text and single files into a session's composer.
- **Signing and the store.** The apk is debug-signed; Play wants a release
  keystore and an AAB.
- **A real install test.** The build ships libnode and the daemon inside the apk
  and the bundle is proven on plain Node, but the daemon has not run on the phone
  yet. Until it has, this page is the design and the code, not a receipt.

## Joining a chain

A phone joins by adopting a chain that already exists, never by merging.

- The inviter gets an invite code: one string, base64url of
  `{ v, chain, token, host, port }`. Whoever holds it can read the chain, so it is
  a secret and is never logged.
- The phone pastes it. The code names a chain and a peer address, not a session,
  and the inviting node has no special role afterwards.
- The phone keeps the chain id and token as its identity, parks its own env aside
  under a timestamped folder so nothing is lost silently, then pulls that chain's
  sessions, env, skills and MCP definitions.
- Its own conversations and settings are not offered to the chain, not even as a
  diff. The only way local data becomes chain data is creating a new chain, once
  per person.
- Keys stay on the device and never travel in an event.

This follows the ground rules: no central service, one writer per turn, joining
adopts the chain. A phone that has pulled the events may read them; it may not
append until it runs a turn itself.

## The sync service (design)

Android freezes a background app, so the phone runs a foreground service, started
by the app, with one ongoing notification that cannot be swiped away. Its type is
`dataSync`.

It does:

- hold the process and the peer connection open, so events keep arriving while
  the screen is off;
- keep the on-disk chain store in step, including catch-up after a network drop;
- come back after a reboot if the user had left sync on;
- stop when the user turns sync off, and take the notification with it.

It does not:

- run a turn the user did not start, or make the phone a server others can drive;
- promise delivery during Doze or app standby. Those windows belong to the
  system; the UI says messages may arrive late, not that sync is instant;
- ask for a battery optimisation exemption by default. If offered, it is a
  setting with the trade-off written beside it;
- keep a second copy of the chain or a separate sync log. One store.
- On Android 15 and later the system caps `dataSync` at roughly six hours in any
  24, so the service must tolerate being stopped and resumed.

## The notification channel (design)

One channel, created on first launch:

- id: `roan-sync`
- importance: low. It appears in the shade; no sound, no heads-up banner.
- one channel because every notification the app posts is the same subject: the
  state of the chain on this phone. A switch per session or per event would give
  the user several controls that all mean "sync" and always move together.

The ongoing notification uses this channel and shows the chain's short id and
whether the phone is connected, catching up or offline. Errors that need the user
are shown in the app, where the detail is readable, not as a second notification.

## Sharing into a session (design)

The app registers for the share sheet, for plain text and a single file.

1. Text is taken as-is. A file is read through the URI the sharing app handed
   over, so Roan never needs access to all of storage.
2. A picker lists the chain's sessions, most recent first.
3. On confirm the content becomes a draft in that session's composer. A file
   becomes an attachment line with name and size, not inlined bytes.
4. The draft stays a draft. Nothing is appended until the user presses send, and
   if a turn is already running on another node the composer waits rather than
   queueing a second writer.
5. Oversized files are refused with the limit stated. The temporary copy is
   deleted if the user cancels.

Sharing starts a message; it never sends one behind the user's back.
