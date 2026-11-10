# What a release is

Roan ships as an app, not a page. This page describes what a release contains on
each desktop platform, what signs it, what a person still has to do by hand, and
what the helpers in `src/packaging/` actually do — and don't.

One caveat shapes the rest: no release has been built or published from this
tree. The workflow file and the helper modules describe the intended shape; the
"Not yet true" section at the end says exactly where the gaps are.

## 1. One UI, one shell

The interface is plain frontend code in `web/`: React, Vite, no router, no login
page. `npm --prefix web run build` writes `web/dist/`. `vite.config.ts` sets
`base: "./"`, so `dist/index.html` loads its assets relatively, from disk rather
than from an origin. That is what makes the same bundle work inside a native
window and inside an Android WebView.

The desktop shell is Tauri in `src-tauri/`. `tauri.conf.json` points
`build.frontendDist` at `../web/dist`, and `src-tauri/src/lib.rs` runs
`tauri::Builder::default()` and nothing else. The bundle is compiled into the
binary by `tauri::generate_context!()`, so the app opens standalone: no local
server, no `localhost` URL. The window is declared in config — one window
labelled `main`, dark theme, 1180×780 — and holds only the `core:default`
capability.

The shell does not yet call into the agent. The daemon is a separate process on
the same machine, and the UI talks to it over a loopback WebSocket. Packaging
therefore does not need to ship the agent's code, only the shell and the bundle
inside it.

## 2. What a release is

A tag of the form `v<version>`, where `<version>` matches `version` in
`src-tauri/tauri.conf.json`. Four files hang off it — one Windows, one macOS,
one Linux, one APK — named `Roan-<version>-<arch>.<ext>` and nothing else.
Android is a second shell built from the same `web/dist/` and is not covered
here.

| Platform | Artifact | Produced by |
| --- | --- | --- |
| Windows x64 | one `.exe` installer, NSIS | `npx @tauri-apps/cli build --bundles nsis` |
| macOS arm64 | `.dmg` | the same command with `--bundles dmg` and `--target aarch64-apple-darwin` |
| Linux x86_64 | `.AppImage` | the same command with `--bundles appimage` |

Each platform builds on its own machine. A Tauri app links against the system
webview — WebView2, WKWebView, WebKitGTK — so there is no cross-compiling a
desktop bundle from one host.

## 3. Windows

The artifact is a single self-contained NSIS installer, `Roan-<version>-x64.exe`.
It carries the app and the web bundle; WebView2 is fetched by the installer's
bootstrapper if the machine does not already have it.

Nothing signs it. Authenticode needs a code-signing certificate and a
`signtool` step on the build machine, and neither exists here. Until that
changes, Windows shows the publisher as unknown and SmartScreen warns on first
run. The signing certificate is not a build input anyone can commit; it is
purchased, identified and stored by the owner of the project.

Manual steps: obtain and hold the certificate, sign the `.exe` after the
bundler finishes, verify the signature on the file itself, and install it on a
clean machine to see the real warnings a user would see.

## 4. macOS

The artifact is a `.dmg` for Apple Silicon. It holds `Roan.app`; the user drags
it into Applications. Only arm64 is built: a universal binary would roughly
double the download for the older Macs this does not target.

Signing is absent. A real release needs a Developer ID Application certificate
to sign the app, then notarisation through `notarytool` with an Apple ID and an
app-specific password, then `stapler staple` so the ticket travels with the
`.dmg` and works offline. Without that chain, Gatekeeper refuses the first
launch and the user has to right-click and choose Open. Ad-hoc signing may keep
the binary loadable on the build machine; it does not satisfy Gatekeeper for
anyone else and is not a distribution signature.

Manual steps: an Apple Developer account, the certificate in the login keychain,
notary credentials held outside the repo, the submit-and-wait call, the staple,
and a first run on a Mac that has never seen the app.

The notarisation helper in `src/packaging/` lays this sequence out as data. It
does not call Apple and holds no credentials.

## 5. Linux

The artifact is an AppImage, `Roan-<version>-x86_64.AppImage`. It is one
executable file: the user makes it executable and runs it. It carries no
installer and no package metadata of its own.

