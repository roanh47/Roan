import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  authorizeUrl,
  createPkce,
  discover,
  exchangeCode,
  parseTokenResponse,
  refreshToken,
  registerClient,
  type Fetch,
} from "./oauth.js";

/** A fetch that answers from a table and remembers what it was asked. */
function fake(routes: Record<string, { status?: number; body: unknown }>) {
  const asked: { url: string; init: RequestInit | undefined }[] = [];
  const fetchFn: Fetch = async (url, init) => {
    asked.push({ url, init });
    const route = routes[url];
    if (route === undefined) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { asked, fetchFn };
}

const endpoints = {
  authorization: "https://auth.example/authorize",
  token: "https://auth.example/token",
  registration: "https://auth.example/register",
};

describe("browser sign-in for a connection", () => {
  it("finds the sign-in service a server names", async () => {
    const { fetchFn } = fake({
      "https://mcp.example/.well-known/oauth-protected-resource": { body: { authorization_servers: ["https://auth.example"] } },
      "https://auth.example/.well-known/oauth-authorization-server": {
        body: { authorization_endpoint: endpoints.authorization, token_endpoint: endpoints.token, registration_endpoint: endpoints.registration },
      },
    });
    assert.deepEqual(await discover("https://mcp.example/mcp", fetchFn), endpoints);
  });

  it("uses the server itself when it names nobody, and says so when there is no sign-in", async () => {
    const own = fake({
      "https://mcp.example/.well-known/oauth-authorization-server": {
        body: { authorization_endpoint: "https://mcp.example/a", token_endpoint: "https://mcp.example/t" },
      },
    });
    assert.deepEqual(await discover("https://mcp.example/mcp", own.fetchFn), {
      authorization: "https://mcp.example/a",
      token: "https://mcp.example/t",
      registration: null,
    });
    await assert.rejects(discover("https://plain.example/mcp", fake({}).fetchFn), /add it with a token instead/);
  });

  it("introduces Roan with the address the browser comes back to", async () => {
    const { asked, fetchFn } = fake({ [endpoints.registration]: { body: { client_id: "roan-1" } } });
    assert.deepEqual(await registerClient(endpoints, "http://127.0.0.1:6769/oauth/callback", fetchFn), {
      clientId: "roan-1",
      clientSecret: null,
    });
    const sent = JSON.parse(String(asked[0]?.init?.body)) as { redirect_uris: string[]; client_name: string };
    assert.deepEqual(sent.redirect_uris, ["http://127.0.0.1:6769/oauth/callback"]);
    assert.equal(sent.client_name, "Roan");
    await assert.rejects(registerClient({ ...endpoints, registration: null }, "http://x", fetchFn), /with a token instead/);
  });

  it("makes a challenge that is the fingerprint of its secret", () => {
    const { verifier, challenge } = createPkce(() => Buffer.alloc(32, 7));
    const expected = createHash("sha256").update(verifier).digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    assert.equal(challenge, expected);
    assert.match(verifier, /^[A-Za-z0-9_-]+$/);
  });

  it("builds the address to open, with everything the service needs to come back", () => {
    const url = new URL(
      authorizeUrl(endpoints, {
        clientId: "roan-1",
        redirectUri: "http://127.0.0.1:6769/oauth/callback",
        state: "s-1",
        challenge: "c-1",
        resource: "https://mcp.example/mcp",
      }),
    );
    assert.equal(url.origin + url.pathname, endpoints.authorization);
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("state"), "s-1");
    assert.equal(url.searchParams.get("resource"), "https://mcp.example/mcp");
  });

  it("reads a token answer and turns its lifetime into a moment", () => {
    assert.deepEqual(parseTokenResponse({ access_token: "a", refresh_token: "r", expires_in: 3600 }, 1000), {
      accessToken: "a",
      refreshToken: "r",
      expiresAt: 3_601_000,
    });
    assert.deepEqual(parseTokenResponse({ access_token: "a" }, 1000), { accessToken: "a", refreshToken: null, expiresAt: null });
    assert.throws(() => parseTokenResponse({ error: "invalid_grant", error_description: "code used twice" }, 0), /code used twice/);
    assert.throws(() => parseTokenResponse(null, 0), /no token in the answer/);
  });

  it("trades a code for a token, sending the secret that started the sign-in", async () => {
    const { asked, fetchFn } = fake({ [endpoints.token]: { body: { access_token: "a", expires_in: 60 } } });
    const tokens = await exchangeCode(
      endpoints,
      { clientId: "roan-1", clientSecret: null },
      { code: "the-code", verifier: "the-verifier", redirectUri: "http://127.0.0.1:6769/oauth/callback", resource: "https://mcp.example/mcp" },
      fetchFn,
      0,
    );
    assert.equal(tokens.accessToken, "a");
    assert.equal(tokens.expiresAt, 60_000);
    const form = new URLSearchParams(String(asked[0]?.init?.body));
    assert.equal(form.get("grant_type"), "authorization_code");
    assert.equal(form.get("code_verifier"), "the-verifier");
    assert.equal(form.get("client_id"), "roan-1");
    assert.equal(form.get("client_secret"), null);
  });

  it("keeps the old refresh token when a refresh hands back none", async () => {
    const { fetchFn } = fake({ [endpoints.token]: { body: { access_token: "new" } } });
    const tokens = await refreshToken(
      endpoints,
      { clientId: "roan-1", clientSecret: "shh" },
      { refreshToken: "old-refresh", resource: "https://mcp.example/mcp" },
      fetchFn,
      0,
    );
    assert.deepEqual(tokens, { accessToken: "new", refreshToken: "old-refresh", expiresAt: null });
  });
});
