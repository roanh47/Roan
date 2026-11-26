/**
 * The session row is drawn from props alone: the badges, the count and which
 * actions exist are the whole contract, so they are checked as markup — no DOM,
 * no timers, no clicks.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SessionRow } from "./SessionRow.js";
import type { SessionRowModel, SessionRowProps } from "./SessionRow.js";

function html(props: Partial<SessionRowProps> = {}, session: Partial<SessionRowModel> = {}): string {
  return renderToStaticMarkup(
    <SessionRow
      session={{ id: "s1", title: "Poortvraag", messages: 4, ...session }}
      {...props}
    />,
  );
}

describe("the session row", () => {
  it("shows the name and what is in the conversation", () => {
    const markup = html();
    expect(markup).toContain("Poortvraag");
    expect(markup).toContain("4 messages");
    expect(markup).not.toContain("Archived");
    expect(markup).not.toContain("Temporary");
  });

  it("counts a single message in the singular", () => {
    expect(html({}, { title: "Kort", messages: 1 })).toContain("1 message");
    expect(html({}, { title: "Leeg", messages: 0 })).toContain("0 messages");
  });

  it("says archived, and offers the way back instead of archiving again", () => {
    const markup = html({ onArchive: () => undefined }, { title: "Oud", messages: 2, archived: true });
    expect(markup).toContain("Archived");
    expect(markup).toContain(">Unarchive<");
    expect(markup).toContain("Unarchive “Oud”");
    expect(markup).not.toContain(">Archive<");
  });

  it("marks a temporary chat as such", () => {
    const markup = html({}, { id: "t1", title: "Tijdelijk", messages: 1, ephemeral: true });
    expect(markup).toContain("Temporary");
    expect(markup).not.toContain("Archived");
  });

  it("draws no actions without callbacks — the host decides what exists", () => {
    expect(html()).not.toContain("<button");
  });

  it("names each action with the session it hits", () => {
    const markup = html({
      onSelect: () => undefined,
      onArchive: () => undefined,
      onDelete: () => undefined,
    });
    expect(markup).toContain("Open “Poortvraag”");
    expect(markup).toContain("Archive “Poortvraag”");
    expect(markup).toContain("Delete “Poortvraag”");
  });

  it("keeps the actions but disables them while a request is in flight", () => {
    const markup = html({
      onSelect: () => undefined,
      onArchive: () => undefined,
      onDelete: () => undefined,
      busy: true,
    });
    const actions = markup.match(/<button[^>]*aria-label="(?:Archive|Delete)[^>]*>/g) ?? [];
    expect(actions.length).toBe(2);
    for (const tag of actions) expect(tag).toContain("disabled");
    // Reading the conversation is not a request: opening stays possible.
    const open = /<button[^>]*title="Open [^"]*"[^>]*>/.exec(markup)?.[0] ?? "";
    expect(open).not.toContain("disabled");
  });

  it("leaves the actions enabled when it is not busy", () => {
    const markup = html({ onSelect: () => undefined, onDelete: () => undefined });
    const buttons = markup.match(/<button[^>]*>/g) ?? [];
    expect(buttons.length).toBe(2);
    for (const tag of buttons) expect(tag).not.toContain("disabled");
  });

  it("marks the open conversation as current", () => {
    expect(html({ active: true })).toContain('aria-current="true"');
    expect(html()).not.toContain("aria-current");
  });
});
