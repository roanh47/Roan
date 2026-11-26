/**
 * Updates straight from the public GitHub release of `roanh47/Roan`.
 *
 * Every installed build carries the same repository coordinates, so there is no
 * feed to host and no `latest.json` to keep in sync: the app asks
 * `releases/latest`, reads the tag for the version and picks the one asset that
 * belongs to the machine it is running on. What it does with that asset differs
 * per platform, and this module is deliberately honest about where a
 * self-update stops:
 *
 * - Linux: the AppImage is a single file, so a verified download can replace the
 *   running file in place (when that file is writable).
 * - Windows / macOS: the download is an installer image, which the OS expects a
 *   user to open. This module hands over the file; it does not run installers.
 * - Android: an APK cannot replace the app that is running. The download is
 *   handed to the system package installer, which shows its own confirmation.
 *
 * Three rules shape the code:
 *
 * 1. Nothing here throws to the caller. A network failure, a rate limit, a
 *    broken document and a release with no asset for this machine all come back
 *    as values, because an update check that crashes the app is worse than one
 *    that says it could not check.
 * 2. `draft` and `prerelease` releases are never offered, even if a proxy hands
 *    one back for `releases/latest`. `/releases/latest` already excludes them,
 *    so seeing one means the answer did not come from the endpoint we asked.
 * 3. A verified digest is used when the release publishes one (`digest`), and
 *    its absence is reported, never papered over. There is still no signature:
 *    HTTPS and a matching SHA-256 prove the bytes are the ones GitHub served,
 *    not that GitHub served what the project built.
 */

import { createHash, randomBytes } from "node:crypto";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { compareVersions } from "./semver.js";

/** Where the public releases live; both halves are baked into the app. */
export const GITHUB_OWNER = "roanh47";
export const GITHUB_REPO = "Roan";

/** The API root; overridable only so a test can point at a fake host. */
export const GITHUB_API_BASE = "https://api.github.com";

/** Default network budget for one check; the release document is small. */
export const DEFAULT_CHECK_TIMEOUT_MS = 10_000;

/** Default network budget for one installer download. */
export const DEFAULT_DOWNLOAD_TIMEOUT_MS = 300_000;

/**
 * Hard ceiling on a downloaded installer. Every artefact is well under 500 MB
 * today; the cap exists so a wrong (or hostile) body cannot fill the disk
 * before the digest check gets a chance to reject it.
 */
export const DEFAULT_MAX_BYTES = 1_500_000_000;

/** GitHub owner/repo names: no slashes, no spaces, no path tricks. */
const REPOSITORY_PART = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

/** Lower-case hex SHA-256, the only digest shape this project publishes. */
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** An `AppImage` file name, as the Linux bundler writes it. */
const APPIMAGE_SUFFIX = /\.appimage$/i;

/** One asset of a release, reduced to what an updater may use. */
export interface GithubReleaseAsset {
  /** File name exactly as published, e.g. `Roan-0.1.0-x86_64.AppImage`. */
  readonly name: string;
  /** `browser_download_url`: the bytes themselves, not the API document. */
  readonly url: string;
  /** Size in bytes as GitHub reports it; 0 when the field was unusable. */
  readonly size: number;
  /** Lower-case hex SHA-256 from `digest`, when the release published one. */
  readonly sha256?: string;
}

/** What one check of `releases/latest` concluded. */
export type GithubCheckResult =
  | {
      readonly kind: "update";
      /** Version that is running, as handed in. */
      readonly current: string;
      /** Version the release names, without the tag's `v` prefix. */
      readonly latest: string;
      /** Release body, trimmed; the empty string when the release has none. */
      readonly notes: string;
      /** The one asset that belongs to this platform and architecture. */
      readonly asset: GithubReleaseAsset;
    }
  | { readonly kind: "current"; readonly version: string }
  | { readonly kind: "unreachable"; readonly reason: string }
  | { readonly kind: "invalid"; readonly reason: string };

