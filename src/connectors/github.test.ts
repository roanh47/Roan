import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GITHUB_API, GithubError, getFile, listIssues, parseRepo } from "./github.js";

const TOKEN = "fixture-token-not-real-1234";

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(answer: (call: Call) => Response | Promise<Response>): {
  fetch: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return answer(call);
  };
  return { fetch: impl as unknown as typeof fetch, calls };
}

function headerOf(call: Call, name: string): string | null {
  return new Headers(call.init.headers as Record<string, string>).get(name);
}

const RATE_HEADERS = {
  "x-ratelimit-limit": "5000",
  "x-ratelimit-remaining": "4993",
  "x-ratelimit-reset": "1800000900",
  "x-ratelimit-used": "7",
};

describe("parseRepo", () => {
  it("accepts the URL, ssh and shorthand forms", () => {
    assert.deepEqual(parseRepo("https://github.com/roan/Roan"), { owner: "roan", name: "Roan" });
    assert.deepEqual(parseRepo("https://github.com/roan/Roan.git"), { owner: "roan", name: "Roan" });
    assert.deepEqual(parseRepo("https://github.com/roan/Roan/"), { owner: "roan", name: "Roan" });
    assert.deepEqual(parseRepo("https://github.com/roan/Roan/tree/main"), {
      owner: "roan",
      name: "Roan",
    });
    assert.deepEqual(parseRepo("git@github.com:roan/Roan.git"), { owner: "roan", name: "Roan" });
    assert.deepEqual(parseRepo("roan/Roan"), { owner: "roan", name: "Roan" });
    assert.deepEqual(parseRepo("roan/Roan.git"), { owner: "roan", name: "Roan" });
  });

  it("refuses another host, plain http and shapes that are not a repo", () => {
    assert.throws(() => parseRepo("https://gitlab.com/roan/Roan"), /github\.com/u);
    assert.throws(() => parseRepo("http://github.com/roan/Roan"), /https/u);
    assert.throws(() => parseRepo("https://github.com.evil.test/roan/Roan"), /github\.com/u);
    assert.throws(() => parseRepo("https://github.com/roan"), /no owner\/repo/u);
    assert.throws(() => parseRepo("roan"), /expected owner\/repo/u);
    assert.throws(() => parseRepo(""), /expected owner\/repo/u);
    assert.throws(() => parseRepo("roan/Roan/extra"), /unsupported characters/u);
  });
});

describe("listIssues", () => {
  it("reads the issues endpoint with the token in one header", async () => {
    const fake = fakeFetch(
      () =>
        new Response(
          JSON.stringify([
            {
              number: 12,
              title: "Webhook retry",
              state: "open",
              user: { login: "roan" },
              labels: [{ name: "feature" }, "later"],
              html_url: "https://github.com/roan/Roan/issues/12",
              created_at: "2026-11-01T10:00:00Z",
              updated_at: "2026-11-02T10:00:00Z",
              body: "please",
            },
            {
              number: 13,
              title: "A pull request",
              state: "open",
              user: { login: "roan" },
              labels: [],
              html_url: "https://github.com/roan/Roan/pull/13",
              created_at: "2026-11-01T10:00:00Z",
              updated_at: "2026-11-02T10:00:00Z",
              body: null,
            },
          ]),
          { status: 200, headers: RATE_HEADERS },
        ),
    );

    const result = await listIssues(TOKEN, "roan/Roan", "open", { fetch: fake.fetch });

    assert.equal(fake.calls.length, 1);
    const call = fake.calls[0];
    assert.notEqual(call, undefined);
    if (call === undefined) return;
    assert.equal(call.url, `${GITHUB_API}/repos/roan/Roan/issues?state=open&per_page=50`);
    assert.equal(headerOf(call, "authorization"), `Bearer ${TOKEN}`);
    assert.equal(headerOf(call, "accept"), "application/vnd.github+json");
    assert.equal(call.init.method, "GET");

    assert.equal(result.issues.length, 1);
    assert.deepEqual(result.issues[0], {
      number: 12,
      title: "Webhook retry",
      state: "open",
      author: "roan",
      labels: ["feature", "later"],
      url: "https://github.com/roan/Roan/issues/12",
      createdAt: "2026-11-01T10:00:00Z",
      updatedAt: "2026-11-02T10:00:00Z",
      body: "please",
    });
    assert.deepEqual(result.rateLimit, { limit: 5000, remaining: 4993, reset: 1800000900, used: 7 });
  });

  it("surfaces the rate limit on an error answer", async () => {
    const fake = fakeFetch(
      () =>
        new Response(JSON.stringify({ message: "Bad credentials" }), {
          status: 401,
          headers: { ...RATE_HEADERS, "x-ratelimit-remaining": "0" },
        }),
    );

    await assert.rejects(listIssues(TOKEN, "roan/Roan", "all", { fetch: fake.fetch }), (error) => {
      assert.equal(error instanceof GithubError, true);
      const github = error as GithubError;
      assert.equal(github.status, 401);
      assert.equal(github.rateLimit.remaining, 0);
      assert.match(github.message, /401 Bad credentials/u);
      assert.equal(github.message.includes(TOKEN), false);
      return true;
    });
  });

  it("never puts the token in a transport error", async () => {
    const fake = fakeFetch(() => {
      throw new Error(`socket closed while sending Bearer ${TOKEN}`);
    });
    await assert.rejects(listIssues(TOKEN, "roan/Roan", "open", { fetch: fake.fetch }), (error) => {
      const message = (error as Error).message;
      assert.equal(message.includes(TOKEN), false);
      assert.match(message, /\[redacted\]/u);
      return true;
    });
  });

  it("validates state, token and page size before any request", async () => {
    const fake = fakeFetch(() => new Response("[]", { status: 200 }));
    await assert.rejects(
      listIssues(TOKEN, "roan/Roan", "merged" as "open", { fetch: fake.fetch }),
      /state must be/u,
    );
    await assert.rejects(listIssues("", "roan/Roan", "open", { fetch: fake.fetch }), /token/u);
    await assert.rejects(
      listIssues(TOKEN, "roan/Roan", "open", { fetch: fake.fetch, perPage: 101 }),
      /perPage/u,
    );
    assert.equal(fake.calls.length, 0);
  });

  it("refuses a non-https base URL", async () => {
    const fake = fakeFetch(() => new Response("[]", { status: 200 }));
    await assert.rejects(
      listIssues(TOKEN, "roan/Roan", "open", { fetch: fake.fetch, baseUrl: "http://api.github.test" }),
      /expected https/u,
    );
    assert.equal(fake.calls.length, 0);
  });
});

