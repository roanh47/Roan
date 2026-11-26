import assert from "node:assert/strict";
import { test } from "node:test";
import type { Event } from "../protocol/types.js";

import { escapeHtml, formatStamp, renderConversationHtml, sessionModel } from "./export-html.js";

function event(seq: number, type: Event["type"], data: unknown): Event {
  return { v: 1, chain: "c", seq, id: `e${String(seq)}`, node: "n", ts: seq, type, data };
}

const events: Event[] = [
  event(1, "session", { id: "s1", title: "Poort <vraag> & zo", model: "stub-model" }),
  event(2, "env", {
    session: "s1",
    entries: [{ path: "config.json", content: "apiKey=sk-SECRET" }],
  }),
  event(3, "message", { text: "wat is 7412?", session: "s1" }),
  event(4, "tool_call", { name: "read_file", args: { path: "/home/roan/secret.txt" }, session: "s1" }),
  event(5, "assistant", { text: "de peer-poort.", session: "s1" }),
  event(6, "session", { id: "s2", title: "Ander gesprek" }),
  event(7, "message", { text: "geheim van s2", session: "s2" }),
];

test("the page carries one conversation and nothing from the rest of the chain", () => {
  const html = renderConversationHtml(events, "s1");
  assert.ok(html.includes("<!DOCTYPE html>"));
  assert.ok(html.includes("<style>"));
  assert.ok(html.includes("wat is 7412?"));
  assert.ok(html.includes("de peer-poort."));
  assert.ok(html.includes("Started 1970-01-01 00:00 UTC"));
  assert.ok(html.includes("1 turn"));
  assert.ok(html.includes("model stub-model"));
  assert.ok(html.includes("<footer>Shared from Roan</footer>"));
  // The title travels escaped, never as markup.
  assert.ok(html.includes("Poort &lt;vraag&gt; &amp; zo"));
  // One turn: a question and its answer share one article.
  assert.equal(html.match(/<article class="turn">/g)?.length, 1);
  // Nothing from another conversation, no env snapshot, no tool payload.
  assert.ok(!html.includes("Ander gesprek"));
  assert.ok(!html.includes("geheim van s2"));
  assert.ok(!html.includes("sk-SECRET"));
  assert.ok(!html.includes("secret.txt"));
});

