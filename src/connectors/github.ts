/**
 * Read-only GitHub connector.
 *
 * Two reads, both through the REST API: the issue list for a repository and one
 * file's text. There is no write path and no token storage here — the token is
 * an argument, it goes into exactly one request header, and every string that
 * leaves this module (result fields, error messages) is scrubbed of it. The
 * test asserts that with a token that cannot be mistaken for a real one.
 *
 * `fetch` is injected so a test can answer offline; `baseUrl` exists for the
 * same reason. Neither is a place to point at a mirror in production.
 */

import { redact } from "../protocol/redact.js";

/** Default REST root. */
export const GITHUB_API = "https://api.github.com";

/** What a caller may pass instead of a URL. */
export interface Repo {
  owner: string;
  name: string;
}

/** Parsed rate-limit headers. `null` means the header was absent or unreadable. */
export interface RateLimit {
  limit: number | null;
  remaining: number | null;
  /** Unix seconds at which the window resets. */
  reset: number | null;
  used: number | null;
}

export interface GithubIssue {
  number: number;
  title: string;
  state: string;
  author: string | null;
  labels: string[];
  url: string;
  createdAt: string | null;
  updatedAt: string | null;
  body: string | null;
}

export interface GithubFile {
  path: string;
  sha: string;
  size: number;
  /** `base64` for a normal read, `none` when GitHub refuses to inline it. */
  encoding: string;
  /** Decoded UTF-8 text, or `null` when the API returned no content. */
  content: string | null;
}

export interface ListIssuesResult {
  issues: GithubIssue[];
  rateLimit: RateLimit;
}

export interface GetFileResult {
  file: GithubFile;
  rateLimit: RateLimit;
}

export interface GithubDeps {
  /** Transport; defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** API root; defaults to `GITHUB_API`. Must be https. */
  baseUrl?: string;
  /** Page size for `listIssues`, 1–100. Default 50. */
  perPage?: number;
}

/** A failed GitHub call that is safe to show and to put in an event. */
export class GithubError extends Error {
  readonly status: number;
  readonly rateLimit: RateLimit;

  constructor(message: string, status: number, rateLimit: RateLimit) {
    super(message);
    this.name = "GithubError";
    this.status = status;
    this.rateLimit = rateLimit;
  }
}

const NAME_PATTERN = /^[A-Za-z0-9_.-]+$/u;

/**
 * Accepts `https://github.com/owner/repo(.git)`, `git@github.com:owner/repo.git`
 * and the bare `owner/repo` shorthand.
 *
 * Anything else throws with the input quoted. The host is checked, not
 * stripped: `https://github.com.evil.test/o/r` is not this connector's repo.
 */
export function parseRepo(input: string): Repo {
  if (typeof input !== "string" || input.trim() === "") {
    throw new Error("parseRepo: expected owner/repo or a github.com URL");
  }
  let text = input.trim();

  const scp = /^git@github\.com:([^/]+)\/(.+)$/u.exec(text);
  if (scp !== null) {
    const owner = scp[1];
    const name = scp[2];
    if (owner === undefined || name === undefined) {
      throw new Error(`parseRepo: not a valid repository: ${JSON.stringify(input)}`);
    }
    return buildRepo(owner, name, input);
  }

  if (text.includes("://")) {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      throw new Error(`parseRepo: not a valid URL: ${JSON.stringify(input)}`);
    }
    if (url.hostname.toLowerCase() !== "github.com") {
      throw new Error(`parseRepo: expected a github.com URL, got host ${url.hostname}`);
    }
    if (url.protocol !== "https:") {
      throw new Error(`parseRepo: expected https, got ${url.protocol}`);
    }
    const segments = url.pathname.split("/").filter((part) => part !== "");
    if (segments.length < 2) {
      throw new Error(`parseRepo: URL has no owner/repo: ${JSON.stringify(input)}`);
    }
    const owner = segments[0];
    const name = segments[1];
    if (owner === undefined || name === undefined) {
      throw new Error(`parseRepo: URL has no owner/repo: ${JSON.stringify(input)}`);
    }
    return buildRepo(owner, name, input);
  }

  const slash = text.indexOf("/");
  if (slash <= 0 || slash === text.length - 1) {
    throw new Error(`parseRepo: expected owner/repo, got ${JSON.stringify(input)}`);
  }
  return buildRepo(text.slice(0, slash), text.slice(slash + 1), input);
}

