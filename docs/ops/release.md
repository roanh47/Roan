# Releasing Roan

`.github/workflows/release.yml` builds every artifact in CI. Nothing here runs on
a developer machine; a tag push is the only trigger.

## The tag

```sh
git tag v0.0.1
git push origin v0.0.1
```

The workflow fires on any `v*` tag, but publish rejects the run unless the tag is
exactly `v` plus `version` from `src-tauri/tauri.conf.json`:

```sh
conf="$(node -p "require('./src-tauri/tauri.conf.json').version")"
[ "${GITHUB_REF_NAME}" = "v${conf}" ]   # or the job fails
```

So the tag is `v0.0.1` today, and `v0.0.2` only after `tauri.conf.json` says
`0.0.2`. The version is not read from git anywhere else, and the artifact names
below are hard-coded to `0.0.1` — bump them in the same commit that bumps the
config.

## Four runners, four builds

Each job checks out, sets up Node 22, Rust stable (plus `swatinem/rust-cache`),
builds `web/dist/`, then runs one bundler command. Every job also proves the UI
is bundled: `web/dist/index.html` must exist and `build.devUrl` must be unset.

| Job | Runner | Command | Artifact name |
| --- | --- | --- | --- |
| `windows` | `windows-latest` | `npx --yes @tauri-apps/cli@^2 build --bundles nsis --verbose` | `Roan-0.0.1-x64.exe` |
| `macos` | `macos-latest` | `npx --yes @tauri-apps/cli@^2 build --target aarch64-apple-darwin --bundles dmg --verbose` | `Roan-0.0.1-arm64.dmg` |
| `linux` | `ubuntu-22.04` | `npx --yes @tauri-apps/cli@^2 build --bundles appimage --verbose` | `Roan-0.0.1-x86_64.AppImage` |
| `android` | `ubuntu-22.04` | `npx --yes @tauri-apps/cli@^2 android init --ci`, then `npx --yes @tauri-apps/cli@^2 android build --apk --debug --ci` | `Roan-0.0.1.apk` |

Per platform:

- **Windows** — NSIS installer, not MSI. Self-contained `.exe`; WebView2 is
  fetched by the bootstrapper if missing. Unsigned, so SmartScreen warns.
- **macOS** — Apple Silicon only; a universal binary would roughly double the
  download for Intel Macs nobody targets. Unsigned, so Gatekeeper needs
  right-click → Open on first launch.
- **Linux** — AppImage only, `chmod +x` applied in CI. Installs to the
  application menu only if the user writes a `.desktop` entry.
- **Android** — debug-signed universal APK, installable on a real phone with
  "install unknown apps" enabled. No keystore secrets involved.

Each job copies exactly one bundler output into `out/` under the name above,
deletes `src-tauri/target/*/release/bundle` so no second file can escape, and
uploads `out/<name>` as an artifact (7-day retention, `if-no-files-found: error`).

## The AppImage, built and run on this machine

Not a plan: the following was executed on 2026-11-26 on Debian 13 (trixie),
kernel 6.12.85, Rust 1.98.1, Node 22.22.2, against `tauri.conf.json` version
`0.0.23`.

```sh
npm --prefix web run build                      # web/dist
npm run build                                   # daemon TS -> dist/
node scripts/build-sidecar.mjs x86_64-unknown-linux-gnu
npx tauri build --config src-tauri/tauri.desktop.conf.json --bundles appimage
```

System dependencies: none had to be installed. `libwebkit2gtk-4.1-dev`,
`librsvg2-dev`, `patchelf`, `libgtk-3-dev` and `libfuse2` (the AppImage type-2
runtime needs the FUSE 2 library) were already present.

Result on a warm `src-tauri/target`:

```
Finished 1 bundle at:
    src-tauri/target/release/bundle/appimage/Roan_0.0.23_amd64.AppImage (141.79 MiB)
real    1m31.234s
```

