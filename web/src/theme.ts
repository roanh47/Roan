/**
 * Design tokens — the single source of truth for the web UI.
 *
 * Every color, spacing step, radius and font stack used by components lives
 * here. `web/src/styles.css` must follow this file: its `:root` custom
 * properties are the CSS projection of `colors` / `fonts`, and must be updated
 * whenever a value below changes (and vice versa — never let them drift).
 *
 * camelCase keys map onto the CSS custom properties like this:
 *   surface2   -> --surface-2
 *   lineSoft   -> --line-soft
 *   accentInk  -> --accent-ink
 * Use `cssVar(...)` to get a `var(--...)` reference with the right casing.
 */

export const colors = Object.freeze({
  bg: "#0b0c0f",
  surface: "#13161b",
  surface2: "#0e1014",
  line: "#262b33",
  lineSoft: "#1c2026",
  fg: "#e9edf1",
  muted: "#9aa4af",
  faint: "#838d98",
  accent: "#8fd6b4",
  accentInk: "#08211a",
  danger: "#ff8f8f",
  warn: "#f0c674",
} as const);

export const space = Object.freeze({
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const);

export const radii = Object.freeze({
  sm: 6,
  md: 10,
  lg: 14,
  pill: 999,
} as const);

export const fonts = Object.freeze({
  /** Matches `--font` in styles.css. */
  sans: 'ui-sans-serif, -apple-system, "Segoe UI Variable Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  /** Matches `--mono` in styles.css. */
  mono: 'ui-monospace, "SF Mono", "Cascadia Code", "Roboto Mono", Menlo, Consolas, monospace',
} as const);

export type ColorToken = keyof typeof colors;
export type SpaceToken = keyof typeof space;
export type RadiusToken = keyof typeof radii;

/** Token key -> actual CSS custom property name (kebab-case). */
const cssVarNames = {
  bg: "--bg",
  surface: "--surface",
  surface2: "--surface-2",
  line: "--line",
  lineSoft: "--line-soft",
  fg: "--fg",
  muted: "--muted",
  faint: "--faint",
  accent: "--accent",
  accentInk: "--accent-ink",
  danger: "--danger",
  warn: "--warn",
} as const satisfies Record<ColorToken, `--${string}`>;

/** Returns a CSS `var(--...)` reference for a color token. */
export function cssVar(name: ColorToken): string {
  return `var(${cssVarNames[name]})`;
}