/** Validates one half and strips a `.git` suffix from the repository name. */
function buildRepo(owner: string, rawName: string, input: string): Repo {
  const name = rawName.endsWith(".git") ? rawName.slice(0, -4) : rawName;
  if (!NAME_PATTERN.test(owner) || !NAME_PATTERN.test(name)) {
    throw new Error(`parseRepo: owner/repo contains unsupported characters: ${JSON.stringify(input)}`);
  }
  if (owner === "." || owner === ".." || name === "." || name === "..") {
    throw new Error(`parseRepo: owner/repo is not a real name: ${JSON.stringify(input)}`);
  }
  return { owner, name };
}

/** Normalizes `Repo | string` and returns it. */
function resolveRepo(repo: Repo | string): Repo {
  if (typeof repo === "string") return parseRepo(repo);
  if (typeof repo !== "object" || repo === null) {
    throw new Error("github: expected a repo object or an owner/repo string");
  }
  return buildRepo(String(repo.owner), String(repo.name), `${String(repo.owner)}/${String(repo.name)}`);
}

/** A path that cannot escape the repository. */
function resolvePath(path: string): string {
  if (typeof path !== "string" || path.trim() === "") {
    throw new Error("getFile: path must be a non-empty string");
  }
  if (path.startsWith("/") || path.includes("\\")) {
    throw new Error(`getFile: path must be repository-relative, got ${JSON.stringify(path)}`);
  }
  const segments = path.split("/");
  if (segments.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`getFile: path must not contain empty, . or .. segments: ${JSON.stringify(path)}`);
  }
  return segments.map((part) => encodeURIComponent(part)).join("/");
}

/** Replaces the token literally, then runs the project-wide scrubber. */
function scrub(text: string, token: string): string {
  const withoutToken = token === "" ? text : text.split(token).join("[redacted]");
  return redact(withoutToken);
}

function readIntHeader(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isInteger(value) ? value : null;
}

/** Reads the four rate-limit headers GitHub sends on every answer. */
function readRateLimit(headers: Headers): RateLimit {
  return {
    limit: readIntHeader(headers, "x-ratelimit-limit"),
    remaining: readIntHeader(headers, "x-ratelimit-remaining"),
    reset: readIntHeader(headers, "x-ratelimit-reset"),
    used: readIntHeader(headers, "x-ratelimit-used"),
  };
}

function readToken(token: string): string {
  if (typeof token !== "string" || token.trim() === "") {
    throw new Error("github: token must be a non-empty string");
  }
  return token;
}

/** Checks the base URL: https only, no credentials. */
function readBaseUrl(raw: string | undefined): string {
  const base = raw ?? GITHUB_API;
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new Error(`github baseUrl: not a valid URL: ${JSON.stringify(base)}`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`github baseUrl: expected https, got ${url.protocol}`);
  }
  if (url.username !== "" || url.password !== "") {
    throw new Error("github baseUrl: credentials in the URL are not allowed");
  }
  return url.toString().replace(/\/+$/u, "");
}

interface CallResult {
  status: number;
  rateLimit: RateLimit;
  text: string;
}

/**
 * One request with the shared headers.
 *
 * A transport error becomes a `GithubError` whose message is scrubbed; the
 * caller never sees the raw error object, so a stack or a nested cause cannot
 * carry the request headers out with it.
 */
async function call(
  token: string,
  url: string,
  deps: GithubDeps,
): Promise<CallResult> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      redirect: "error",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "user-agent": "roan-connector/1",
        "x-github-api-version": "2022-11-28",
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new GithubError(
      `github: request failed: ${scrub(message, token)}`,
      0,
      { limit: null, remaining: null, reset: null, used: null },
    );
  }
  const rateLimit = readRateLimit(response.headers);
  const text = await response.text();
  if (!response.ok) {
    const detail = firstJsonMessage(text) ?? truncate(text, 300);
    throw new GithubError(
      `github: ${response.status} ${truncate(scrub(detail, token), 300)}`.trim(),
      response.status,
      rateLimit,
    );
  }
  return { status: response.status, rateLimit, text };
}

/** Pulls `message` out of a GitHub error body when there is one. */
function firstJsonMessage(text: string): string | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null) {
      const message = (parsed as Record<string, unknown>)["message"];
      if (typeof message === "string" && message !== "") return message;
    }
  } catch {
    return null;
  }
  return null;
}