148,679,160 bytes, sha256
`16f3eabf3dab9cf9edc439299094708baa75c445a421b37aca7c640abd25f4b1`, plus the
`Roan_0.0.23_amd64.AppImage.sig` the updater plugin needs.

### Why the first build exited 1 with a valid AppImage next to it

`bundle.createUpdaterArtifacts` is `true` and `plugins.updater.pubkey` is set,
so the bundler signs the AppImage for the updater after writing it. Without a
private key the file is produced and the command then fails:

```
A public key has been found, but no private key. Make sure to set
`TAURI_SIGNING_PRIVATE_KEY` environment variable.
       Error [tauri_cli_node] ... (exit 1)
```

CI passes `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
from repository secrets, so the step has a key there — provided those secrets
are actually set. To reproduce a green local build, generate a throwaway key
**outside the repo** and point the build at it:

```sh
npx tauri signer generate -w ~/.config/roan/updater-dev.key -p 'some-password' --ci
TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.config/roan/updater-dev.key)" \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD='some-password' \
  npx tauri build --config src-tauri/tauri.desktop.conf.json --bundles appimage
```

That exited 0 and printed a warning worth understanding: a dev key does not
match the committed `pubkey`, so the resulting `.sig` is useless for real
updates. A release must be signed with the key whose public half is in
`tauri.conf.json`.

### It launches

`scripts/appimage-smoke.sh` starts the AppImage on a headless Xvfb display,
waits for the window and the sidecar, prints what it saw, and exits 0 only if
both exist. Real output:

```
appimage:   .../bundle/appimage/Roan_0.0.23_amd64.AppImage
app pid:    4191374 (alive: yes)
waited:     31s
window:          0x200003 "Roan": ("roan" "Roan")  1180x780+50+10  +50+10
daemon:     .../.mount_Roan_0Madggk/usr/bin/roan-daemon  (pid 4192359)
--- process tree ---
4191374 4191373 Sl         00:31 roan
4192354 4191374 SLl        00:00 ././/lib/x86_64-linux-gnu/webkit2gtk-4.1/WebKitNetworkProcess 1 15
4192358 4191374 SLl        00:00 ././/lib/x86_64-linux-gnu/webkit2gtk-4.1/WebKitWebProcess 4 18
4192359 4191374 Sl         00:00 .../usr/bin/roan-daemon
RESULT: launched (window + daemon observed)
```

The webview painted the real first screen, not a blank page: `Start on this
device`, `Create a new chain`, and the footer line `The daemon is running on
this device.` — which is the UI talking to the sidecar the shell started.

One caveat about this host, not about the artifact: `/dev/dri/renderD128`
belongs to group `render` and the build user is only in `video`, so WebKitGTK
stalls in EGL init for about half a minute before falling back. The smoke
script therefore exports `LIBGL_ALWAYS_SOFTWARE=1`, `GALLIUM_DRIVER=llvmpipe`,
`WEBKIT_DISABLE_DMABUF_RENDERER=1`, `WEBKIT_DISABLE_COMPOSITING_MODE=1`,
`GTK_USE_PORTAL=0` and `NO_AT_BRIDGE=1`. On a machine with a usable GPU and a
desktop session none of that is needed; without it the window simply never
maps, which looks like a hang.

## Android keystore and secrets

`scripts/android-keystore.sh` generates the release keystore. It writes key
material **outside** the repository (default
`~/.local/share/roan/keys/roan-release.p12`, directory 0700, files 0600),
refuses any `--out` that resolves inside the checkout — including paths that
get there through `..` or a symlink — and never prints a password.

```sh
scripts/android-keystore.sh --help
scripts/android-keystore.sh                       # prompts, hidden input
scripts/android-keystore.sh --out ~/keys/roan.p12 --alias roan
scripts/android-keystore.sh --upload              # also `gh secret set` the four
```

Passwords come from `ROAN_KEYSTORE_PASSWORD` / `ROAN_KEY_PASSWORD` when set,
otherwise from a silent prompt (no TTY and no variable is an error, never a
guess). The keystore is PKCS12 with an RSA 4096 key valid 10000 days; if the
key password differs from the store password it switches to JKS, because
PKCS12 can only hold one password. Passwords reach `keytool` through
`-storepass:env` / `-keypass:env` and `gh` through stdin, so neither ever shows
up in `ps` or in the script's output.

The four repository secrets, by name:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | base64 of the `.p12`/`.jks` file (the script also writes it next to the keystore) |
| `ANDROID_KEYSTORE_PASSWORD` | store password |
| `ANDROID_KEY_ALIAS` | `roan` unless `--alias` says otherwise |
| `ANDROID_KEY_PASSWORD` | key password |

```
gh secret set ANDROID_KEYSTORE_BASE64 < ~/.local/share/roan/keys/roan-release.base64
printf '%s' "$ROAN_KEYSTORE_PASSWORD" | gh secret set ANDROID_KEYSTORE_PASSWORD
gh secret set ANDROID_KEY_ALIAS -b roan
printf '%s' "$ROAN_KEY_PASSWORD" | gh secret set ANDROID_KEY_PASSWORD
```

Checklist before the first signed APK:

- [ ] Keystore generated outside the repo, permissions 0600, backed up off this machine. Losing it means the installed app can never be updated under the same package name.
- [ ] All four secrets set on the repository (`gh secret list` shows them).
- [ ] Signing wired into Gradle: the generated `src-tauri/gen/android/app/build.gradle.kts` has **no** `signingConfigs` block today, so nothing reads those secrets yet.
- [ ] Keep that block applied after `android init`: it regenerates the Gradle file, so signing has to be re-applied like `scripts/android-daemon.sh` does for the libnode assets.
- [ ] Workflow builds a release APK. It currently runs `android build --apk --debug --ci`, i.e. debug-signed; a release build means dropping `--debug` and signing with the config above.
- [ ] Install the signed APK on a device that has the debug build installed: Android refuses the swap unless the signing key matches, so the old app has to be uninstalled first.
- [ ] Verify with `apksigner verify --print-certs Roan-<version>.apk`.

### The Android signing key is permanent

Every published APK must carry the certificate in `signing/android-cert-sha256.txt`
(SHA-256 of the signing certificate). Android refuses to install a version whose key
differs, so rotating this key ends the update path for everyone who already has the app:
they would have to uninstall and lose their local chain data.

CI re-signs the Gradle output with that key (`ANDROID_KEYSTORE_BASE64`,
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`) and fails the
job when the certificate does not match the pinned value. The keystore itself lives
outside the repository, at `~/.roan/signing/roan-release.jks` on the machine that made
it; back it up, never regenerate it.

