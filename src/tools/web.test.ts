import assert from "node:assert/strict";
import { test } from "node:test";

import { parseDuckDuckGoLite } from "./web.js";

const FIXTURE = `<html><body><table>
<tr><td><a class="result-link" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fvoorbeeld.nl%2Fpoorten&amp;rut=abc">Poorten en <b>adres</b>sen</a></td></tr>
<tr><td class="result-snippet">Alle poorten, &amp; hun &quot;rollen&quot;, kort uitgelegd.</td></tr>
<tr><td><a class="result-link" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Ftweede.be%2F&amp;rut=xyz">Tweede bron</a></td></tr>
<tr><td class="result-snippet">Snippets volgen.</td></tr>
<tr><td><a class="result-link" href="http://onveilig.example">Alleen http</a></td></tr>
</table></body></html>`;

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
