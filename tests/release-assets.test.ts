import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * The release pipeline is the only thing that decides what a user downloads.
 * A stray bundler output (an .msi next to the .exe, a .deb next to the
 * AppImage, a dSYM zip, a checksums file) is a support problem: people pick
 * the wrong one and file bugs about a build we never tested.
 *
 * So this suite pins the whole chain, not just the final list:
 *   1. every build job uploads exactly one artifact, with an exact path;
 *   2. the release job consumes exactly those four artifacts;
 *   3. the release publishes exactly four files, by exact name;
 *   4. the publish list contains no globs, so a new bundler output cannot
 *      silently join the release;
 *   5. the asset names agree with APP_VERSION and tauri.conf.json.
 *
 * There is no YAML dependency in this repo, so the workflow is parsed with the
 * subset of YAML it actually uses (indented mappings, sequences, block
 * scalars). That is enough to assert against structure instead of grepping for
 * magic strings, which would pass even if the structure were wrong.
 */

// -------------------------------------------------------------------- yaml --

interface Line {
  indent: number;
  text: string;
}

type Yaml = string | number | boolean | null | Yaml[] | { [key: string]: Yaml };

function resolveWorkflowPath(): string {
  const start = dirname(fileURLToPath(import.meta.url));
  for (let dir = start; ; dir = dirname(dir)) {
    const candidate = join(dir, ".github", "workflows", "release.yml");
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    if (dirname(dir) === dir) {
      throw new Error(`could not find .github/workflows/release.yml above ${start}`);
    }
  }
}

function scalar(raw: string): Yaml {
  let text = raw.trim();
  // Strip a trailing comment that is not inside quotes.
  if (!/^["']/.test(text)) {
    const hash = text.indexOf(" #");
    if (hash !== -1) text = text.slice(0, hash).trim();
  }
  if (text === "" || text === "~" || text === "null") return null;
  if (text === "true") return true;
  if (text === "false") return false;
  if (/^-?\d+$/.test(text)) return Number(text);
  if (text.startsWith("[") && text.endsWith("]")) {
    const inner = text.slice(1, -1).trim();
    return inner === "" ? [] : inner.split(",").map((part) => scalar(part));
  }
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1);
  }
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1);
  }
  return text;
}

const isDash = (line: Line): boolean => line.text === "-" || line.text.startsWith("- ");