The same rule applies to the desktop updater key (`TAURI_SIGNING_PRIVATE_KEY`): replacing
it invalidates updates for every installed desktop build.

`0.0.23` was published before this rule existed and was debug-signed per CI run, so it
cannot update itself and cannot be updated to. `0.0.24` is the first release with the
permanent key; from there on updates install in place.

## Windows: SmartScreen and code signing

Today the NSIS installer is unsigned. SmartScreen shows "Windows protected your
PC" and hides the app behind *More info → Run anyway*; on Windows 11 with Smart
App Control on, unsigned apps are blocked outright.

To sign:

- [ ] Buy a **code-signing** certificate (OV or EV; an SSL certificate will not work) or use Azure Trusted Signing. Nothing here invents an issuer or a thumbprint — those are yours.
- [ ] Keep the `.pfx` and its password outside the repository (secret / key vault).
- [ ] Give the bundler the certificate: `bundle.windows.certificateThumbprint` plus `digestAlgorithm: "sha256"` and a `timestampUrl` (an RFC 3161 server from your CA) in the Windows config, or `bundle.windows.signCommand` when signing happens in Azure Key Vault.
- [ ] Sign the installer **and** the app `.exe` it wraps — NSIS embeds the inner binary, and an unsigned inner exe still triggers warnings after installation.
- [ ] Verify on the build machine: `Get-AuthenticodeSignature .\Roan-<version>-x64.exe` reports `Status : Valid` and a timestamp certificate.
- [ ] Install on a clean Windows VM with no prior downloads: no SmartScreen prompt. Reputation is not instant for a new OV certificate; EV certificates and Trusted Signing are the usual shortcuts, and Microsoft's own docs are the source of truth.