function truncate(text: string, max: number): string {
  const oneLine = text.replace(/[\r\n]+/gu, " ").trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max)}…`;
}

function decodeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new GithubError("github: response was not valid JSON", 0, {
      limit: null,
      remaining: null,
      reset: null,
      used: null,
    });
  }
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new GithubError(`github: ${what} was not an object`, 0, {
      limit: null,
      remaining: null,
      reset: null,
      used: null,
    });
  }
  return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  return typeof value === "string" ? value : null;
}

/** Maps one API issue into the small shape the agent needs. */
function toIssue(raw: unknown): GithubIssue {
  const issue = asRecord(raw, "issue");
  const number = issue["number"];
  if (typeof number !== "number" || !Number.isInteger(number)) {
    throw new GithubError("github: issue without a number", 0, {
      limit: null,
      remaining: null,
      reset: null,
      used: null,
    });
  }
  const user = issue["user"];
  const author =
    typeof user === "object" && user !== null && typeof (user as Record<string, unknown>)["login"] === "string"
      ? ((user as Record<string, unknown>)["login"] as string)
      : null;
  const rawLabels = issue["labels"];
  const labels: string[] = [];
  if (Array.isArray(rawLabels)) {
    for (const label of rawLabels) {
      if (typeof label === "string") {
        labels.push(label);
      } else if (typeof label === "object" && label !== null) {
        const name = (label as Record<string, unknown>)["name"];
        if (typeof name === "string") labels.push(name);
      }
    }
  }
  return {
    number,
    title: stringField(issue, "title") ?? "",
    state: stringField(issue, "state") ?? "unknown",
    author,
    labels,
    url: stringField(issue, "html_url") ?? "",
    createdAt: stringField(issue, "created_at"),
    updatedAt: stringField(issue, "updated_at"),
    body: stringField(issue, "body"),
  };
}

export type IssueState = "open" | "closed" | "all";

/**
 * Lists issues for one repository.
 *
 * Pull requests are filtered out: GitHub's issue endpoint includes them, and a
 * caller that asked for issues should not get PRs back silently.
 */
export async function listIssues(
  token: string,
  repo: Repo | string,
  state: IssueState = "open",
  deps: GithubDeps = {},
): Promise<ListIssuesResult> {
  const key = readToken(token);
  const target = resolveRepo(repo);
  if (state !== "open" && state !== "closed" && state !== "all") {
    throw new Error(`listIssues: state must be open, closed or all, got ${String(state)}`);
  }
  const perPage = deps.perPage ?? 50;
  if (!Number.isInteger(perPage) || perPage < 1 || perPage > 100) {
    throw new Error(`listIssues: perPage must be an integer 1–100, got ${String(perPage)}`);
  }

  const base = readBaseUrl(deps.baseUrl);
  const url =
    `${base}/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.name)}` +
    `/issues?state=${state}&per_page=${perPage}`;
  const response = await call(key, url, deps);
  const parsed = decodeJson(response.text);
  if (!Array.isArray(parsed)) {
    throw new GithubError("github: issue list was not an array", response.status, response.rateLimit);
  }

  const issues: GithubIssue[] = [];
  for (const raw of parsed) {
    const issue = toIssue(raw);
    if (issue.url.includes("/pull/")) continue;
    issues.push(issue);
  }
  return { issues, rateLimit: response.rateLimit };
}

/**
 * Reads one file's text at the repository's default branch.
 *
 * GitHub returns `encoding: "none"` and no content for a large file; that is
 * reported as `content: null` rather than an error, because the metadata is
 * still useful and the caller can decide to fetch the blob itself.
 */
export async function getFile(
  token: string,
  repo: Repo | string,
  path: string,
  deps: GithubDeps = {},
): Promise<GetFileResult> {
  const key = readToken(token);
  const target = resolveRepo(repo);
  const safePath = resolvePath(path);
  const base = readBaseUrl(deps.baseUrl);
  const url = `${base}/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.name)}/contents/${safePath}`;

  const response = await call(key, url, deps);
  const record = asRecord(decodeJson(response.text), "file response");
  const encoding = stringField(record, "encoding") ?? "none";
  const rawContent = record["content"];

  let content: string | null = null;
  if (encoding === "base64" && typeof rawContent === "string") {
    const compact = rawContent.replace(/\s+/gu, "");
    content = Buffer.from(compact, "base64").toString("utf8");
  }

  const sha = stringField(record, "sha") ?? "";
  const size = record["size"];
  return {
    file: {
      path: stringField(record, "path") ?? path,
      sha,
      size: typeof size === "number" && Number.isInteger(size) ? size : 0,
      encoding,
      content,
    },
    rateLimit: response.rateLimit,
  };
}