describe("getFile", () => {
  const sha = "0123456789abcdef0123456789abcdef01234567";

  it("decodes a base64 file and reports the rate limit", async () => {
    const fake = fakeFetch(
      () =>
        new Response(
          JSON.stringify({
            path: "docs/note file.md",
            sha,
            size: 12,
            encoding: "base64",
            content: Buffer.from("hello\nworld\n", "utf8").toString("base64"),
          }),
          { status: 200, headers: RATE_HEADERS },
        ),
    );

    const result = await getFile(TOKEN, { owner: "roan", name: "Roan" }, "docs/note file.md", {
      fetch: fake.fetch,
    });

    const call = fake.calls[0];
    assert.notEqual(call, undefined);
    if (call === undefined) return;
    assert.equal(
      call.url,
      `${GITHUB_API}/repos/roan/Roan/contents/docs/note%20file.md`,
    );
    assert.equal(result.file.content, "hello\nworld\n");
    assert.equal(result.file.encoding, "base64");
    assert.equal(result.file.sha, sha);
    assert.equal(result.rateLimit.limit, 5000);
  });

  it("reports a file GitHub refuses to inline as null content", async () => {
    const fake = fakeFetch(
      () =>
        new Response(
          JSON.stringify({ path: "big.bin", sha, size: 9_000_000, encoding: "none", content: "" }),
          { status: 200, headers: RATE_HEADERS },
        ),
    );
    const result = await getFile(TOKEN, "roan/Roan", "big.bin", { fetch: fake.fetch });
    assert.equal(result.file.content, null);
    assert.equal(result.file.encoding, "none");
    assert.equal(result.file.size, 9_000_000);
  });

  it("refuses traversal and absolute paths before any request", async () => {
    const fake = fakeFetch(() => new Response("{}", { status: 200 }));
    for (const path of ["../secrets/token.json", "/etc/passwd", "docs/../../x", "a//b", "a\\b", ""]) {
      await assert.rejects(getFile(TOKEN, "roan/Roan", path, { fetch: fake.fetch }), /path/u);
    }
    assert.equal(fake.calls.length, 0);
  });

  it("refuses a 404 with the status and no token", async () => {
    const fake = fakeFetch(
      () => new Response(JSON.stringify({ message: "Not Found" }), { status: 404, headers: RATE_HEADERS }),
    );
    await assert.rejects(getFile(TOKEN, "roan/Roan", "missing.md", { fetch: fake.fetch }), (error) => {
      assert.equal((error as GithubError).status, 404);
      assert.equal((error as Error).message.includes(TOKEN), false);
      return true;
    });
  });
});
