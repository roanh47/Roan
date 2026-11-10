/**
 * Android manifest fragment as typed data, serialised to deterministic XML.
 *
 * The output is byte-stable: fixed attribute order, four-space indent, one
 * element per line. Tests compare whole strings, so never reorder anything here.
 */

export interface ManifestSpec {
  packageName: string;
  versionName: string;
  versionCode: number;
  minSdk: number;
  targetSdk: number;
  permissions: string[];
  shareActivity: {
    name: string;
    label: string;
    mimeTypes: string[];
  };
  syncService: {
    name: string;
    exported: boolean;
  };
}

const PACKAGE_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const ANDROID_NS = "http://schemas.android.com/apk/res/android";
const INDENT = "    ";

/** Escape the five XML attribute-significant characters; `&` first so it is not double-escaped. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function requirePackageName(packageName: string): string {
  if (typeof packageName !== "string" || !PACKAGE_PATTERN.test(packageName)) {
    throw new Error(
      `packageName must match ${String(PACKAGE_PATTERN)} (at least two segments, lowercase), got "${String(packageName)}"`,
    );
  }
  return packageName;
}

function requireVersionName(versionName: string): string {
  if (typeof versionName !== "string" || versionName.trim() === "") {
    throw new Error(`versionName must be a non-empty string, got "${String(versionName)}"`);
  }
  return versionName;
}

function requireVersionCode(versionCode: number): number {
  if (!Number.isInteger(versionCode) || versionCode <= 0) {
    throw new Error(`versionCode must be a positive integer, got "${String(versionCode)}"`);
  }
  return versionCode;
}

function requireSdkLevel(field: "minSdk" | "targetSdk", value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer, got "${String(value)}"`);
  }
  return value;
}

function requireComponentName(
  field: "shareActivity.name" | "syncService.name",
  name: string,
  packageName: string,
): string {
  const startsWithDot = typeof name === "string" && name.startsWith(".") && name.length > 1;
  const startsWithPackage =
    typeof name === "string" && name.startsWith(`${packageName}.`) && name.length > packageName.length + 1;
  if (!startsWithDot && !startsWithPackage) {
    throw new Error(
      `${field} must start with "." or "${packageName}" for package "${packageName}", got "${String(name)}"`,
    );
  }
  return name;
}

function requireLabel(label: string): string {
  if (typeof label !== "string" || label.trim() === "") {
    throw new Error(`shareActivity.label must be a non-empty string, got "${String(label)}"`);
  }
  return label;
}

function requireMimeTypes(mimeTypes: string[]): string[] {
  if (!Array.isArray(mimeTypes) || mimeTypes.length === 0) {
    throw new Error(
      `shareActivity.mimeTypes must contain at least one MIME type, got ${JSON.stringify(mimeTypes)}`,
    );
  }
  for (const mimeType of mimeTypes) {
    if (typeof mimeType !== "string" || mimeType.trim() === "") {
      throw new Error(
        `shareActivity.mimeTypes contains an empty MIME type, got ${JSON.stringify(mimeTypes)}`,
      );
    }
  }
  return mimeTypes;
}

function requirePermissions(permissions: string[]): string[] {
  if (!Array.isArray(permissions)) {
    throw new Error(`permissions must be an array, got ${JSON.stringify(permissions)}`);
  }
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const permission of permissions) {
    if (typeof permission !== "string" || permission.trim() === "") {
      throw new Error(
        `permissions contains an empty permission name, got ${JSON.stringify(permissions)}`,
      );
    }
    if (seen.has(permission)) continue;
    seen.add(permission);
    unique.push(permission);
  }
  return unique;
}

function requireExported(exported: boolean): boolean {
  if (typeof exported !== "boolean") {
    throw new Error(`syncService.exported must be a boolean, got "${String(exported)}"`);
  }
  return exported;
}

/**
 * Build the manifest text for `spec`, validating every field first.
 *
 * @throws Error naming the offending field and value on the first invalid field.
 */
export function buildManifest(spec: ManifestSpec): string {
  const packageName = requirePackageName(spec.packageName);
  const versionName = requireVersionName(spec.versionName);
  const versionCode = requireVersionCode(spec.versionCode);
  const minSdk = requireSdkLevel("minSdk", spec.minSdk);
  const targetSdk = requireSdkLevel("targetSdk", spec.targetSdk);
  if (minSdk > targetSdk) {
    throw new Error(
      `minSdk ${String(minSdk)} must not exceed targetSdk ${String(targetSdk)}`,
    );
  }
  const permissions = requirePermissions(spec.permissions);
  const activityName = requireComponentName("shareActivity.name", spec.shareActivity.name, packageName);
  const label = requireLabel(spec.shareActivity.label);
  const mimeTypes = requireMimeTypes(spec.shareActivity.mimeTypes);
  const serviceName = requireComponentName("syncService.name", spec.syncService.name, packageName);
  const exported = requireExported(spec.syncService.exported);

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="utf-8"?>');
  lines.push(`<manifest xmlns:android="${ANDROID_NS}"`);
  lines.push(`${INDENT}package="${escapeXml(packageName)}"`);
  lines.push(`${INDENT}android:versionCode="${escapeXml(String(versionCode))}"`);
  lines.push(`${INDENT}android:versionName="${escapeXml(versionName)}">`);
  lines.push("");
  lines.push(
    `${INDENT}<uses-sdk android:minSdkVersion="${escapeXml(String(minSdk))}" android:targetSdkVersion="${escapeXml(String(targetSdk))}" />`,
  );
  if (permissions.length > 0) {
    lines.push("");
    for (const permission of permissions) {
      lines.push(`${INDENT}<uses-permission android:name="${escapeXml(permission)}" />`);
    }
  }
  lines.push("");
  lines.push(`${INDENT}<application>`);
  lines.push(
    `${INDENT}${INDENT}<activity android:name="${escapeXml(activityName)}" android:label="${escapeXml(label)}" android:exported="true">`,
  );
  lines.push(`${INDENT}${INDENT}${INDENT}<intent-filter>`);
  lines.push(
    `${INDENT}${INDENT}${INDENT}${INDENT}<action android:name="android.intent.action.SEND" />`,
  );
  lines.push(
    `${INDENT}${INDENT}${INDENT}${INDENT}<category android:name="android.intent.category.DEFAULT" />`,
  );
  for (const mimeType of mimeTypes) {
    lines.push(
      `${INDENT}${INDENT}${INDENT}${INDENT}<data android:mimeType="${escapeXml(mimeType)}" />`,
    );
  }
  lines.push(`${INDENT}${INDENT}${INDENT}</intent-filter>`);
  lines.push(`${INDENT}${INDENT}</activity>`);
  lines.push(
    `${INDENT}${INDENT}<service android:name="${escapeXml(serviceName)}" android:exported="${exported ? "true" : "false"}" />`,
  );
  lines.push(`${INDENT}</application>`);
  lines.push("</manifest>");

  return `${lines.join("\n")}\n`;
}
