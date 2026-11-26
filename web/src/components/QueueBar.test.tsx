/**
 * The queue strip above the composer, checked where a user meets it: what it
 * says, what it offers to take back, and that it stays out of the way when
 * nothing is waiting.
 *
 * Rendered on the server so the test needs no DOM, no timers and no clicking:
 * the props are the whole input and the markup is the whole output. The remove
 * buttons are checked for the index they carry — that index is the contract the
 * parent passes to `onRemove`.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import QueueBar from "./QueueBar.js";

function render(queued: readonly string[]): string {
  return renderToStaticMarkup(<QueueBar queued={queued} onRemove={() => undefined} />);
}

describe("the queue bar", () => {
  it("renders nothing at all when the queue is empty", () => {
    expect(render([])).toBe("");
  });

  it("shows every pending message, in the order it will be sent", () => {
    const html = render(["first thing", "second thing", "third thing"]);

    expect(html).toContain("first thing");
    expect(html).toContain("second thing");
    expect(html).toContain("third thing");
    expect(html.indexOf("first thing")).toBeLessThan(html.indexOf("second thing"));
    expect(html.indexOf("second thing")).toBeLessThan(html.indexOf("third thing"));
  });

  it("says how many are waiting, and that the turn has to end first", () => {
    expect(render(["one"])).toContain("1 message waiting for the turn to end");
    expect(render(["one", "two"])).toContain("2 messages waiting for the turn to end");
    expect(render(["one", "two"])).toContain("Queued");
  });

  it("offers one remove button per message, carrying its own index", () => {
    const html = render(["one", "two"]);

    expect(html.match(/class="queuebar__remove"/g)?.length).toBe(2);
    expect(html).toContain('data-index="0"');
    expect(html).toContain('data-index="1"');
    expect(html).toContain('aria-label="Remove queued message 1"');
    expect(html).toContain('aria-label="Remove queued message 2"');
  });

  it("numbers the rows so the send order is readable", () => {
    const html = render(["one", "two"]);

    expect(html).toContain('<span class="queuebar__position"');
    expect(html).toMatch(/queuebar__position[^>]*>1</);
    expect(html).toMatch(/queuebar__position[^>]*>2</);
  });

  it("renders a message as text, never as markup the message contains", () => {
    const html = render(['<script>alert("x")</script>']);

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
