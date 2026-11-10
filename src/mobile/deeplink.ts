/**
 * Join deep links.
 *
 * A join link is `roan://join?code=…&chain=…&expires=…`. Parsing is strict:
 * the scheme and host are checked, every parameter is required, the code has a
 * minimum length, and `expires` must be an ISO 8601 timestamp. Extra query
 * parameters are ignored, so older and newer clients can share a link.
 *
 * The code is a secret: only its length may appear in an error message.
 */

export interface JoinLinkPayload {
  code: string;
  chainId: string;
  /** Absolute expiry; `formatJoinLink` always emits UTC ISO 8601. */
  expiresAt: Date;
}

const SCHEME = 'roan';
const HOST = 'join';
const MIN_CODE_LENGTH = 8;
/** Date-only and loosely worded timestamps are rejected; an offset or `Z` is required. */
const ISO_8601_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

type ParamName = 'code' | 'chain' | 'expires';

function requireCode(code: unknown): string {
  if (typeof code !== 'string') {
    throw new Error(`join link parameter "code" must be a string, got ${typeof code}`);
  }
  if (code.length < MIN_CODE_LENGTH) {
    throw new Error(
      `join link parameter "code" must be at least ${MIN_CODE_LENGTH} characters, got ${code.length}`,
    );
  }
  return code;
}

function requireChainId(chainId: unknown): string {
  if (typeof chainId !== 'string') {
    throw new Error(`join link parameter "chain" must be a string, got ${typeof chainId}`);
  }
  if (chainId.trim().length === 0) {
    throw new Error('join link parameter "chain" must be a non-empty id');
  }
  return chainId;
}

function requireExpiresAt(expiresAt: unknown): Date {
  if (!(expiresAt instanceof Date) || !Number.isFinite(expiresAt.getTime())) {
    throw new Error('join link parameter "expires" must be a valid Date');
  }
  return expiresAt;
}

function parseExpires(raw: string): Date {
  const time = Date.parse(raw);
  if (!ISO_8601_PATTERN.test(raw) || !Number.isFinite(time)) {
    throw new Error(
      `join link parameter "expires" must be an ISO 8601 timestamp, got ${JSON.stringify(raw)}`,
    );
  }
  return new Date(time);
}

function requireParam(params: URLSearchParams, name: ParamName): string {
  const value = params.get(name);
  if (value === null) {
    throw new Error(`join link is missing required parameter "${name}"`);
  }
  return value;
}

function toUrl(link: string): URL {
  try {
    return new URL(link);
  } catch {
    // The raw link is not echoed: it may carry the pairing code.
    throw new Error('join link is not a valid URL');
  }
}

/**
 * Parse a `roan://join?…` deep link into a payload.
 *
 * @throws Error naming the offending field: non-string input, wrong scheme or
 *   host, unparseable URL, missing parameter, short code, empty chain id, or a
 *   non-ISO-8601 `expires`.
 */
export function parseJoinLink(link: string): JoinLinkPayload {
  if (typeof link !== 'string') {
    throw new Error(`join link must be a string, got ${typeof link}`);
  }

  const url = toUrl(link);
  if (url.protocol !== `${SCHEME}:`) {
    throw new Error(
      `join link scheme must be "${SCHEME}", got ${JSON.stringify(url.protocol.replace(/:$/, ''))}`,
    );
  }
  if (url.hostname !== HOST) {
    throw new Error(`join link host must be "${HOST}", got ${JSON.stringify(url.hostname)}`);
  }

  const code = requireCode(requireParam(url.searchParams, 'code'));
  const chainId = requireChainId(requireParam(url.searchParams, 'chain'));
  const expiresAt = parseExpires(requireParam(url.searchParams, 'expires'));

  return { code, chainId, expiresAt };
}

/**
 * Build a `roan://join?…` deep link, URL-encoding every value so it survives a
 * trip through {@link parseJoinLink}. `expiresAt` is written as UTC ISO 8601.
 *
 * @throws Error naming the offending field when the payload would not parse.
 */
export function formatJoinLink(payload: JoinLinkPayload): string {
  const code = requireCode(payload.code);
  const chainId = requireChainId(payload.chainId);
  const expiresAt = requireExpiresAt(payload.expiresAt);

  const params = new URLSearchParams({
    code,
    chain: chainId,
    expires: expiresAt.toISOString(),
  });

  return `${SCHEME}://${HOST}?${params.toString()}`;
}
