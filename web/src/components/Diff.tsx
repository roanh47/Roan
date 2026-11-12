import type { CSSProperties, ReactElement } from "react";
import { colors } from "../theme";

export type DiffLineKind = "file" | "hunk" | "add" | "del" | "context";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

const FILE_HEADER =
  /^(diff --git |index |--- |\+\+\+ |(new|deleted) file mode |(old|new) mode |similarity index |rename (from|to) )/;
const HUNK_HEADER = /^@@ -\d+(,\d+)? \+\d+(,\d+)? @@/;

/**
 * Splits a unified diff into typed lines. `---`/`+++` are file headers, not
 * removals/additions, so they are matched before the `-`/`+` prefixes.
 */
export function parseDiff(diff: string): DiffLine[] {
  return diff
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line, i, all) => line !== "" || i < all.length - 1)
    .map((raw): DiffLine => {
      const text = raw.replace(/\t/g, "    ");
      if (FILE_HEADER.test(text)) return { kind: "file", text };
      if (HUNK_HEADER.test(text) || text.startsWith("\\")) {
        return { kind: "hunk", text };
      }
      if (text.startsWith("+")) return { kind: "add", text };
      if (text.startsWith("-")) return { kind: "del", text };
      return { kind: "context", text };
    });
}

/** The marker column, and the line with its one-character diff prefix removed. */
function splitPrefix(line: DiffLine): { sign: string; body: string } {
  const { kind, text } = line;
  if (kind === "file" || kind === "hunk") return { sign: " ", body: text };
  const sign = kind === "add" ? "+" : kind === "del" ? "−" : " ";
  const keep = kind === "context" && !text.startsWith(" ");
  return { sign, body: keep ? text : text.slice(1) };
}
const rowStyle: Record<DiffLineKind, CSSProperties> = {
  file: { color: colors.muted, background: colors.surface, fontWeight: 600 },
  hunk: { color: colors.faint, background: colors.surface },
  add: {
    color: colors.accent,
    background: `color-mix(in srgb, ${colors.accent} 12%, transparent)`,
  },
  del: {
    color: colors.danger,
    background: `color-mix(in srgb, ${colors.danger} 12%, transparent)`,
  },
  context: { color: colors.muted },
};

interface DiffProps {
  /** The raw unified diff, as produced by `git diff` or a patch tool result. */
  diff: string;
  /** Announced to assistive tech and shown above the hunk list. */
  title?: string;
}

/** Read-only rendering of a unified diff: additions green, removals red. */
export function Diff({ diff, title = "Changes" }: DiffProps): ReactElement {
  const lines = parseDiff(diff);

  return (
    <figure
      className="diff"
      aria-label={title}
      style={{
        margin: 0,
        border: `1px solid ${colors.lineSoft}`,
        borderRadius: 12,
        background: colors.bg,
        overflow: "hidden",
      }}
    >
      <figcaption
        style={{
          padding: "6px 12px",
          borderBottom: `1px solid ${colors.lineSoft}`,
          color: colors.faint,
          fontSize: 11,
          letterSpacing: "0.04em",
        }}
      >
        {title}
      </figcaption>
      <div
        style={{
          overflow: "auto",
          maxHeight: 420,
          padding: "6px 0",
          fontFamily: "var(--mono)",
          fontSize: 11.5,
          lineHeight: 1.5,
        }}
      >
        {lines.length === 0 ? (
          <div style={{ ...rowStyle.context, padding: "0 12px" }}>No changes.</div>
        ) : (
          lines.map((line, i) => {
            const { sign, body } = splitPrefix(line);
            return (
              <div
                key={i}
                style={{
                  ...rowStyle[line.kind],
                  display: "flex",
                  padding: "0 12px",
                  whiteSpace: "pre",
                  minWidth: "max-content",
                }}
              >
                <span aria-hidden="true" style={{ flex: "none", width: "1.2em", opacity: 0.6 }}>
                  {sign}
                </span>
                <span>{body || " "}</span>
              </div>
            );
          })
        )}
      </div>
    </figure>
  );
}
