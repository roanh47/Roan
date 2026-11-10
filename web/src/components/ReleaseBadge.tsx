import type { ReactElement } from "react";

import { colors, fonts, radii, space } from "../theme";

export type ReleasePlatform = "windows" | "macos" | "linux" | "android";
export type ReleaseChannel = "stable" | "beta";

export interface ReleaseBadgeProps {
  version: string;
  platform: ReleasePlatform;
  channel?: ReleaseChannel;
}

/** Text glyph per platform — no images, no icon font. */
function platformGlyph(platform: ReleasePlatform): string {
  switch (platform) {
    case "windows":
      return "⊞";
    case "macos":
      return "";
    case "linux":
      return "❯";
    case "android":
      return "▤";
    default:
      return "";
  }
}

function platformLabel(platform: ReleasePlatform): string {
  switch (platform) {
    case "windows":
      return "Windows";
    case "macos":
      return "macOS";
    case "linux":
      return "Linux";
    case "android":
      return "Android";
    default:
      return platform;
  }
}

/**
 * Compact release marker: "Roan <version> · <Platform>" plus a beta pill.
 * Presentational only — no data fetching, no daemon access.
 */
export function ReleaseBadge({
  version,
  platform,
  channel = "stable",
}: ReleaseBadgeProps): ReactElement {
  const beta = channel === "beta";
  const channelColor = beta ? colors.warn : colors.accent;
  const glyph = platformGlyph(platform);

  return (
    <span
      role="status"
      aria-label={`Roan ${version} on ${platformLabel(platform)}, ${channel} channel`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: space.xs,
        padding: `${space.xs}px ${space.sm}px`,
        border: `1px solid ${colors.line}`,
        borderRadius: radii.pill,
        background: colors.surface2,
        color: colors.muted,
        fontFamily: fonts.mono,
        fontSize: 12,
        lineHeight: 1.4,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ color: colors.fg, fontWeight: 600 }}>Roan</span>
      <span style={{ color: colors.faint }}>v{version}</span>
      <span aria-hidden="true" style={{ color: colors.line }}>
        ·
      </span>
      {glyph.length > 0 ? (
        <span aria-hidden="true" style={{ color: colors.muted }}>
          {glyph}
        </span>
      ) : null}
      <span style={{ color: colors.muted }}>{platformLabel(platform)}</span>
      {beta ? (
        <span
          style={{
            marginLeft: space.xs,
            padding: `0 ${space.xs}px`,
            borderRadius: radii.sm,
            border: `1px solid ${channelColor}`,
            color: channelColor,
            fontSize: 10,
            letterSpacing: 0.4,
            textTransform: "uppercase",
          }}
        >
          Beta
        </span>
      ) : null}
    </span>
  );
}

export default ReleaseBadge;
