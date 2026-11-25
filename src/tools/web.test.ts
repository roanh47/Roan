import assert from "node:assert/strict";
import { test } from "node:test";

import { parseBingRss, parseDuckDuckGoLite, parseSearxng, parseWikiOpenSearch } from "../web/parse.js";

const FIXTURE = `<html><body><table>
<tr><td><a class="result-link" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fvoorbeeld.nl%2Fpoorten&amp;rut=abc">Poorten en <b>adres</b>sen</a></td></tr>
<tr><td class="result-snippet">Alle poorten, &amp; hun &quot;rollen&quot;, kort uitgelegd.</td></tr>
<tr><td><a class="result-link" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Ftweede.be%2F&amp;rut=xyz">Tweede bron</a></td></tr>
<tr><td class="result-snippet">Snippets volgen.</td></tr>
<tr><td><a class="result-link" href="http://onveilig.example">Alleen http</a></td></tr>
</table></body></html>`;

test("the Bing RSS lane turns items into cited hits", () => {
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Bing: hanze</title>
    <item><title>Hanze University</title><link>https://www.hanze.nl/en</link>
    <description>Applied sciences in the north of the Netherlands &amp; beyond.</description></item>
    <item><title>Hanzehogeschool &lt;wiki&gt;</title><link>https://nl.wikipedia.org/wiki/Hanzehogeschool</link>
    <description><![CDATA[De <b>Hanzehogeschool</b> is een instelling.]]></description></item>
    <item><title>Insecure</title><link>http://example.org/x</link><description>no</description></item>
  </channel></rss>`;
  const hits = parseBingRss(xml);
  assert.equal(hits.length, 2);
  assert.deepEqual(hits[0], {
    title: "Hanze University",
    url: "https://www.hanze.nl/en",
    snippet: "Applied sciences in the north of the Netherlands & beyond.",
  });
  assert.equal(hits[1]?.title, "Hanzehogeschool <wiki>");
  assert.equal(hits[1]?.snippet, "De Hanzehogeschool is een instelling.");
  assert.equal(parseBingRss(xml, 1).length, 1);
  assert.deepEqual(parseBingRss("<html>not a feed</html>"), []);
});

test("the parser turns a lite results page into cited hits", () => {
  const hits = parseDuckDuckGoLite(FIXTURE);
  assert.deepEqual(
    hits.map((hit) => [hit.title, hit.url, hit.snippet]),
    [
      ["Poorten en adressen", "https://voorbeeld.nl/poorten", "Alle poorten, & hun \"rollen\", kort uitgelegd."],
      ["Tweede bron", "https://tweede.be/", "Snippets volgen."],
    ],
  );
});

test("non-https results never make it into a citation", () => {
  const hits = parseDuckDuckGoLite(FIXTURE);
  assert.ok(hits.every((hit) => hit.url.startsWith("https://")));
});

test("the limit is honoured", () => {
  const hits = parseDuckDuckGoLite(FIXTURE, 1);
  assert.equal(hits.length, 1);
});

const WIKI_FIXTURE = JSON.stringify([
  "poort",
  ["Poort (netwerk)", "TCP en UDP", "Lijst van poorten"],
  ["Een netwerkpoort is een getal.", "TCP en UDP zijn transportprotocollen.", "Lijst met bekende poorten."],
  [
    "https://nl.wikipedia.org/wiki/Poort_(netwerk)",
    "https://nl.wikipedia.org/wiki/TCP",
    "https://nl.wikipedia.org/wiki/Lijst_van_poorten",
  ],
]);

test("the wiki fallback turns an opensearch answer into cited hits", () => {
  const hits = parseWikiOpenSearch(WIKI_FIXTURE);
  assert.deepEqual(hits, [
    {
      title: "Poort (netwerk)",
      url: "https://nl.wikipedia.org/wiki/Poort_(netwerk)",
      snippet: "Een netwerkpoort is een getal.",
    },
    { title: "TCP en UDP", url: "https://nl.wikipedia.org/wiki/TCP", snippet: "TCP en UDP zijn transportprotocollen." },
    {
      title: "Lijst van poorten",
      url: "https://nl.wikipedia.org/wiki/Lijst_van_poorten",
      snippet: "Lijst met bekende poorten.",
    },
  ]);
});

test("malformed or short wiki answers stay empty, never throw", () => {
  assert.deepEqual(parseWikiOpenSearch("geen json"), []);
  assert.deepEqual(parseWikiOpenSearch('["poort", ["E\u00e9n titel"]]'), []);
  assert.deepEqual(
    parseWikiOpenSearch(
      JSON.stringify(["poort", ["X"], ["Y"], ["http://onveilig.example/X"]]),
    ),
    [],
  );
});
