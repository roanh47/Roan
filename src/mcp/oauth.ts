import { createHash, randomBytes } from "node:crypto";

/**
 * Signing in to a connection in the browser.
 *
 * Most services do not hand out a token to paste; they send you to their own
 * page, you say yes there, and the browser comes back with a code. This file
 * is that dance for an MCP server, in the standard order:
 *
 *  1. discover — ask the server who signs people in, and where;
 *  2. register — introduce Roan to that service as a client, once;
 *  3. authorize — build the address the owner opens in a browser;
 *  4. exchange — trade the code the browser came back with for a token;
 *  5. refresh — get a new token when the old one runs out.
 *
 * PKCE ties step 4 to step 3: only whoever started the sign-in can finish it.
 * Nothing here keeps state or touches disk; `fetch` is passed in, so every
 * step is tested without a network.
 */

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface OAuthEndpoints {
  readonly authorization: string;
  readonly token: string;
  /** Where a client introduces itself; null when the service has no such door. */
  readonly registration: string | null;
}

export interface OAuthClient {
  readonly clientId: string;
  readonly clientSecret: string | null;
}

export interface TokenSet {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  /** When the access token ends, in milliseconds; null when the service did not say. */
  readonly expiresAt: number | null;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

async function getJson(fetchFn: Fetch, url: string): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetchFn(url, { headers: { accept: "application/json" } });
    if (!response.ok) return null;
    return record(await response.json());
  } catch {
    return null;
  }
}

/** Who signs people in for this server, and at which addresses. */
export async function discover(serverUrl: string, fetchFn: Fetch = fetch): Promise<OAuthEndpoints> {
  const origin = new URL(serverUrl).origin;
  // The server may name a separate sign-in service; otherwise it is its own.
  const resource = await getJson(fetchFn, `${origin}/.well-known/oauth-protected-resource`);
  const servers = resource?.["authorization_servers"];
  const named = Array.isArray(servers) ? text(servers[0]) : null;
  const issuer = (named ?? origin).replace(/\/+$/, "");

  const metadata =
    (await getJson(fetchFn, `${new URL(issuer).origin}/.well-known/oauth-authorization-server${new URL(issuer).pathname.replace(/\/$/, "")}`)) ??
    (await getJson(fetchFn, `${issuer}/.well-known/oauth-authorization-server`)) ??
    (await getJson(fetchFn, `${issuer}/.well-known/openid-configuration`));
  const authorization = text(metadata?.["authorization_endpoint"]);
  const token = text(metadata?.["token_endpoint"]);
  if (authorization === null || token === null) {
    throw new Error("this service does not offer a browser sign-in Roan can use; add it with a token instead");
  }
  return { authorization, token, registration: text(metadata?.["registration_endpoint"]) };
}

/** Introduces Roan to the service as a client that comes back to `redirectUri`. */
export async function registerClient(
  endpoints: OAuthEndpoints,
  redirectUri: string,
  fetchFn: Fetch = fetch,
): Promise<OAuthClient> {
  if (endpoints.registration === null) {
    throw new Error("this service does not let an app introduce itself; add it with a token instead");
  }
  const response = await fetchFn(endpoints.registration, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_name: "Roan",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  if (!response.ok) throw new Error(`the service refused to register Roan (${String(response.status)})`);
  const body = record(await response.json());
  const clientId = text(body["client_id"]);
  if (clientId === null) throw new Error("the service registered Roan without giving it an id");
  return { clientId, clientSecret: text(body["client_secret"]) };
}

function base64Url(bytes: Buffer): string {
  return bytes.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A secret for one sign-in and the fingerprint of it that goes to the browser. */
export function createPkce(random: (size: number) => Buffer = randomBytes): { verifier: string; challenge: string } {
  const verifier = base64Url(random(32));
  return { verifier, challenge: base64Url(createHash("sha256").update(verifier).digest()) };
}

/** A value that ties the browser's return to the sign-in that was started. */
export function createState(random: (size: number) => Buffer = randomBytes): string {
  return base64Url(random(18));
}

export interface AuthorizeRequest {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly challenge: string;
  /** The server being signed in to, so the token is only good there. */
  readonly resource: string;
}

/** The address the owner opens in a browser to say yes. */
export function authorizeUrl(endpoints: OAuthEndpoints, request: AuthorizeRequest): string {
  const url = new URL(endpoints.authorization);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", request.clientId);
  url.searchParams.set("redirect_uri", request.redirectUri);
  url.searchParams.set("state", request.state);
  url.searchParams.set("code_challenge", request.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("resource", request.resource);
  return url.toString();
}

/** Reads a token answer; `now` makes "expires in an hour" a moment. */
export function parseTokenResponse(body: unknown, now: number): TokenSet {
  const data = record(body);
  const accessToken = text(data["access_token"]);
  if (accessToken === null) {
    const reason = text(data["error_description"]) ?? text(data["error"]) ?? "no token in the answer";
    throw new Error(`the service did not sign you in: ${reason}`);
  }
  const lasts = typeof data["expires_in"] === "number" && Number.isFinite(data["expires_in"]) ? data["expires_in"] : null;
  return {
    accessToken,
    refreshToken: text(data["refresh_token"]),
    expiresAt: lasts !== null && lasts > 0 ? now + lasts * 1000 : null,
  };
}

async function tokenRequest(
  endpoints: OAuthEndpoints,
  client: OAuthClient,
  fields: Record<string, string>,
  fetchFn: Fetch,
  now: number,
): Promise<TokenSet> {
  const form = new URLSearchParams({ ...fields, client_id: client.clientId });
  if (client.clientSecret !== null) form.set("client_secret", client.clientSecret);
  const response = await fetchFn(endpoints.token, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: form.toString(),
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return parseTokenResponse(body, now);
}

/** Trades the code the browser came back with for a token. */
export function exchangeCode(
  endpoints: OAuthEndpoints,
  client: OAuthClient,
  grant: { readonly code: string; readonly verifier: string; readonly redirectUri: string; readonly resource: string },
  fetchFn: Fetch = fetch,
  now: number = Date.now(),
): Promise<TokenSet> {
  return tokenRequest(
    endpoints,
    client,
    {
      grant_type: "authorization_code",
      code: grant.code,
      code_verifier: grant.verifier,
      redirect_uri: grant.redirectUri,
      resource: grant.resource,
    },
    fetchFn,
    now,
  );
}

/** Gets a new token with the refresh token; keeps the old refresh token when none comes back. */
export async function refreshToken(
  endpoints: Pick<OAuthEndpoints, "token">,
  client: OAuthClient,
  grant: { readonly refreshToken: string; readonly resource: string },
  fetchFn: Fetch = fetch,
  now: number = Date.now(),
): Promise<TokenSet> {
  const fresh = await tokenRequest(
    { authorization: "", registration: null, token: endpoints.token },
    client,
    { grant_type: "refresh_token", refresh_token: grant.refreshToken, resource: grant.resource },
    fetchFn,
    now,
  );
  return { ...fresh, refreshToken: fresh.refreshToken ?? grant.refreshToken };
}
