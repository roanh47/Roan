/**
 * Icon size matrix per target platform, plus helpers to report gaps and to
 * name the canonical icon files for an app package.
 *
 * Sizes are PNG source sizes in pixels. Windows and macOS embed several PNGs
 * into one container (`.ico` / `.icns`); Linux ships loose PNG files.
 */

/** Target platforms that need a distinct icon set. */
export type IconPlatform = "windows" | "macos" | "linux";

/**
 * Required source sizes per platform, ascending and without duplicates.
 *
 * - `windows`: sizes embedded in `icon.ico`.
 * - `macos`: PNG sources embedded in `icon.icns` (the 2x variants of 256 and
 *   512 collapse onto the same source size).
 * - `linux`: loose PNG files shipped next to the desktop entry.
 */
export const ICON_SIZES = Object.freeze({
  windows: Object.freeze([16, 24, 32, 48, 64, 128, 256] as const),
  macos: Object.freeze([16, 32, 64, 128, 256, 512, 1024] as const),
  linux: Object.freeze([16, 24, 32, 48, 64, 128, 256, 512] as const),
} satisfies Readonly<Record<IconPlatform, readonly number[]>>);

const LINUX_SIZES: readonly number[] = ICON_SIZES.linux;

/**
 * True for values that can be compared against the matrix: finite integers.
 * Everything else (NaN, infinities, fractions) is ignored instead of throwing.
 */
function isUsableSize(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value);
}

/**
 * Required sizes for `platform` that `provided` does not cover, ascending.
 *
 * Values in `provided` that are not part of the matrix are ignored, duplicates
 * collapse, and non-integers or non-finite numbers are skipped rather than
 * rejected, so callers can pass raw filesystem probes.
 */
export function missingIconSizes(
  platform: IconPlatform,
  provided: readonly number[],
): number[] {
  const present = new Set<number>();
  for (const value of provided) {
    if (!isUsableSize(value)) continue;
    present.add(value);
  }

  const missing: number[] = [];
  for (const size of ICON_SIZES[platform]) {
    if (!present.has(size)) missing.push(size);
  }
  return missing.sort((a, b) => a - b);
}

/**
 * Canonical icon file names for a package, relative to its output directory,
 * in the order a packager should write them: Linux PNGs first, then the shared
 * Windows and macOS containers.
 *
 * Names are fixed by platform conventions, so `appName` does not appear in
 * them; it is accepted so callers can pass the manifest entry unchanged.
 */
export function expectedIconFiles(appName: string): string[] {
  void appName;
  const files: string[] = [];
  for (const size of LINUX_SIZES) files.push(`icons/${size}x${size}.png`);
  files.push("icons/icon.ico", "icons/icon.icns");
  return files;
}