test("a message is text, never markup", () => {
  const hostile: Event[] = [
    event(1, "session", { id: "s1", title: "Escape" }),
    event(2, "message", {
      text: `<script>alert("x")</script> & 'quote' <img src=x onerror="alert(1)">`,
      session: "s1",
    }),
    event(3, "assistant", { text: "<b>vet</b> & <i>cursief</i>", session: "s1" }),
  ];
  const html = renderConversationHtml(hostile, "s1");
  assert.ok(!/<script/i.test(html));
  assert.ok(!/<img/i.test(html));
  assert.ok(!/<b>/i.test(html));
  assert.ok(html.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"));
  assert.ok(html.includes("&amp;"));
  assert.ok(html.includes("&#39;quote&#39;"));
  assert.ok(html.includes("&lt;b&gt;vet&lt;/b&gt; &amp; &lt;i&gt;cursief&lt;/i&gt;"));
});

test("escapeHtml is the one escape and it covers the five characters", () => {
  assert.equal(escapeHtml(`<a href="x">&'</a>`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
  assert.equal(escapeHtml("gewoon tekst"), "gewoon tekst");
});

test("no script tag and no external request anywhere", () => {
  const html = renderConversationHtml(events, "s1");
  assert.ok(!/<script/i.test(html));
  assert.ok(!/<link\b/i.test(html));
  assert.ok(!/<iframe/i.test(html));
  assert.ok(!/@import/i.test(html));
  assert.ok(!/\bsrc\s*=\s*["']https?:/i.test(html));
  assert.equal(html.match(/https?:\/\//g)?.length ?? 0, 0);
});

test("a link in a message is the only url on the page, and it is a real anchor", () => {
  const linked: Event[] = [
    event(1, "session", { id: "s1", title: "Bron" }),
    event(2, "message", { text: "kijk op https://voorbeeld.nl/a?x=1&y=2 voor meer", session: "s1" }),
    event(3, "assistant", { text: "gevonden.", session: "s1" }),
  ];
  const html = renderConversationHtml(linked, "s1");
  assert.ok(html.includes('<a href="https://voorbeeld.nl/a?x=1&amp;y=2" rel="noopener noreferrer">'));
  // href and link text, nothing else in the document points anywhere.
  assert.equal(html.match(/https?:\/\//g)?.length, 2);
});

test("a code fence becomes escaped pre/code, and a hostile fence stays text", () => {
  const coded: Event[] = [
    event(1, "session", { id: "s1", title: "Code" }),
    event(2, "message", { text: "kijk:\n```js\nif (a < b && c) { run(\"x\"); }\n```", session: "s1" }),
    event(3, "assistant", { text: "```html\n<script>alert(1)</script>\n```", session: "s1" }),
  ];
  const html = renderConversationHtml(coded, "s1");
  assert.ok(html.includes('<pre><code class="language-js">'));
  assert.ok(html.includes("if (a &lt; b &amp;&amp; c) { run(&quot;x&quot;); }"));
  assert.ok(!html.includes("a < b"));
  assert.ok(!/<script/i.test(html));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
});

test("inline code and bold become tags without loosening the escape", () => {
  const marked: Event[] = [
    event(1, "session", { id: "s1", title: "Markup" }),
    event(2, "message", { text: "zet `switchport trunk allowed vlan add 20` erbij", session: "s1" }),
    event(3, "assistant", { text: "**Let op:** `<b>geen html</b>` blijft tekst", session: "s1" }),
  ];
  const html = renderConversationHtml(marked, "s1");
  assert.ok(html.includes("<code>switchport trunk allowed vlan add 20</code>"));
  assert.ok(html.includes("<strong>Let op:</strong>"));
  assert.ok(html.includes("<code>&lt;b&gt;geen html&lt;/b&gt;</code>"));
  assert.ok(!/<b>/i.test(html));
});

test("a photo rides in as data, so the file stays one file", () => {
  const photo: Event[] = [
    event(1, "session", { id: "s1", title: "Foto" }),
    event(2, "message", {
      text: "kijk",
      session: "s1",
      image: { mime: "image/png", data: "aGVsbG8=" },
    }),
  ];
  const html = renderConversationHtml(photo, "s1");
  assert.ok(html.includes('<img src="data:image/png;base64,aGVsbG8=" alt="Photo">'));
  assert.equal(html.match(/https?:\/\//g)?.length ?? 0, 0);
});

test("the same chain renders byte for byte the same page", () => {
  assert.equal(renderConversationHtml(events, "s1"), renderConversationHtml(events, "s1"));
  const stamped = renderConversationHtml(events, "s1", { now: 1_700_000_000_000 });
  assert.equal(stamped, renderConversationHtml(events, "s1", { now: 1_700_000_000_000 }));
  assert.ok(stamped.includes("exported 2023-11-14 22:13 UTC"));
  assert.ok(!renderConversationHtml(events, "s1").includes("exported "));
});

test("an unknown conversation is empty, not invented", () => {
  const html = renderConversationHtml(events, "zz");
  assert.ok(html.includes("<h1>Conversation</h1>"));
  assert.ok(!html.includes("wat is 7412?"));
  assert.ok(!html.includes("geheim van s2"));
  assert.ok(html.includes("0 turns"));
  assert.ok(html.includes("<footer>Shared from Roan</footer>"));
});

test("the stamp is UTC and the model is read, never guessed", () => {
  assert.equal(formatStamp(0), "1970-01-01 00:00 UTC");
  assert.equal(formatStamp(Number.NaN), "");
  assert.equal(sessionModel(events, "s1"), "stub-model");
  assert.equal(sessionModel(events, "s2"), null);
});
