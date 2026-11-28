# Updates

Every installed build checks the public repository itself:
`https://api.github.com/repos/roanh47/Roan/releases/latest`. There is no feed to
host, no `latest.json` to publish and no version list to keep in sync — the
release tag is the version, and the assets are the downloads.

This document covers what each platform can do alone, what it deliberately
cannot, and the exact asset names the picker matches. The code is
`src/packaging/github-releases.ts` (check, asset picking, planning, download)
and `src/packaging/update-flow.ts` (one call that does all of it).

## The check

One `GET`, no token, `accept: application/vnd.github+json`, 10 s budget.

The answer is one of four values, and `checkGithubRelease` never throws:

| Result | Meaning |
| --- | --- |
| `{kind:"update", current, latest, notes, asset}` | The release tag is newer and one asset fits this machine. |
| `{kind:"current", version}` | The tag is the same or older than the running build. |
| `{kind:"unreachable", reason}` | No usable answer: DNS/TLS failure, timeout, non-2xx (404, 403 rate limit, 5xx). |
| `{kind:"invalid", reason}` | Something answered but it cannot be acted on: not JSON, not a release object, a `draft`, a `prerelease`, an unparseable tag, or no asset for this platform/arch. |

An unreachable check is **not** "you are up to date". The plan says so in words,
because a build that cannot check has no idea whether it is current.

`draft` and `prerelease` releases are never offered. `/releases/latest` already
excludes them, so seeing one means the answer did not come from that endpoint —
the check refuses it rather than installing a build the project did not publish.

The tag is read as `tag_name`, with one optional leading `v` removed
(`v0.1.1` → `0.1.1`). Versions are compared by `src/packaging/semver.ts`; a tag
that is not `major.minor.patch[-prerelease]` is `invalid`.

### Rate limit

Anonymous GitHub API calls are limited to 60 per hour per IP address, shared by
everything behind that address. A check that gets 403/429 reports `unreachable`
with that hint. A build should check on start (at most once per day), not on a
timer, and a failed check should be retried on the next start rather than
immediately.

There is no token in the app, on purpose: a shipped binary cannot keep one
secret, and a token that leaks is worse than a rate limit.

## The assets the picker matches

`pickAsset(assets, platform, arch)` is pure and only looks at `name`. The
patterns below are the contract with `.github/workflows/release.yml` and
`tests/release-assets.test.ts`; renaming an artefact without updating this table
means the update check silently stops finding it.

| Target | Published name | How it is matched |
| --- | --- | --- |
| Linux x64 | `Roan-<version>-x86_64.AppImage` | name ends in `.AppImage`, names `x86_64`, `amd64` or `x64`, and does not name `arm64`/`aarch64` |
| Linux arm64 | `Roan-<version>-aarch64.AppImage` | name ends in `.AppImage` and names `arm64`/`aarch64` (nothing is built for this today, so arm64 Linux reports "no asset") |
| Windows x64 | `Roan-<version>-x64.exe` | name ends in `.exe` and names `x64`/`amd64`/`x86_64`, not `arm64` |
| macOS arm64 | `Roan-<version>-arm64.dmg` | name ends in `.dmg` and names `arm64`/`aarch64` |
| macOS x64 | `Roan-<version>-x64.dmg` | name ends in `.dmg` and names `x64`, or `universal` (not built today) |
| Android (universal) | `Roan-<version>.apk` | name ends in `.apk` and names no ABI |
| Android (split) | `Roan-<version>-arm64-v8a.apk`, `-x86_64.apk`, `-armeabi-v7a.apk`, `-x86.apk` | name ends in `.apk` and names the ABI for `process.arch`; preferred over the universal APK |

Rules that matter when adding a build:

- A name that claims another architecture is never accepted as a fallback. An
  arm64 machine will not be handed an `x86_64` AppImage.
- A name with no architecture at all is accepted as universal (`2`), but a name
  that explicitly names this architecture wins (`3`).
- `universal` in a `.dmg` name is accepted for both macOS architectures.
- Ties are broken by shorter name, then by code-unit order, so a release always
  picks the same file.
- An unknown platform, an unknown architecture, or no matching asset returns
  `null`; a newer release with no usable asset is reported as `invalid`, naming
  the target and the assets that were present.

## What each platform does with the download

`planGithubUpdate(result, target)` returns one of three actions and the notes a
person reads:

