import type { CSSProperties, ReactElement } from "react";
import { cssVar, fonts, radii, space } from "../theme";

export interface MarkdownProps {
  /** Raw message text. Fenced code blocks are rendered as code, everything else verbatim. */
  text: string;
}

type Segment =
  | { kind: "text"; value: string }
  | { kind: "code"; language: string; value: string };

const OPEN_FENCE = /^ {0,3}(`{3,})(.*)$/;

/**
 * Splits text on ``` fences. Plain prose is kept verbatim; a fence opens a
 * code block that runs until a closing fence of at least the same length.
 * An unterminated fence swallows the remainder of the text (common while a
 * response is still streaming).
 */
export function parseSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  const lines = text.split("\n");
  let prose: string[] = [];
  let code: string[] | null = null;
  let fence = "";
  let language = "";

  const flushProse = (): void => {
    const value = prose.join("\n").replace(/^\n+|\n+$/g, "");
    if (value.length > 0) segments.push({ kind: "text", value });
    prose = [];
  };
  const flushCode = (): void => {
    if (code !== null) segments.push({ kind: "code", language, value: code.join("\n") });
    code = null;
    fence = "";
    language = "";
  };

  for (const line of lines) {
    if (code === null) {
      const open = OPEN_FENCE.exec(line);
      if (open) {
        const marker = open[1] ?? "```";
        fence = marker;
        const info = (open[2] ?? "").trim();
        language = info.split(/\s+/)[0] ?? "";
        flushProse();
        code = [];
      } else {
        prose.push(line);
      }
      continue;
    }

    if (new RegExp(`^ {0,3}\`{${fence.length},}\\s*$`).test(line)) {
      flushCode();
    } else {
      code.push(line);
    }
  }

  if (code !== null) flushCode();
  flushProse();
  return segments;
}

const root: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: space.sm,
  minWidth: 0,
  color: cssVar("fg"),
  fontFamily: fonts.sans,
};
const proseStyle: CSSProperties = {
  margin: 0,
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  lineHeight: 1.55,
};
const blockStyle: CSSProperties = {
  minWidth: 0,
  border: `1px solid ${cssVar("line")}`,
  borderRadius: radii.md,
  background: cssVar("surface2"),
  overflow: "hidden",
};
const labelStyle: CSSProperties = {
  padding: `${space.xs}px ${space.md}px`,
  borderBottom: `1px solid ${cssVar("lineSoft")}`,
  fontFamily: fonts.mono,
  fontSize: 11,
  lineHeight: 1.4,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: cssVar("faint"),
  userSelect: "none",
};
const preStyle: CSSProperties = {
  margin: 0,
  padding: space.md,
  overflowX: "auto",
  fontFamily: fonts.mono,
  fontSize: 12.5,
  lineHeight: 1.6,
  color: cssVar("fg"),
  tabSize: 2,
};
const codeStyle: CSSProperties = {
  font: "inherit",
  whiteSpace: "pre",
  color: "inherit",
};

/** Renders assistant text: fenced blocks as labelled <pre><code>, the rest as-is. */
export function Markdown({ text }: MarkdownProps): ReactElement | null {
  if (text.length === 0) return null;
  const segments = parseSegments(text);

  return (
    <div style={root}>
      {segments.map((segment, index) =>
        segment.kind === "text" ? (
          <p key={`t${index}`} style={proseStyle}>
            {segment.value}
          </p>
        ) : (
          <div key={`c${index}`} style={blockStyle}>
            <div style={labelStyle}>{segment.language.length > 0 ? segment.language : "code"}</div>
            <pre style={preStyle} tabIndex={0}>
              <code style={codeStyle}>{segment.value}</code>
            </pre>
          </div>
        ),
      )}
    </div>
  );
}