function parseWorkflow(source: string): Yaml {
  const raw = source.split(/\r?\n/);
  const lines: Line[] = [];
  for (const original of raw) {
    const stripped = original.replace(/\t/g, "  ");
    if (stripped.trim() === "") continue;
    if (stripped.trimStart().startsWith("#")) continue;
    const indent = stripped.length - stripped.trimStart().length;
    lines.push({ indent, text: stripped.slice(indent).trimEnd() });
  }

  /** Consume a `|` / `|-` block scalar starting at line `index`. */
  function blockScalar(index: number, parentIndent: number): [string, number] {
    const collected: Line[] = [];
    let i = index;
    while (i < lines.length) {
      const line = lines[i]!;
      if (line.indent <= parentIndent) break;
      collected.push(line);
      i += 1;
    }
    const width = collected.reduce((min, line) => Math.min(min, line.indent), Infinity);
    const body = collected.map((line) => " ".repeat(line.indent - width) + line.text);
    const joined = body.join("\n");
    return [joined === "" ? "" : `${joined}\n`, i];
  }

  function parseBlock(index: number, indent: number): [Yaml, number] {
    const line = lines[index];
    if (!line) throw new Error(`expected a node at line ${index}`);
    if (isDash(line) && line.indent === indent) return parseSequence(index, indent);
    return parseMapping(index, indent);
  }

  function parseSequence(index: number, indent: number): [Yaml[], number] {
    const items: Yaml[] = [];
    let i = index;
    while (i < lines.length) {
      const line = lines[i]!;
      if (line.indent !== indent || !isDash(line)) break;
      const afterDash = line.text.slice(1);
      const contentIndent = indent + 1 + (afterDash.length - afterDash.trimStart().length);
      const content = afterDash.trim();

      if (content === "") {
        const next = lines[i + 1];
        if (!next || next.indent <= indent) {
          items.push(null);
          i += 1;
          continue;
        }
        const [value, nextIndex] = parseBlock(i + 1, next.indent);
        items.push(value);
        i = nextIndex;
        continue;
      }

      // A dash line opens an inline node: rewrite it without the dash and let
      // the mapping parser consume it plus any sibling keys indented under it.
      const looksLikeKey = /^[^:\s][^:]*:(\s|$)/.test(content);
      if (!looksLikeKey) {
        items.push(scalar(content));
        i += 1;
        continue;
      }
      lines[i] = { indent: contentIndent, text: content };
      const [value, nextIndex] = parseMapping(i, contentIndent);
      items.push(value);
      i = nextIndex;
    }
    return [items, i];
  }

  function parseMapping(index: number, indent: number): [{ [key: string]: Yaml }, number] {
    const node: { [key: string]: Yaml } = {};
    let i = index;
    while (i < lines.length) {
      const line = lines[i]!;
      if (line.indent < indent) break;
      if (line.indent > indent) throw new Error(`unexpected indent at line ${i}: ${line.text}`);
      if (isDash(line)) break;

      const match = /^([^:][^:]*?):(?:\s+(.*))?$/.exec(line.text);
      if (!match) throw new Error(`cannot parse mapping entry at line ${i}: ${line.text}`);
      const key = match[1]!.trim();
      const rest = (match[2] ?? "").trim();

      if (rest === "|" || rest === "|-" || rest === ">" || rest === ">-") {
        const [body, nextIndex] = blockScalar(i + 1, indent);
        node[key] = body;
        i = nextIndex;
        continue;
      }
      if (rest !== "") {
        node[key] = scalar(rest);
        i += 1;
        continue;
      }
      const next = lines[i + 1];
      if (!next || next.indent <= indent) {
        node[key] = null;
        i += 1;
        continue;
      }
      const [value, nextIndex] = parseBlock(i + 1, next.indent);
      node[key] = value;
      i = nextIndex;
    }
    return [node, i];
  }

  const [root] = parseBlock(0, lines[0]!.indent);
  return root;
}

// ------------------------------------------------------------------ helpers --

const source = readFileSync(resolveWorkflowPath(), "utf8");
const workflow = parseWorkflow(source) as {
  [key: string]: any;
};

const BUILD_JOBS = ["windows", "macos", "linux", "android"] as const;

/** The four release files, keyed by the job that builds each one. */
const EXPECTED = {
  windows: { artifact: "windows-x64", file: "Roan-0.0.1-x64.exe" },
  macos: { artifact: "macos-arm64", file: "Roan-0.0.1-arm64.dmg" },
  linux: { artifact: "linux-x86_64", file: "Roan-0.0.1-x86_64.AppImage" },
  android: { artifact: "android-apk", file: "Roan-0.0.1.apk" },
} as const;

const EXPECTED_FILES = BUILD_JOBS.map((job) => EXPECTED[job].file);

function steps(job: any): any[] {
  const value = job?.steps;
  assert.ok(Array.isArray(value), "job must declare a steps sequence");
  return value;
}

function uploadSteps(job: any): any[] {
  return steps(job).filter(
    (step) => typeof step?.uses === "string" && step.uses.startsWith("actions/upload-artifact@"),
  );
}

