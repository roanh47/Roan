import assert from "node:assert/strict";

/** Renders a list for an assertion message, quoting each member. */
function formatList(values: readonly string[]): string {
  return `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;
}

/**
 * Passes when both lists hold the same members, ignoring order and
 * duplication. On failure the message names the missing and extra members.
 */
export function assertSameSet(
  actual: readonly string[],
  expected: readonly string[],
): void {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const missing = [...expectedSet]
    .filter((value) => !actualSet.has(value))
    .sort();
  const extra = [...actualSet]
    .filter((value) => !expectedSet.has(value))
    .sort();

  if (missing.length === 0 && extra.length === 0) {
    return;
  }

  const differences: string[] = [];
  if (missing.length > 0) {
    differences.push(`missing: ${formatList(missing)}`);
  }
  if (extra.length > 0) {
    differences.push(`extra: ${formatList(extra)}`);
  }

  assert.fail(
    `sets differ — ${differences.join("; ")}\n` +
      `  actual:   ${formatList([...actualSet].sort())}\n` +
      `  expected: ${formatList([...expectedSet].sort())}`,
  );
}

/**
 * Passes when the list is in ascending code-unit order. On failure the
 * message names the first pair that is out of order.
 */
export function assertSortedStrings(values: readonly string[]): void {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values.at(index - 1);
    const current = values.at(index);
    if (previous === undefined || current === undefined) {
      continue;
    }
    if (previous > current) {
      assert.fail(
        `values are not sorted: index ${String(index - 1)} ` +
          `${JSON.stringify(previous)} comes before index ${String(index)} ` +
          `${JSON.stringify(current)}\n` +
          `  values: ${formatList(values)}`,
      );
    }
  }
}

/**
 * Runs `fn` and requires it to throw an `Error` whose message contains
 * `needle`. Returns that error so the caller can assert further.
 */
export function assertErrorMentions(
  fn: () => unknown,
  needle: string,
): Error {
  let didThrow = false;
  let thrown: unknown = undefined;
  try {
    fn();
  } catch (error: unknown) {
    didThrow = true;
    thrown = error;
  }

  if (!didThrow) {
    assert.fail(
      `expected the function to throw an error mentioning ` +
        `${JSON.stringify(needle)}, but it returned normally`,
    );
  }

  if (!(thrown instanceof Error)) {
    assert.fail(
      `expected the function to throw an Error mentioning ` +
        `${JSON.stringify(needle)}, but it threw a non-Error value: ` +
        String(thrown),
    );
  }

  assert.ok(
    thrown.message.includes(needle),
    `expected the error message to mention ${JSON.stringify(needle)}, ` +
      `but got ${JSON.stringify(thrown.message)}`,
  );

  return thrown;
}
