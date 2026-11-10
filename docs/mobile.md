# The phone app

The phone is a node, not a window. The Android app carries the agent loop, keeps
its own copy of the chain and works when the rest is offline. It is built from the
same UI code in `web/`, bundled in a native shell. Nothing on this page runs yet;
the last section says what is missing.

## Joining a chain

A phone joins by adopting a chain that already exists, never by merging.

- The inviter gets an invite code: one string, base64url of
  `{ v, chain, token, host, port }`. Whoever holds it can read the chain, so it is
  a secret and is never logged.
- The phone pastes or scans it. The code names a chain and a peer address, not a
  session, and the inviting node has no special role afterwards.
- The phone keeps the chain id and token as its identity, parks its own env aside
  under a timestamped folder so nothing is lost silently, then pulls that chain's
  sessions, env, skills and MCP definitions.
- Its own conversations and settings are not offered to the chain, not even as a
  diff. The only way local data becomes chain data is creating a new chain, once
  per person.
- Keys stay on the device, in the Keystore, and never travel in an event.

This follows the ground rules: no central service, one writer per turn, joining
adopts the chain. A phone that has pulled the events may read them; it may not
append until it runs a turn itself.

## The sync service

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

## The notification channel

One channel, created on first launch:

- id: `roan-sync`
- importance: low. It appears in the shade; no sound, no heads-up banner.
- one channel because every notification the app posts is the same subject: the
  state of the chain on this phone. A switch per session or per event would give
  the user several controls that all mean "sync" and always move together.

The ongoing notification uses this channel and shows the chain's short id and
whether the phone is connected, catching up or offline. Errors that need the user
are shown in the app, where the detail is readable, not as a second notification.

## Sharing into a session

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

## Not built yet

- There is no Android project in the repository: no Gradle build, no manifest, no
  share intent filter, no APK, no Play Store listing.
- There is no foreground service and no notification code. The channel above is a
  definition, not something the app creates today.
- There is no background sync of any kind.
- Joining writes an identity and stops. It does not dial the inviting node or
  pull sessions, env and skills, so no device could adopt a chain yet; see
  `docs/invite-flow.md`.
- The UI has a transcript, composer, turn status and an invite card, but no
  session list, so the share picker has nothing to show.

Order of work: make join actually pull the chain, add a session list, then the
shell, then the service and the share target.
