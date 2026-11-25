import { get as httpsGet } from "node:https";

/** How much of a page a provider is allowed to read. */
export const FETCH_LIMIT_BYTES = 64_000;
const TIMEOUT_MS = 10_000;

/** https-only text fetch with a byte ceiling; resolves with what fit. */
export function fetchText(url: string, limitBytes = FETCH_LIMIT_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = httpsGet(
      url,
      {
        timeout: TIMEOUT_MS,
        headers: { "user-agent": "Mozilla/5.0 Roan-agent", accept: "text/html,text/plain,application/rss+xml,application/json,*/*" },
      },
      (response) => {
        if (response.statusCode !== undefined && (response.statusCode < 200 || response.statusCode >= 300)) {
          response.resume();
          reject(new Error(`HTTP ${String(response.statusCode)}`));
          return;
        }
        let seen = 0;
        let body = "";
        let done = false;
        const finish = (): void => {
          if (done) return;
          done = true;
          response.destroy();
          resolve(body);
        };
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          seen += chunk.length;
          // Enough is enough: the first `limit` bytes are the page for us.
          // Destroying the request here used to surface as an "aborted" error,
          // which is why every real (larger) page failed to load.
          if (seen <= limitBytes) body += chunk;
          else finish();
        });
        response.on("end", finish);
        response.on("error", (error) => {
          if (!done) reject(error);
        });
      },
    );
    request.on("timeout", () => {
      request.destroy(new Error("request timed out"));
    });
    request.on("error", reject);
  });
}

/** Refuses anything that is not a public https url. */
export function assertSafeUrl(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0) throw new Error("no url given");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`not a valid url: ${raw}`);
  }
  if (parsed.protocol !== "https:") throw new Error("only https is fetched");
  const host = parsed.hostname.toLowerCase();
  const blocked =
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "metadata.google.internal" ||
    /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ||
    host.endsWith(".local");
  if (blocked) throw new Error("private and loopback addresses are not fetched");
  return parsed.toString();
}

/** HTML to readable text: scripts and styles out, block ends become breaks. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
