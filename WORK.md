# What is left for 0.0.1

The loop takes the first unchecked item, does only that, verifies it, commits and
pushes, and ticks the box. One item per run. Never start a second one.

Rules for every item:

- Do not explore the repo. Open the files the item names, plus the one you must edit.
- Verify with `npx tsc --noEmit`, `npm test` and `npm run build` before committing.
- Commit and push to `main`. Leave the tree clean.
- If an item cannot be finished in this run, leave its box unticked and say what blocked it.

## 1. Onboarding screen

- [ ] The app asks the daemon for `{t:"state"}` on open. When `onboarding` is true it
      shows one screen with two buttons: **Create a chain** and **Join a chain**.
      Create sends `{t:"create_chain"}` and then shows the `invite` code it gets back
      with a copy button. Join shows a text field, sends `{t:"join_chain", code}` and
      shows `control_error.message` inline when it fails. Files: `web/src/App.tsx`,
      `web/src/chain.ts`, a new `web/src/components/Onboarding.tsx`.

## 2. Provider and model picker

- [ ] Settings screen listing providers from `src/providers/catalog.ts` (search field,
      235 entries), and for the chosen provider its models. Choosing one writes
      `{provider, baseUrl, model}` to `~/.roan/config.json` through a new daemon frame
      `{t:"save_settings"}`. Files: `src/daemon/control.ts`,
      `src/daemon/control-protocol.ts`, `web/src/components/Settings.tsx`.

## 3. Invite screen

- [ ] A screen that shows this machine's invite code (from the daemon, not from a log
      line) at any time, so a second machine can join later without recreating the
      chain. Add `{t:"invite"}` → `{t:"chain", chain, node, invite}`. Files:
      `src/daemon/main.ts`, `src/daemon/control.ts`, `web/src/components/Invite.tsx`.

## 4. Peers actually connect

- [ ] After a join, the daemon starts the peer server on port 7412 and connects to the
      host and port in the code, then replicates with `src/sync/replicate.ts` so both
      machines hold the same chain. Report in `state.peers`. Files: `src/daemon/main.ts`,
      `src/daemon/peers.ts`.

## 5. Release

- [ ] When 1 to 4 are ticked: bump `tauri.conf.json` to 0.0.1 if needed, push tag
      `v0.0.1`, watch the workflow, and report which of the four artifacts landed.
