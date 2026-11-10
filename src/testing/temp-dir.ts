import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Throwaway directories for tests.
 *
 * A test that writes files has to clean up after itself even when an assertion
 * fires, so the directory handling lives here instead of being copied into
 * every test. `withTempDir` wraps the callback in a try/catch rather than a
 * `finally`, so a failing cleanup can never hide the error the test was really
 * about: the callback's error always wins.
 */

/** Prefix used by {@link withTempDir} when the caller does not name one. */
const DEFAULT_PREFIX = "roan-temp-";

/** Absolute, real tmpdir; resolved once so every dir shares one parent. */
const BASE_DIR = path.resolve(os.tmpdir());

function describePrefix(prefix: string): string {
  return JSON.stringify(prefix);
}

/**
 * Creates a fresh directory under `os.tmpdir()` whose name starts with
 * `prefix`, and returns its absolute path.
 *
 * `fs.mkdtemp` appends six random characters, so two calls with the same
 * prefix never collide. The prefix itself is checked rather than trusted: an
 * empty prefix hides the test that created the directory, and a separator
 * would let the call escape the tmpdir, so both are rejected with an error
 * that names the offending input.
 */
export async function makeTempDir(prefix: string): Promise<string> {
  if (typeof prefix !== "string") {
    throw new Error(
      `makeTempDir: prefix must be a string, got ${typeof prefix}`,
    );
  }
  if (prefix.length === 0) {
    throw new Error("makeTempDir: prefix must not be empty");
  }
  if (prefix.includes("/") || prefix.includes("\\") || prefix.includes(path.sep)) {
    throw new Error(
      `makeTempDir: prefix must not contain a path separator, got ${describePrefix(prefix)}`,
    );
  }

  return fs.mkdtemp(path.join(BASE_DIR, prefix));
}

/**
 * Removes `dirPath` and everything inside it.
 *
 * A path that is already gone is not an error: cleanup runs on the way out of a
 * test, where the directory may never have been created, may already have been
 * removed by the test itself, or may have been reaped by the OS. Any other
 * failure (permissions, a file in use) is still reported, because silently
 * ignoring it would leave debris behind.
 */
export async function removeTempDir(dirPath: string): Promise<void> {
  try {
    await fs.rm(dirPath, { recursive: true, force: true, maxRetries: 3 });
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return;
    throw cause;
  }
}

/**
 * Runs `fn` in a fresh temp directory and returns whatever `fn` returns.
 *
 * The directory is removed afterwards, whether `fn` resolves or throws. The
 * value is passed through untouched, so callers get the generic type back
 * instead of `void`; the error is rethrown only after cleanup finished, which
 * is what makes "de map is weg" assertable from a `catch`.
 *
 * A cleanup failure is swallowed here on purpose: the callback already failed,
 * and replacing its error with an `EBUSY` from `rm` would point the test at the
 * wrong problem.
 */
export async function withTempDir<T>(
  fn: (dir: string) => Promise<T> | T,
  prefix: string = DEFAULT_PREFIX,
): Promise<T> {
  if (typeof fn !== "function") {
    throw new Error(`withTempDir: fn must be a function, got ${typeof fn}`);
  }

  const dir = await makeTempDir(prefix);

  let value: T;
  try {
    value = await fn(dir);
  } catch (cause) {
    await removeTempDir(dir).catch(() => undefined);
    throw cause;
  }

  await removeTempDir(dir);
  return value;
}
