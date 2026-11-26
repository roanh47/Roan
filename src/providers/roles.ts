/**
 * Which model runs which part of a turn.
 *
 * One model for everything is the default, and for most people it stays that
 * way: unset means inherit, and inheritance is the model in `model`. But the
 * parts of a turn are not equally hard. Planning a session and running it want
 * the best model there is; naming a conversation, summarising it, or answering
 * a `/btw` question wants a cheap one. A person can pin a model per role, and
 * the pins travel with the config because they are part of how the agent
 * behaves, not of the machine it runs on.
 *
 * Resolution is one function, pure and total: it never throws, it never
 * guesses, and a role it has never heard of inherits instead of inventing a
 * pin. An empty or blank pin is not a pin — it inherits, so clearing a field in
 * the app cannot leave a role with no model at all.
 */

/** The parts of a turn a model can be picked for. */
export const ROLES = ["planner", "executor", "side"] as const;

export type Role = (typeof ROLES)[number];

/** True for the three known roles; anything else (a typo, a key) inherits. */
export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/**
 * The model configuration a role resolves against.
 *
 * This is a view of the settings, not the settings file: the caller maps its
 * own config onto these fields so a pin can be added to the app without this
 * module and the disk format learning about each other.
 */
export interface RoleModels {
  /** The model every role inherits when it has no pin of its own. */
  readonly model?: string;
  /** Pins per role. A missing, empty or non-string pin inherits `model`. */
  readonly roles?: Readonly<Partial<Record<Role, string>>>;
  /**
   * The cheap model for titles, summaries and side questions — the default for
   * the `side` role. An explicit `roles.side` pin beats it.
   */
  readonly sideModel?: string;
}

/** A model id worth handing to an adapter, or `null`. */
function usable(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * The model for `role`, or `null` when the config names none.
 *
 * `null` means "the caller has nothing better than its own default"; it is not
 * an error and not a model id. Precedence, highest first:
 *
 *   1. a pin for this role (`roles[role]`);
 *   2. for `side`, the cheap `sideModel`;
 *   3. the inherited `model`.
 *
 * Unknown roles skip 1 and 2 and inherit. The lookup is an own-property check,
 * so a role called `constructor` or `__proto__` inherits rather than picking up
 * something off `Object.prototype`.
 */
export function roleModel(role: string, config: RoleModels = {}): string | null {
  const wanted = role.trim();
  const inherited = usable(config.model);

  if (!isRole(wanted)) return inherited;

  const pins = config.roles;
  if (pins !== undefined && Object.hasOwn(pins, wanted)) {
    const pinned = usable(pins[wanted]);
    if (pinned !== null) return pinned;
  }

  if (wanted === "side") {
    const cheap = usable(config.sideModel);
    if (cheap !== null) return cheap;
  }

  return inherited;
}

/** `roleModel`, with a model to fall back on when the config names none. */
export function roleModelOr(role: string, config: RoleModels, fallback: string): string {
  return roleModel(role, config) ?? fallback;
}
