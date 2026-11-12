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

The workflow is written, not proven: nothing in this tree shows it producing a
published release. Signing, notarisation, checksums, winget manifests, store
listings and an auto-update feed are all absent. See `docs/packaging.md`.
