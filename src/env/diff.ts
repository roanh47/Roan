/**
 * Comparing a node's local env values with the chain's, before a join.
 *
 * Joining adopts the chain (AGENTS.md rule 9): where the chain has a value, the
 * chain's value wins. Local keys the chain does not have are parked aside and
 * never pushed up. Only key names leave this function — values are compared,
 * never reported, so a secret that slipped into a record cannot end up in a log
 * line or an error message.
 */

/** Local or chain values: a `Map`, or a plain object keyed by name. */
export type EnvValues = ReadonlyMap<string, string> | Record<string, string>;

export interface EnvDiffResult {
  /** Chain keys local lacks or holds a different value for; the chain wins, sorted. */
  adopted: string[];
  /** Local-only keys, parked aside and not pushed up, sorted. */
  dropped: string[];
  /** Keys both sides hold with the identical value, sorted. */
  unchanged: string[];
}

function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return typeof value;
}

/**
 * Read the values into a map, rejecting anything that is not a string-keyed,
 * string-valued collection. Messages name the argument and the offending key,
 * never a value.
 */
function entriesOf(input: unknown, name: string): Map<string, string> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`diffEnv: ${name} must be a Map or a plain object, got ${describeType(input)}`);
  }

  const entries = new Map<string, string>();
  if (input instanceof Map) {
    for (const [key, value] of input as ReadonlyMap<unknown, unknown>) {
      if (typeof key !== "string") {
        throw new Error(`diffEnv: ${name} has a non-string key`);
      }
      if (typeof value !== "string") {
        throw new Error(`diffEnv: ${name} has a non-string value for key "${key}"`);
      }
      entries.set(key, value);
    }
    return entries;
  }

  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (typeof value !== "string") {
      throw new Error(`diffEnv: ${name} has a non-string value for key "${key}"`);
    }
    entries.set(key, value);
  }
  return entries;
}

/** Sorted copy; the insertion order of either side never leaks into the result. */
function sorted(values: string[]): string[] {
  return values.sort();
}

/**
 * Compare local env values with the chain's for a join.
 *
 * `adopted` is what the join takes from the chain, `dropped` is what stays
 * behind on this machine, `unchanged` is what both sides already agree on.
 */
export function diffEnv(local: EnvValues, chain: EnvValues): EnvDiffResult {
  const localEntries = entriesOf(local, "local");
  const chainEntries = entriesOf(chain, "chain");

  const adopted: string[] = [];
  const unchanged: string[] = [];
  for (const [key, chainValue] of chainEntries) {
    const localValue = localEntries.get(key);
    if (localValue === undefined || localValue !== chainValue) {
      adopted.push(key);
    } else {
      unchanged.push(key);
    }
  }

  const dropped: string[] = [];
  for (const key of localEntries.keys()) {
    if (!chainEntries.has(key)) dropped.push(key);
  }

  return { adopted: sorted(adopted), dropped: sorted(dropped), unchanged: sorted(unchanged) };
}
