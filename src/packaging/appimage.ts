/**
 * AppImage build plan: the AppDir layout, the `.desktop` file name, the icon
 * path and the argv of every tool step, all as plain data.
 *
 * The plan executes nothing — no process is spawned and no shell is involved.
 * Each step keeps the tool name and every argument as separate array entries,
 * so a caller can hand `tool` and `argv` straight to `spawn` without ever
 * joining a command string (which is what breaks on paths with spaces).
 *
 * Layout paths are relative to `appDir`; step arguments are the paths to pass
 * on the command line.
 */

/** Everything a plan needs from the app being packaged. */
export interface AppImageInput {
  /** Name of the app; also the base name of the binary, `.desktop` and icon. */
  appName: string;
  /** Version to embed in the output file name: `major.minor.patch[-prerelease]`. */
  version: string;
  /** Path to the executable to deploy into the AppDir. */
  execPath: string;
  /** Path to the source icon file. */
  iconPath: string;
  /** Target architecture; used verbatim in the output file name. */
  arch: "x86_64" | "aarch64";
}

/** One tool invocation: the tool and its arguments, never a joined string. */
export interface AppImageStep {
  tool: string;
  argv: string[];
}

/** The complete, inert build plan. */
export interface AppImagePlan {
  /** AppDir root, relative to the build working directory. */
  appDir: string;
  /** What the AppDir must contain, with paths relative to `appDir`. */
  layout: { path: string; kind: "file" | "dir" | "symlink" }[];
  /** File name of the `.desktop` entry at the AppDir root. */
  desktopName: string;
  /** Path to the source icon, as given. */
  iconPath: string;
  /** Steps in run order: `linuxdeploy` fills the AppDir, `appimagetool` packs it. */
  steps: AppImageStep[];
}

/** The architectures this plan knows how to name. */
const KNOWN_ARCHES = ["x86_64", "aarch64"] as const;

type KnownArch = (typeof KNOWN_ARCHES)[number];

/** Lower-case start, then letters, digits, dot, underscore, dash. */
const APP_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** `major.minor.patch`, each part without leading zeros, optional `-prerelease`. */
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/;

/** Render an arbitrary value for an error message, bounded in length. */
function describe(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (Array.isArray(value)) return "an array";
  return `a ${typeof value}`;
}

/** The one error shape this module has: it always names the field and value. */
function invalid(field: string, value: unknown, reason: string): Error {
  return new Error(`Invalid ${field} ${describe(value)}: ${reason}`);
}

/** Read a non-empty string without a NUL, naming `field` when it is not one. */
function checkText(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw invalid(field, value, "must be a string");
  }
  if (value === "") {
    throw invalid(field, value, "must be a non-empty string");
  }
  if (value !== value.trim()) {
    throw invalid(field, value, "must not start or end with whitespace");
  }
  if (value.includes("\0")) {
    throw invalid(field, value, "must not contain a NUL character");
  }
  return value;
}

/**
 * Check the app name: it becomes the binary name, the `.desktop` file name and
 * part of the output path, so spaces and slashes are called out on their own
 * before the general pattern is applied.
 */
function checkAppName(value: unknown): string {
  const appName = checkText(value, "appName");
  if (appName.includes("/") || appName.includes("\\")) {
    throw invalid("appName", appName, "must not contain slashes");
  }
  if (/\s/.test(appName)) {
    throw invalid("appName", appName, "must not contain spaces");
  }
  if (!APP_NAME_PATTERN.test(appName)) {
    throw invalid(
      "appName",
      appName,
      "must start with a letter or digit and contain only letters, digits, \".\", \"_\" and \"-\"",
    );
  }
  return appName;
}

/** Check a strict `major.minor.patch[-prerelease]` version. */
function checkVersion(value: unknown): string {
  const version = checkText(value, "version");
  if (!VERSION_PATTERN.test(version)) {
    throw invalid(
      "version",
      version,
      'expected "<major>.<minor>.<patch>" or "<major>.<minor>.<patch>-<prerelease>"',
    );
  }
  return version;
}

/** Check the architecture at runtime: the union is erased by the compiler. */
function checkArch(value: unknown): KnownArch {
  for (const arch of KNOWN_ARCHES) {
    if (value === arch) return arch;
  }
  throw invalid("arch", value, `must be one of ${KNOWN_ARCHES.map(describe).join(", ")}`);
}

/**
 * Build an AppImage plan for `input`.
 *
 * @throws Error when `appName` is not `[A-Za-z0-9][A-Za-z0-9._-]*` (with
 *   spaces and slashes called out separately), `version` is not a strict
 *   `major.minor.patch` with an optional `-prerelease` suffix, `arch` is not
 *   one of the known architectures, or a path field is empty. Every message
 *   names the bad field and includes the value.
 */
export function planAppImage(input: AppImageInput): AppImagePlan {
  if (typeof input !== "object" || input === null) {
    throw invalid("input", input, "must be an AppImageInput object");
  }

  const appName = checkAppName(input.appName);
  const version = checkVersion(input.version);
  const execPath = checkText(input.execPath, "execPath");
  const iconPath = checkText(input.iconPath, "iconPath");
  const arch = checkArch(input.arch);

  const appDir = `build/AppDir-${appName}-${arch}`;
  const desktopName = `${appName}.desktop`;
  const iconName = `${appName}.png`;
  const outputPath = `dist/Roan-${appName}-${version}-${arch}.AppImage`;

  const layout: AppImagePlan["layout"] = [
    { path: "AppRun", kind: "symlink" },
    { path: `usr/bin/${appName}`, kind: "file" },
    { path: desktopName, kind: "file" },
    { path: iconName, kind: "file" },
    { path: "usr/share/applications", kind: "dir" },
    { path: `usr/share/applications/${desktopName}`, kind: "file" },
    { path: "usr/share/icons/hicolor/256x256/apps", kind: "dir" },
    { path: `usr/share/icons/hicolor/256x256/apps/${iconName}`, kind: "file" },
  ];

  const steps: AppImageStep[] = [
    {
      tool: "linuxdeploy",
      argv: [
        "--appdir",
        appDir,
        "--executable",
        execPath,
        "--desktop-file",
        `${appDir}/${desktopName}`,
        "--icon-file",
        iconPath,
      ],
    },
    {
      tool: "appimagetool",
      argv: [appDir, outputPath],
    },
  ];

  return { appDir, layout, desktopName, iconPath, steps };
}
