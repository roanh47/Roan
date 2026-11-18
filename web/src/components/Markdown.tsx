import { useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { parseBlocks, parseInline } from "../markdown.js";

/**
 * Renders markdown for one assistant message. Every text node goes through
 * React's escaping — the parser produces a tree, never an HTML string, so a
 * model answer cannot inject markup. Code blocks carry a copy chip, the way
 * every reference chat app does it.
 */

function Inline({ source }: { source: string }): ReactElement {
  const tokens = parseInline(source);
  return (
    <>
      {tokens.map((token, index) => {
        switch (token.kind) {
          case "code":
            return (
              <code className="md__icode" key={index}>
                {token.text}
              </code>
            );
          case "bold":
            return <strong key={index}>{token.text}</strong>;
          case "italic":
            return <em key={index}>{token.text}</em>;
          case "link":
            return (
              <a className="md__link" href={token.href} target="_blank" rel="noreferrer" key={index}>
                {token.text}
              </a>
            );
          case "text":
            return <span key={index}>{token.text}</span>;
        }
      })}
    </>
  );
}

function InlineLines({ source }: { source: string }): ReactElement {
  const parts = source.split("\n");
  return (
    <>
      {parts.map((part, index) => (
        <span key={index}>
          {index > 0 ? <br /> : null}
          <Inline source={part} />
        </span>
      ))}
    </>
  );
}

function CodeBlock({ lang, text }: { lang: string; text: string }): ReactElement {
  const [copied, setCopied] = useState(false);
  return (
    <div className="md__codewrap">
      <div className="md__codebar">
        <span className="md__codelang">{lang.length > 0 ? lang : "code"}</span>
        <button
          type="button"
          className="md__chip"
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(
              () => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              },
              () => setCopied(false),
            );
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="md__code">
        <code>{text}</code>
      </pre>
    </div>
  );
}

function renderBlock(block: ParsedBlock, key: number): ReactNode {
  switch (block.kind) {
    case "code":
      return <CodeBlock lang={block.lang} text={block.text} key={key} />;
    case "heading": {
      const Tag = (block.level === 1 ? "h1" : block.level === 2 ? "h2" : "h3") as "h1" | "h2" | "h3";
      return (
        <Tag className={`md__h${String(block.level)}`} key={key}>
          <Inline source={block.text} />
        </Tag>
      );
    }
    case "quote":
      return (
        <blockquote className="md__quote" key={key}>
          <InlineLines source={block.text} />
        </blockquote>
      );
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag className="md__list" key={key}>
          {block.items.map((item, index) => (
            <li key={index}>
              <Inline source={item} />
            </li>
          ))}
        </Tag>
      );
    }
    case "table":
      return (
        <div className="md__tablewrap" key={key}>
          <table className="md__table">
            <thead>
              <tr>
                {(block.rows[0] ?? []).map((cell, index) => (
                  <th key={index}>
                    <Inline source={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.slice(1).map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>
                      <Inline source={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "para":
      return (
        <p className="md__p" key={key}>
          <InlineLines source={block.text} />
        </p>
      );
  }
}

type ParsedBlock = ReturnType<typeof parseBlocks>[number];

export function Markdown({ source }: { source: string }): ReactElement {
  return <div className="md">{parseBlocks(source).map(renderBlock)}</div>;
}