| Platform | Action | What the app does | What it cannot do alone |
| --- | --- | --- | --- |
| Linux | `download` | Verifies the AppImage, then replaces the running file in place when that file is writable | Nothing, when the file is writable. When it is not (`/opt`, root-owned), the new file must be started from wherever it was saved |
| Windows | `download` | Verifies the `.exe` and hands it over to be opened | Run the NSIS installer: it must be opened and confirmed, and it will replace the installed version |
| macOS | `download` | Verifies the `.dmg` and hands it over to be opened | Mount the image, copy `Roan.app` into `Applications` and get past Gatekeeper |
| Android | `manual` | Verifies the APK and hands the file to the system package installer | Replace its own package. Android always shows its own install confirmation |

### Linux (AppImage)

An AppImage is one file, so this is the only platform where a self-update is a
real self-replacement. The download lands as `<dest>.part-<random>` in the same
directory, is hashed while it streams, and is renamed onto the target path only
after the digest matches — a rename inside one directory is atomic, so a crash
leaves either the old file or the new one, never half of one.

Two honest caveats:

- A running AppImage keeps its open inode, so the swap takes effect on the next
  start. The currently running process is still the old build.
- The file must be writable by the user running it. When it is not, the plan says
  so and the user starts the new file from where it was saved (`chmod +x`).

### Windows (NSIS `.exe`)

The download is an installer image, not a replacement file. This module fetches
and verifies it; the user opens it and the NSIS installer replaces the installed
version. Nothing in the app runs the installer silently, and nothing pretends
the update is applied once the download finishes.

The installer is not Authenticode-signed today, so SmartScreen warns on first
run ("More info" → "Run anyway"). A signed build removes the warning; it does
not change any of the above.

### macOS (`.dmg`)

Same shape as Windows: the download is a disk image holding `Roan.app`. The user
opens it, drags the app into `/Applications` and confirms the replacement.
Gatekeeper refuses the first launch of an unsigned, non-notarised build until the
user allows it under System Settings → Privacy & Security.

### Android (`.apk`)

An app cannot replace itself on Android. The APK is downloaded and verified, then
handed to the system installer (a `FileProvider` URI opened with
`ACTION_VIEW`/`ACTION_INSTALL_PACKAGE`, or `PackageInstaller` for a silent-as-
possible flow). The system shows its own confirmation and does the install. That
is why the plan says `manual`: the file arrives, the install needs one more tap
that only the OS can ask for.

Three things that will bite:

- `REQUEST_INSTALL_PACKAGES` plus a user-granted "install unknown apps" for Roan
  (or for the file manager that opens the APK) is required.
- The new APK must be signed with the same key as the installed one. A debug-
  signed build cannot update a release-signed install, and vice versa; the
  installer fails with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`.
- The downloaded file must live where a `FileProvider` can serve it (app-private
  storage), not in a world-readable temp path.

## Downloading and verifying

`downloadAndVerify({fetch, url, dest, sha256?, maxBytes?})`:

1. Refuses a non-http(s) URL and a malformed expected digest before any request.
2. Streams the body to `<dest>.part-<random>` in `dest`'s directory, hashing as
   it goes. No second read, no window where an unverified file sits at `dest`.
3. Enforces a byte cap (default 1.5 GB, `maxBytes` to lower it) before each chunk
   is written; an oversize body is refused and the partial file deleted.
4. Compares SHA-256 when the release publishes one, flushes, then renames.
5. Deletes the temporary file on every failure and returns
   `{ok:false, reason}` — it never throws.

Where the SHA-256 comes from: GitHub's per-asset `digest` field
(`sha256:<64 hex>`). A digest in another algorithm is `invalid`, not
"unverified"; a missing digest is allowed, and the plan says the download is not
verified beyond TLS.

What a matching digest proves: the bytes are the ones GitHub served. It does not
prove who built them. There is no signature and no GPG key in this project, so
`sha256` is an integrity check, not an authenticity check. Say that plainly
wherever the update is described.

## What still has to be wired

- The daemon: call `checkGithubAndPrepareUpdate({currentVersion, platform, arch})`
  from `src/version.ts`'s `VERSION` and `process.platform`/`process.arch`
  (`"android"` inside the APK). It returns `{check, plan, download}` and does not
  reject.
- The UI: mount `UpdateCard`, render `plan.action` and `plan.notes`, and use
  `download.path` for "open the installer" / "install".
- Nothing in this module installs anything. Opening the downloaded file, and the
  AppImage swap, are the caller's job.

## Checklist for a release that ships updates

- [ ] `package.json`, `src-tauri/tauri.conf.json`, `src/version.ts` and the
      workflow's `APP_VERSION` name the same version.
- [ ] The release is published, not a draft, and not marked prerelease.
- [ ] The asset names still match the table above
      (`npx tsx --test tests/release-assets.test.ts`).
- [ ] The tag is `v<version>` or `<version>`; anything else is not comparable.
- [ ] On Linux, the new AppImage was started once before publishing.