## macOS: Gatekeeper and notarization

Today the DMG is ad-hoc signed (`APPLE_SIGNING_IDENTITY: "-"` in the workflow)
and not notarised. Ad-hoc keeps Apple Silicon from calling the app "damaged",
but Gatekeeper still refuses a browser-downloaded copy: the user has to
right-click → Open, or clear the quarantine flag by hand.

To ship a build that opens on double-click:

- [ ] Apple Developer account; a **Developer ID Application** certificate (App Store distribution is a different certificate and does not apply here).
- [ ] Export the certificate as `.p12`; set `APPLE_CERTIFICATE` (base64), `APPLE_CERTIFICATE_PASSWORD`, and `APPLE_SIGNING_IDENTITY` to the certificate's keychain name. Locally, installing it in the login keychain is enough.
- [ ] Sign with hardened runtime and a secure timestamp: `codesign --force --deep --options runtime --timestamp --sign "Developer ID Application: <name> (<TEAMID>)" Roan.app`. Hardened runtime is a notarisation requirement, not a nicety.
- [ ] Notarise: `xcrun notarytool submit Roan-<version>-arm64.dmg --apple-id <id> --team-id <team> --password <app-specific-password> --wait`. The password is an app-specific password, never the account password; Tauri reads the same values from `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` (or an App Store Connect API key) when they are in the environment.
- [ ] Staple the ticket so it works offline: `xcrun stapler staple Roan-<version>-arm64.dmg`, then `xcrun stapler validate`.
- [ ] Verify as a user would: `spctl -a -vvv -t install Roan-<version>-arm64.dmg` says `accepted / source=Notarized Developer ID`, and the app launches on a Mac that has never seen it.
- [ ] Only then is the DMG safe to publish; without the staple, a machine without network access still shows the Gatekeeper refusal.

## What publish checks

The `release` job runs only after all four builds succeed (`needs:` all four),
on `ubuntu-latest`:

1. **Tag matches the config version** — fails otherwise (see above).
2. **Downloads all four artifacts** with `merge-multiple: true` into `release/`.
3. **Keeps only the four expected files.** Anything else is deleted as a stray;
   any missing expected file fails the job:

   ```sh
   expected="Roan-0.0.1-x64.exe Roan-0.0.1-arm64.dmg Roan-0.0.1-x86_64.AppImage Roan-0.0.1.apk"
   ```

4. **Deletes any existing release for the tag** (`gh release delete --yes || true`),
   so a re-run replaces the release instead of accumulating old assets.
5. **Creates the release** with `softprops/action-gh-release@v2`: name
   `Roan v<version>`, `draft: false`, `prerelease: false`, and
   `fail_on_unmatched_files: true`.

The release body warns that builds are unsigned and that the APK is debug-signed.

## Honest state

What is proven: the Linux AppImage builds from this tree (`0.0.23`,
148,679,160 bytes) and, started headlessly, maps its 1180×780 window and runs
its sidecar — the output above is from that run. Windows, macOS and Android
artifacts were not built here: no Windows or Mac machine, no emulator, and the
APK path still builds debug-signed.

What is absent: code-signing certificates, notary credentials, an Android
release signing config in Gradle, checksums published next to the files, winget
manifests, store listings and an auto-update feed. `scripts/android-keystore.sh`
creates the key and names the secrets, but nothing in CI consumes them yet. The
workflow itself is still written, not proven: nothing here shows it producing a
published release. See `docs/packaging.md`.