There is no signature. AppImages can carry an embedded GPG signature via
`appimagetool`, but that requires a key, a published public half, and a user who
checks it — none of which exist here. The practical integrity story is a
published SHA-256 next to the file.

An AppImage also does not put anything in the application menu. A user who
wants a launcher entry needs one written to
`~/.local/share/applications/`, with the correct absolute path to wherever they
put the file. That entry is what the desktop-entry helper generates; installing
it remains a manual step, or a job for a real package format.

Manual steps: decide whether to sign, publish the checksum, install the desktop
entry, and test on a distribution that is not the build machine — different
WebKitGTK versions are the usual surprise.

## 6. The helpers in `src/packaging/`

These modules compute release metadata. Each is a plain function over data: a
version in, a string or object out. They do not run a build, do not open a
network connection, do not read or hold a key, and do not sign or upload
anything.

| Module | What it produces |
| --- | --- |
| `semver.ts` | strict `major.minor.patch` parsing, bumping and formatting |
| `icons.ts` | the size matrix per platform, the sizes missing from a set, canonical file names |
| `checksums.ts` | SHA-256 for a list of paths, and `sha256sum`-compatible text |
| `winget.ts` | a winget manifest object, plus double-quoted YAML for it |
| `desktop-entry.ts` | a `.desktop` file: name, exec line, icon, category |
| `notarize.ts` | the sign → zip → submit → staple plan as argument vectors |

A few of them mirror values that already exist elsewhere: the manifest
identifier matches `identifier` in `tauri.conf.json` (`dev.roan`), which is
already publisher-and-app shaped, and the desktop category matches
`bundle.category` (`DeveloperTool`). The helpers are where those values are
meant to be read from one place rather than retyped.

Nothing here decides a version. `semver.ts` parses, bumps and formats; it does
not read the config files or tell you which copy is right. That matters because
the copies already disagree: `tauri.conf.json` and `Cargo.toml` say `0.0.1`,
while `package.json` and `web/package.json` say `0.1.0`. A release has to settle
that by hand before a tag means anything.

`checksums.ts` reports a file it could not read instead of throwing, so a caller
can see the full set and decide whether a package may ship. `winget.ts` validates
its input and fails loudly, because winget rejects a bad identifier at
submission time. `notarize.ts` takes the *names* of credential environment
variables and emits a literal `$NAME` for the shell to expand — it never reads,
echoes or stores the values.

Five of the six are in the tree today: `checksums.ts`, `icons.ts`, `notarize.ts`,
`semver.ts` and `winget.ts`. `desktop-entry.ts` is described above as intended
and is not written yet.

## 7. What a person does, in order

1. Pick the version and apply it to every copy by hand — the config, the
   manifests, and the tag.
2. Build the bundle: `npm --prefix web run build`, then build the shell on each
   target platform.
3. Sign, if and only if a certificate is in hand. This is the step that cannot
   be automated away, because the key is not in the repository and never will
   be.
4. Generate checksums, the winget manifest, and the desktop entry from the
   finished files.
5. Tag `v<version>`, matching `tauri.conf.json` exactly.
6. Install the result on a machine that has never run Roan before.

`.github/workflows/release.yml` runs steps 2 to 5 on tag pushes, one job per
platform, and collects exactly one file from each. It is written, not proven:
it has not produced a published release, and it currently pins the artifact
names to a single hard-coded version.

## 8. Not yet true

- **No working CI release pipeline.** A workflow file exists and is written to
  build, collect and publish; nothing in this tree shows it having run to a
  release, and its artifact names are hard-coded to one version rather than read
  from `tauri.conf.json`.
- **No code-signing keys, certificates or notary credentials in the repo.** None
  should ever be added. Signing stays a step a person performs with material
  they hold.
- **No store listings.** No Microsoft Store, Mac App Store, Flathub or Snap
  entry exists. Distribution is a file the user downloads.
- **No published artifacts.** Nothing is downloadable, and the version numbers in
  the tree disagree with each other.
- **No auto-update channel.** There is no update feed, and the app does not
  check for one.
- **No screenshots.** This page describes files and steps; it does not show a
  build, an installer or a signed binary, because none exist yet.
