import assert from "node:assert/strict";
import { test } from "node:test";
import type { Event } from "../protocol/types.js";

import { attachmentExtension, linkify, sessionAttachments, sessionMarkdown } from "./export-markdown.js";

function event(seq: number, type: Event["type"], data: unknown): Event {
  return { v: 1, chain: "c", seq, id: `e${String(seq)}`, node: "n", ts: seq, type, data };
}

const events: Event[] = [
  event(1, "session", { id: "s1", title: "Vraag over poorten" }),
  event(2, "message", { text: "wat is 7412?", session: "s1" }),
  event(3, "assistant", { text: "de peer-poort.", session: "s1" }),
  event(4, "session_title", { session: "s1", title: "Poortvraag" }),
];

test("the export carries the renamed title and both voices", () => {
  const markdown = sessionMarkdown(events, "s1");
  assert.ok(markdown.startsWith("# Poortvraag"));
  assert.ok(markdown.includes("## Owner"));
  assert.ok(markdown.includes("wat is 7412?"));
  assert.ok(markdown.includes("## Roan"));
  assert.ok(markdown.includes("de peer-poort."));
  assert.ok(markdown.endsWith("*1 messages — exported from the chain.*"));
});

test("an unknown session exports its id as the title, without lying about content", () => {
  const markdown = sessionMarkdown(events, "zz");
  assert.ok(markdown.startsWith("# Conversation"));
  assert.ok(!markdown.includes("wat is 7412?"));
});

const photoEvents: Event[] = [
  event(1, "session", { id: "s1", title: "Met foto" }),
  event(2, "message", {
    text: "kijk naar deze foto",
    session: "s1",
    image: { mime: "image/jpeg", data: "aGVsbG8" },
  }),
  event(3, "assistant", { text: "Gevonden via de zoektool. Bron: https://nl.wikipedia.org/wiki/Hanze — meer staat in de bron.", session: "s1" }),
];

test("a photo becomes an attachment reference and the url a real link", () => {
  const markdown = sessionMarkdown(photoEvents, "s1");
  assert.ok(markdown.includes("![photo](attachments/e2.jpg)"));
  assert.ok(markdown.includes("[https://nl.wikipedia.org/wiki/Hanze](https://nl.wikipedia.org/wiki/Hanze)"));
  assert.ok(!markdown.includes("Bron: https://nl.wikipedia.org/wiki/Hanze —"));
});

test("sessionAttachments lists the photos ready to write", () => {
  const files = sessionAttachments(photoEvents, "s1");
  assert.deepEqual(files, [{ file: "e2.jpg", mime: "image/jpeg", data: "aGVsbG8" }]);
  assert.deepEqual(sessionAttachments(events, "s1"), []);
});

test("linkify leaves wired links alone and extension mapping is honest", () => {
  assert.equal(linkify("zie [iets](https://voorbeeld.nl) hier"), "zie [iets](https://voorbeeld.nl) hier");
  assert.equal(linkify("bron https://a.b/c en http://d.e"), "bron [https://a.b/c](https://a.b/c) en [http://d.e](http://d.e)");
  assert.equal(attachmentExtension("image/jpeg"), "jpg");
  assert.equal(attachmentExtension("IMAGE/WEBP"), "webp");
  assert.equal(attachmentExtension("rar"), "png");
});
