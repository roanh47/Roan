# Installing Roan

A release is four files, one per platform, named `Roan-<version>-<arch>.<ext>`.
Nothing is published yet: the workflow in `.github/workflows/release.yml` is
written but has not produced a release, so treat the steps below as what the
artifacts are meant to do. Packaging details are in `docs/packaging.md`.

## The four artifacts

| Platform | File | Install |
| --- | --- | --- |
| Windows x64 | `Roan-<version>-x64.exe` (NSIS) | Run it. WebView2 is fetched by the bootstrapper if missing. |
| macOS arm64 | `Roan-<version>-arm64.dmg` | Open, drag `Roan.app` into Applications. Apple Silicon only. |
| Linux x86_64 | `Roan-<version>-x86_64.AppImage` | `chmod +x` the file, then run it. |
| Android | `Roan-<version>.apk` | Sideload. Needs Android 7.0 (API 24) or later and "install unknown apps" for the file manager. |

Each installs the shell and the web bundle inside it. It does not install the
agent. The daemon is a separate process on the same machine and, today, is
started from a checkout with `npm run dev`; the app does not spawn it. The
window will open and show onboarding with no daemon behind it.

## The unsigned warning

None of the four are signed for distribution.

- **Windows** — no Authenticode certificate. SmartScreen warns on first run and
  the publisher shows as unknown. "More info" → "Run anyway".
- **macOS** — no Developer ID and no notarisation ticket. Gatekeeper refuses the
  first launch; right-click `Roan.app` → Open → Open, or allow it under System
  Settings → Privacy & Security.
- **Linux** — the AppImage has no embedded GPG signature. There is nothing to
  bypass; the only integrity check is a published SHA-256 next to the file, if
  one is published.
- **Android** — the APK is debug-signed by the build, not with a release key.
  Play Protect may flag it as an unknown developer; the phone asks you to allow
  the install.

Signing is a manual step with material the project owner holds. No key,
certificate or notary credential belongs in this repository, and none is in it.
An unsigned build is expected to warn; that is not a bug report.

## Linux launcher entry

An AppImage adds nothing to the application menu. The `.desktop` helper in
`src/packaging/` generates an entry, but writing it to
`~/.local/share/applications/` — with the absolute path to wherever the
AppImage sits — is still manual.

## Where `~/.roan` lives

All state hangs off one directory, the same name on every platform:

```
Linux     /home/<user>/.roan/
macOS     /Users/<user>/.roan/
Windows   C:\Users\<user>\.roan\
Android   /storage/emulated/0/.roan/
```

It holds `config.json`, `secrets/` (identity, mode 0600), `workspace/`
(`chain.db`, parked state, caches) and `synced-workspace/` (the turn's working
directory). `ROAN_HOME` overrides the root; nothing else should. The daemon
creates the directories on first start, so the folder may not exist until then.

Uninstalling the app does not remove this folder. Delete it by hand only if you
mean to lose the chain, the identity and the parked env.