function lines(value: unknown): string[] {
  assert.equal(typeof value, "string", "expected a block scalar");
  return (value as string)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

// -------------------------------------------------------------------- tests --

test("the workflow has exactly the four build jobs and one release job", () => {
  const jobs = workflow.jobs;
  assert.ok(jobs && typeof jobs === "object", "workflow must declare jobs");
  assert.deepEqual(
    Object.keys(jobs).sort(),
    [...BUILD_JOBS, "release"].sort(),
    "only the four platform builds and the publisher may exist; any extra job could upload artifacts",
  );
});

test("each platform job uploads exactly one artifact with an exact, non-glob path", () => {
  for (const jobName of BUILD_JOBS) {
    const uploads = uploadSteps(workflow.jobs[jobName]);
    assert.equal(uploads.length, 1, `${jobName} must upload exactly one artifact`);

    const upload = uploads[0]!;
    assert.equal(upload.with?.name, EXPECTED[jobName].artifact, `${jobName} artifact name`);
    assert.equal(upload.with?.path, `out/${EXPECTED[jobName].file}`, `${jobName} artifact path`);
    assert.equal(upload.with?.["if-no-files-found"], "error", `${jobName} must fail when empty`);

    const path = String(upload.with?.path);
    assert.doesNotMatch(path, /[*?[\]]/, `${jobName} artifact path must not use globs`);
  }
});

test("the workflow as a whole uploads exactly four artifacts", () => {
  const all = Object.values(workflow.jobs).flatMap((job: any) => uploadSteps(job));
  assert.equal(all.length, 4, "exactly four upload-artifact steps, no more");

  const names = all.map((upload) => upload.with?.name).sort();
  assert.deepEqual(names, BUILD_JOBS.map((job) => EXPECTED[job].artifact).sort());
});

test("the release job depends on all four builds and downloads them merged", () => {
  const release = workflow.jobs.release;
  assert.deepEqual(
    [...release.needs].sort(),
    [...BUILD_JOBS].sort(),
    "release must wait for every platform, otherwise it can publish a partial set",
  );

  const download = steps(release).find(
    (step) => typeof step.uses === "string" && step.uses.startsWith("actions/download-artifact@"),
  );
  assert.ok(download, "release must download the build artifacts");
  assert.equal(download.with?.["merge-multiple"], true, "artifacts must land in one directory");
  assert.equal(download.with?.path, "release");
});

test("the published release lists exactly the four files and nothing else", () => {
  const create = steps(workflow.jobs.release).find(
    (step) => typeof step.uses === "string" && step.uses.startsWith("softprops/action-gh-release@"),
  );
  assert.ok(create, "release must publish via softprops/action-gh-release");

  assert.equal(create.with?.fail_on_unmatched_files, true, "a missing file must fail the release");

  const files = lines(create.with?.files);
  assert.equal(files.length, 4, "exactly four files may be published");
  assert.deepEqual(files, EXPECTED_FILES.map((file) => `release/${file}`));
  assert.deepEqual(
    [...files].sort(),
    [...EXPECTED_FILES].sort().map((file) => `release/${file}`),
    "no duplicates",
  );

  for (const file of files) {
    assert.doesNotMatch(file, /[*?[\]]/, `published paths must be exact names, not globs: ${file}`);
  }
});

test("a cleanup step strips anything that is not one of the four files", () => {
  const cleanup = steps(workflow.jobs.release).find(
    (step) => typeof step.run === "string" && step.run.includes("expected="),
  );
  assert.ok(cleanup, "release must drop stray artifacts before publishing");

  const run = String(cleanup.run);
  const expectedLine = run.split("\n").find((line) => /^\s*expected=/.test(line));
  assert.ok(expectedLine, "cleanup must declare an explicit allow-list");

  const listed = expectedLine!
    .replace(/^\s*expected="/, "")
    .replace(/"\s*$/, "")
    .trim()
    .split(/\s+/)
    .filter((name) => name !== "");

  assert.equal(listed.length, 4, "the allow-list must name exactly four files");
  assert.deepEqual([...listed].sort(), [...EXPECTED_FILES].sort());

  // The allow-list is only meaningful if strays are actually removed and
  // missing files actually fail the job.
  assert.match(run, /rm -rf/, "stray files must be deleted, not just reported");
  assert.match(run, /missing expected asset/, "a missing file must fail the job");
});

test("the asset names agree with APP_VERSION and tauri.conf.json", () => {
  assert.equal(workflow.env?.APP_VERSION, "0.0.1", "workflow APP_VERSION");

  const confPath = join(dirname(resolveWorkflowPath()), "..", "..", "src-tauri", "tauri.conf.json");
  const conf = JSON.parse(readFileSync(confPath, "utf8")) as { version?: string };

  assert.equal(conf.version, workflow.env.APP_VERSION, "tauri.conf.json must match APP_VERSION");
  for (const file of EXPECTED_FILES) {
    assert.ok(
      file.includes(workflow.env.APP_VERSION as string),
      `${file} must carry the release version ${workflow.env.APP_VERSION}`,
    );
  }
});

test("the publisher may write release contents", () => {
  assert.equal(workflow.permissions?.contents, "write");
  assert.match(source, /fail_on_unmatched_files:\s*true/);
});