export interface GithubCheckOptions {
  /** Repository owner; defaults to `roanh47`. */
  readonly owner?: string;
  /** Repository name; defaults to `Roan`. */
  readonly repo?: string;
  /** The version this build is running. Required: it decides the answer. */
  readonly currentVersion: string;
  /** `process.platform` for the running app, or `"android"` inside the APK. */
  readonly platform: string;
  /** `process.arch`: `x64`, `arm64`, `ia32`, `arm`. */
  readonly arch: string;
  /** Injected in tests; defaults to the runtime's global `fetch`. */
  readonly fetchImpl?: typeof fetch;
  /** Milliseconds before the request is abandoned. Defaults to 10 s. */
  readonly timeoutMs?: number;
  /** API root override, for a fake host in tests. Defaults to GitHub. */
  readonly apiBaseUrl?: string;
}

/** "Answered, but not with something this app may act on." */
class ReleaseInvalid extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "ReleaseInvalid";
  }
}

/** One short reason from an arbitrary thrown value. */
function reasonOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Narrow an unknown to a plain record, or null. */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** `v0.1.0` and `0.1.0` name the same release; tags carry the prefix. */
export function stripTagPrefix(tag: string): string {
  return tag.replace(/^[vV]/, "");
}

/** Require a repository part from the safe alphabet. */
function assertRepositoryPart(value: unknown, label: string): string {
  if (typeof value !== "string" || !REPOSITORY_PART.test(value)) {
    throw new ReleaseInvalid(
      `${label} must be a plain GitHub name ([A-Za-z0-9._-], no slashes), got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/**
 * Read the `digest` field. `sha256:<64 hex>` is the only shape accepted; a
 * digest in another algorithm is a release this updater cannot verify, and
 * silently downloading it unverified would defeat the point.
 */
function digestOf(record: Record<string, unknown>, name: string): string | undefined {
  const raw = record["digest"];
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string") {
    throw new ReleaseInvalid(`asset ${name} has a non-string digest ${JSON.stringify(raw)}`);
  }
  const prefix = "sha256:";
  if (!raw.toLowerCase().startsWith(prefix)) {
    throw new ReleaseInvalid(
      `asset ${name} publishes ${JSON.stringify(raw)}, which is not a sha256 digest`,
    );
  }
  const hex = raw.slice(prefix.length).toLowerCase();
  if (!SHA256_PATTERN.test(hex)) {
    throw new ReleaseInvalid(`asset ${name} has a malformed sha256 digest ${JSON.stringify(raw)}`);
  }
  return hex;
}

/** One asset out of the release document, or null when it is unusable. */
function toAsset(value: unknown): GithubReleaseAsset | null {
  const record = asRecord(value);
  if (record === null) return null;

  const name = record["name"];
  const url = record["browser_download_url"];
  if (typeof name !== "string" || name === "") return null;
  if (typeof url !== "string" || url === "") return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;

  const rawSize = record["size"];
  const size =
    typeof rawSize === "number" && Number.isSafeInteger(rawSize) && rawSize >= 0 ? rawSize : 0;

  const sha256 = digestOf(record, name);
  return sha256 === undefined ? { name, url, size } : { name, url, size, sha256 };
}

/** `arm64`/`aarch64` in a file name: the asset is built for 64-bit ARM. */
const ARM64_MARKER = /arm64|aarch64/i;

/** `x86_64`/`amd64`/`x64`: the asset is built for 64-bit Intel. */
const X64_MARKER = /x86_64|amd64|x64/i;

/** A name that says "works everywhere", used by the macOS and APK builds. */
const UNIVERSAL_MARKER = /universal/i;

/**
 * Android ABI tokens, longest first: `x86_64` must be read before `x86`, or
 * every 64-bit Intel APK would be taken for a 32-bit one.
 */
const ANDROID_ABIS: readonly string[] = ["arm64-v8a", "armeabi-v7a", "x86_64", "x86"];

/** `process.arch` to Android ABI, for the ABI-specific APK of a split build. */
const ANDROID_ABI_FOR_ARCH: Readonly<Record<string, string>> = {
  arm64: "arm64-v8a",
  arm: "armeabi-v7a",
  x64: "x86_64",
  ia32: "x86",
};

/** The ABI a file name claims, or null when it claims none (universal APK). */
export function androidAbiOf(name: string): string | null {
  const lowered = name.toLowerCase();
  for (const abi of ANDROID_ABIS) {
    if (lowered.includes(abi)) return abi;
  }
  return null;
}

/**
 * How well one file name fits a target, or null when it cannot be used.
 *
 * Higher is better. The numbers only order candidates within one platform:
 * 3 = an asset that names this architecture, 2 = an explicitly universal
 * asset, 1 = an asset that names no architecture at all.
 */
function scoreFor(platform: string, arch: string, name: string): number | null {
  const arm64 = ARM64_MARKER.test(name);
  const x64 = X64_MARKER.test(name);
  const universal = UNIVERSAL_MARKER.test(name);

  switch (platform) {
    case "linux": {
      if (!APPIMAGE_SUFFIX.test(name)) return null;
      if (arch === "arm64") {
        if (arm64) return 3;
        if (x64) return null;
        return universal ? 2 : 1;
      }
      if (arch === "x64") {
        if (x64) return 3;
        if (arm64) return null;
        return universal ? 2 : 1;
      }
      return null;
    }
    case "win32": {
      // Windows ships an MSI: Windows Installer performs the in-place upgrade,
      // so the app can update itself without walking the user through a wizard.
      if (!/\.msi$/i.test(name)) return null;
      if (arch === "arm64") {
        if (arm64) return 3;
        if (x64) return null;
        return universal ? 2 : 1;
      }
      if (arch === "x64") {
        if (x64) return 3;
        if (arm64) return null;
        return universal ? 2 : 1;
      }
      return null;
    }
    case "darwin": {
      if (!/\.dmg$/i.test(name)) return null;
      if (universal) return 2;
      if (arch === "arm64") {
        if (arm64) return 3;
        if (x64) return null;
        return 1;
      }
      if (arch === "x64") {
        if (x64) return 3;
        if (arm64) return null;
        return 1;
      }
      return null;
    }
    case "android": {
      if (!/\.apk$/i.test(name)) return null;
      const abi = androidAbiOf(name);
      const wanted = ANDROID_ABI_FOR_ARCH[arch];
      if (wanted !== undefined && abi === wanted) return 3;
      if (abi === null) return universal ? 2 : 1;
      return null;
    }
    default:
      return null;
  }
}

/**
 * The one asset that belongs to `platform`/`arch`, or null.
 *
 * Pure: no network, no filesystem, no knowledge of who is running. Ties are
 * broken by shorter name, then by code-unit order, so the same release always
 * picks the same file.
 */
export function pickAsset(
  assets: readonly GithubReleaseAsset[],
  platform: string,
  arch: string,
): GithubReleaseAsset | null {
  let best: GithubReleaseAsset | null = null;
  let bestScore = 0;

  for (const asset of assets) {
    const score = scoreFor(platform, arch, asset.name);
    if (score === null) continue;
    if (best === null || score > bestScore) {
      best = asset;
      bestScore = score;
      continue;
    }
    if (score < bestScore) continue;
    if (asset.name.length < best.name.length) {
      best = asset;
    } else if (asset.name.length === best.name.length && asset.name < best.name) {
      best = asset;
    }
  }

  return best;
}

/** The assets of one release, in document order, with unusable rows dropped. */
function assetsOf(payload: Record<string, unknown>): GithubReleaseAsset[] {
  const raw = payload["assets"];
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new ReleaseInvalid(`release "assets" must be an array, got ${typeof raw}`);
  }
  const assets: GithubReleaseAsset[] = [];
  for (const entry of raw) {
    const asset = toAsset(entry);
    if (asset !== null) assets.push(asset);
  }
  return assets;
}

/**
 * Decide what one release document means for this build.
 *
 * @throws ReleaseInvalid when the document answered but cannot be used:
 *   not an object, a draft or prerelease, an unparseable tag, or a release
 *   with no asset for this platform and architecture.
 */
function interpret(
  payload: unknown,
  currentVersion: string,
  platform: string,
  arch: string,
): GithubCheckResult {
  const record = asRecord(payload);
  if (record === null) {
    throw new ReleaseInvalid(`release document must be an object, got ${typeof payload}`);
  }

  if (record["draft"] === true) {
    throw new ReleaseInvalid("release is a draft; drafts are never offered as updates");
  }
  if (record["prerelease"] === true) {
    throw new ReleaseInvalid("release is a prerelease; only published releases are offered");
  }

  const tag = record["tag_name"];
  if (typeof tag !== "string" || tag === "") {
    throw new ReleaseInvalid(`release has no tag_name, got ${JSON.stringify(tag)}`);
  }
  const latest = stripTagPrefix(tag);

  let ordering: -1 | 0 | 1;
  try {
    ordering = compareVersions(latest, currentVersion);
  } catch (error) {
    throw new ReleaseInvalid(
      `cannot compare release "${tag}" with running version "${currentVersion}": ${reasonOf(error)}`,
    );
  }

  if (ordering <= 0) {
    return { kind: "current", version: currentVersion };
  }

  const assets = assetsOf(record);
  const asset = pickAsset(assets, platform, arch);
  if (asset === null) {
    const names = assets.map((entry) => entry.name).join(", ");
    throw new ReleaseInvalid(
      `release ${latest} has no asset for ${platform}/${arch}` +
        (names === "" ? " (the release publishes no downloads)" : ` (assets: ${names})`),
    );
  }

  const body = record["body"];
  const notes = typeof body === "string" ? body.trim() : "";

  return { kind: "update", current: currentVersion, latest, notes, asset };
}

/**
 * Ask GitHub for the latest published release and decide what it means.
 *
 * Never throws: a rejected fetch, a non-2xx answer, a body that will not decode
 * and a document that cannot be used all come back as `unreachable` or
 * `invalid` with a reason that names what failed. `unreachable` means "no
 * answer"; `invalid` means "an answer we will not act on", and the two are
 * never folded into "you are up to date".
 */
export async function checkGithubRelease(
  options: GithubCheckOptions,
): Promise<GithubCheckResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS;
  const apiBase = (options.apiBaseUrl ?? GITHUB_API_BASE).replace(/\/+$/, "");

  let endpoint = "";
  try {
    const owner = assertRepositoryPart(options.owner ?? GITHUB_OWNER, "owner");
    const repo = assertRepositoryPart(options.repo ?? GITHUB_REPO, "repo");
    endpoint = `${apiBase}/repos/${owner}/${repo}/releases/latest`;
  } catch (error) {
    return { kind: "invalid", reason: reasonOf(error) };
  }

  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return { kind: "unreachable", reason: `could not reach ${endpoint}: ${reasonOf(error)}` };
  }

  if (!response.ok) {
    const hint =
      response.status === 404
        ? " (no published release, or no repository by that name)"
        : response.status === 403 || response.status === 429
          ? " (rate limited or forbidden; GitHub allows 60 anonymous calls per hour per address)"
          : "";
    return { kind: "unreachable", reason: `${endpoint} answered HTTP ${response.status}${hint}` };
  }

  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    return { kind: "unreachable", reason: `could not read the release: ${reasonOf(error)}` };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    return { kind: "invalid", reason: `release is not valid JSON: ${reasonOf(error)}` };
  }

  try {
    return interpret(payload, options.currentVersion, options.platform, options.arch);
  } catch (error) {
    if (error instanceof ReleaseInvalid) return { kind: "invalid", reason: error.message };
    return { kind: "invalid", reason: reasonOf(error) };
  }
}

/** Where the update runs, and what the running build knows about itself. */
export interface LocalTarget {
  /** `process.platform`, or `"android"` inside the APK. */
  readonly platform: string;
  /** `process.arch`. */
  readonly arch: string;
  /** Absolute path of the running executable, when the platform has one. */
  readonly executablePath?: string;
  /** True when the running executable (and its directory) can be replaced. */
  readonly executableWritable?: boolean;
}

/** What the app should do next; `notes` is user-facing and never a slogan. */
export interface UpdatePlan {
  readonly action: "none" | "download" | "manual";
  /** What to download, or null when there is nothing to fetch. */
  readonly url: string | null;
  readonly notes: readonly string[];
}

/** True when this target swaps its own file instead of running an installer. */
function isAppImageTarget(target: LocalTarget): boolean {
  return target.platform === "linux";
}

/**
 * Turn a check result plus the local target into the next step.
 *
 * `download` means this module can fetch and verify the file and the app can
 * put it in place without another program. `manual` means the file is still
 * downloaded, but a part only the OS can do remains: a package installer
 * confirmation on Android. `none` means there is nothing to fetch.
 *
 * The notes are written for a person reading the update card: they name what
 * happens, what is signed and what is not, and where an AppImage lands.
 */
export function planGithubUpdate(result: GithubCheckResult, target: LocalTarget): UpdatePlan {
  switch (result.kind) {
    case "current":
      return {
        action: "none",
        url: null,
        notes: [`Roan ${result.version} is the latest published release.`],
      };
    case "unreachable":
      return {
        action: "none",
        url: null,
        notes: [
          "Could not check GitHub for a newer release, so this build is not known to be up to date.",
          result.reason,
        ],
      };
    case "invalid":
      return {
        action: "none",
        url: null,
        notes: ["GitHub answered, but there is nothing this build can install.", result.reason],
      };
    case "update":
      break;
  }

  const { latest, asset } = result;
  const size = asset.size > 0 ? ` (${asset.size} bytes)` : "";
  const verified =
    asset.sha256 === undefined
      ? "This release publishes no SHA-256, so the download is not verified beyond TLS."
      : "The download is checked against the SHA-256 published with the release.";

  if (target.platform === "android") {
    return {
      action: "manual",
      url: asset.url,
      notes: [
        `Roan ${latest} is available: ${asset.name}${size}.`,
        "Android cannot replace the app that is running. The APK is downloaded and handed to the system package installer, which asks for confirmation; \"install unknown apps\" must be allowed for Roan first.",
        verified,
      ],
    };
  }

  if (isAppImageTarget(target)) {
    const here = target.executablePath;
    const swap =
      here === undefined
        ? "Save the new AppImage next to the current one and start it instead; the old file stays until you delete it."
        : target.executableWritable === true
          ? `The new AppImage is written over ${here} once the digest matches, so the next start runs ${latest}. Keep the app closed until the swap completes; a running AppImage can be replaced on Linux, but a half-written one cannot be started.`
          : `${here} is not writable by this user, so the new AppImage is saved elsewhere and must be run from there (chmod +x first).`;
    return {
      action: "download",
      url: asset.url,
      notes: [
        `Roan ${latest} is available: ${asset.name}${size}.`,
        swap,
        verified,
        "The AppImage carries no GPG signature: a matching digest proves GitHub served these bytes, not that they were built from this repository.",
      ],
    };
  }

  if (target.platform === "win32") {
    return {
      action: "download",
      url: asset.url,
      notes: [
        `Roan ${latest} is available: ${asset.name}${size}.`,
        "The .msi is a Windows Installer package: `msiexec /i <file> /qn` upgrades the installed version in place, no wizard.",
        verified,
        "The package is not Authenticode-signed, so Windows will warn on elevation (\"More info\" then \"Run anyway\").",
      ],
    };
  }

  if (target.platform === "darwin") {
    return {
      action: "download",
      url: asset.url,
      notes: [
        `Roan ${latest} is available: ${asset.name}${size}.`,
        "The .dmg holds Roan.app. Open it and drag the app into Applications; the old copy is replaced there, not in place.",
        verified,
        "The disk image is not Developer ID signed or notarised, so Gatekeeper refuses the first launch until you allow it under System Settings > Privacy & Security.",
      ],
    };
  }

  return {
    action: "none",
    url: null,
    notes: [
      `Roan ${latest} is available, but this build does not know how to update ${target.platform}/${target.arch}.`,
      `Download it by hand from ${asset.url}`,
    ],
  };
}

/** What one download produced. */
export type DownloadOutcome =
  | { readonly ok: true; readonly path: string; readonly bytes: number; readonly sha256: string }
  | { readonly ok: false; readonly reason: string };

export interface DownloadRequest {
  /** Injected in tests; defaults to the runtime's global `fetch`. */
  readonly fetch?: typeof fetch;
  /** The asset's `browser_download_url`. */
  readonly url: string;
  /** Final path. The file appears here only after the bytes are verified. */
  readonly dest: string;
  /** Expected lower-case hex SHA-256, when the release publishes one. */
  readonly sha256?: string;
  /** Byte ceiling; a larger body is refused. Defaults to 1.5 GB. */
  readonly maxBytes?: number;
  /** Milliseconds before the transfer is abandoned. Defaults to 300 s. */
  readonly timeoutMs?: number;
}

/** Delete a file whose bytes we do not trust; a missing file is fine. */
async function discard(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // Already gone or never created; the caller gets the original failure.
  }
}

/**
 * Download `url` to a temporary file next to `dest`, verify it, then rename.
 *
 * The order is the whole point: the bytes land at `<dest>.part-<random>`, the
 * digest is computed while they stream in, the byte cap is enforced before each
 * chunk is written, and only a complete, matching file is renamed onto `dest`.
 * A failure leaves nothing at `dest` that a later run could mistake for a good
 * installer, and the partial file is deleted.
 *
 * Never throws; every failure is `{ok:false, reason}` with the URL or size in
 * the message.
 */
export async function downloadAndVerify(request: DownloadRequest): Promise<DownloadOutcome> {
  const fetchImpl = request.fetch ?? fetch;
  const maxBytes = request.maxBytes ?? DEFAULT_MAX_BYTES;
  const dest = request.dest;

  if (typeof dest !== "string" || dest === "") {
    return { ok: false, reason: `dest must be a non-empty path, got ${JSON.stringify(dest)}` };
  }

  let parsed: URL;
  try {
    parsed = new URL(request.url);
  } catch {
    return { ok: false, reason: `not a valid URL: ${JSON.stringify(request.url)}` };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, reason: `download url must be http or https, got ${parsed.protocol}` };
  }

  const expected = request.sha256;
  if (expected !== undefined && !SHA256_PATTERN.test(expected)) {
    return { ok: false, reason: `expected sha256 must be 64 lower-case hex characters, got ${JSON.stringify(expected)}` };
  }

  const temp = `${dest}.part-${randomBytes(4).toString("hex")}`;
  let handle: FileHandle | null = null;

  try {
    await mkdir(dirname(dest), { recursive: true });

    let response: Response;
    try {
      response = await fetchImpl(parsed.toString(), {
        redirect: "follow",
        signal: AbortSignal.timeout(request.timeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS),
      });
    } catch (error) {
      return { ok: false, reason: `could not download ${parsed.toString()}: ${reasonOf(error)}` };
    }

    if (!response.ok) {
      return { ok: false, reason: `download of ${parsed.toString()} failed: HTTP ${response.status}` };
    }
    if (response.body === null) {
      return { ok: false, reason: `download of ${parsed.toString()} returned no body` };
    }

    handle = await open(temp, "w");
    const hash = createHash("sha256");
    let bytes = 0;

    const reader = response.body.getReader();
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const value = chunk.value;
      if (value === undefined) continue;

      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return {
          ok: false,
          reason: `download of ${parsed.toString()} is larger than the ${maxBytes}-byte limit; refused after ${bytes} bytes`,
        };
      }
      hash.update(value);
      await handle.writeFile(value);
    }

    const sha256 = hash.digest("hex");
    if (expected !== undefined && sha256 !== expected) {
      return {
        ok: false,
        reason: `sha256 mismatch for ${parsed.toString()}: expected ${expected}, got ${sha256}`,
      };
    }

    // Flush before the rename: an installer opened from a renamed file must see
    // every byte, not a page-cache promise.
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temp, dest);
    return { ok: true, path: dest, bytes, sha256 };
  } catch (error) {
    return { ok: false, reason: `could not save ${parsed.toString()}: ${reasonOf(error)}` };
  } finally {
    if (handle !== null) {
      await handle.close().catch(() => undefined);
    }
    // A rename consumed the temp file; unlinking a missing file is a no-op.
    await discard(temp);
  }
}

/** The plain file name an asset should land under, safe for any filesystem. */
export function assetFileName(name: string): string {
  const plain = basename(name).replace(/[^A-Za-z0-9._-]/g, "_");
  return plain === "" || plain === "." || plain === ".." ? "update" : plain;
}

/** The path a verified asset is downloaded to inside `dir`. */
export function downloadPathFor(dir: string, name: string): string {
  return join(dir, assetFileName(name));
}
