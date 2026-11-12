/**
 * The app store: one state object, pure reducers, and a subscribe function.
 *
 * This file owns what the interface knows, not how it learns it. There is no
 * React and no socket here; the shell reads frames (see `chain.ts`) and calls
 * `dispatch`, and a React component reads it back with `useSyncExternalStore`
 * through `subscribe` and `getState`.
 *
 * The events slice follows the chain's rules: one event per `seq`, first copy
 * wins, and an event with `seq: 0` is a local not-yet-committed message, so it
 * never enters the store. A second event claiming an occupied seq is dropped
 * rather than allowed to overwrite the one already on that position.
 */
import type { ChainEvent, ConnectionStatus } from "./chain";

export interface ConnectionState {
  readonly status: ConnectionStatus;
  /** The daemon that last answered; null before the first hello. */
  readonly peer: string | null;
}

export type OnboardingStep = "checking" | "choose" | "creating" | "joining" | "ready";

export interface OnboardingState {
  readonly step: OnboardingStep;
  /** A create or join request is in flight. */
  readonly busy: boolean;
}

export interface ChainState {
  readonly id: string | null;
  /** Highest seq held; 0 for an empty or absent chain. */
  readonly head: number;
}

export interface NodeState {
  /** This device's name, as sent in every event. */
  readonly name: string;
}

export interface SettingsState {
  readonly provider: string;
  readonly model: string;
  readonly baseUrl: string;
  readonly workspace: string;
  readonly saving: boolean;
}

export interface AppState {
  readonly connection: ConnectionState;
  readonly onboarding: OnboardingState;
  readonly chain: ChainState;
  readonly node: NodeState;
  readonly events: readonly ChainEvent[];
  readonly settings: SettingsState;
  readonly error: string | null;
}

/** What a save may change; `saving` is owned by the save itself. */
export type SettingsPatch = Partial<Omit<SettingsState, "saving">>;

export type Action =
  | { type: "connection/status"; status: ConnectionStatus; peer?: string | null }
  | { type: "onboarding/check" }
  | { type: "onboarding/request"; choice: "create" | "join" }
  | { type: "onboarding/failed" }
  | { type: "onboarding/ready" }
  | { type: "chain/set"; id: string | null }
  | { type: "node/set"; name: string }
  | { type: "events/merge"; events: readonly ChainEvent[] }
  | { type: "events/replace"; events: readonly ChainEvent[] }
  | { type: "events/clear" }
  | { type: "settings/patch"; patch: SettingsPatch }
  | { type: "settings/saving"; saving: boolean }
  | { type: "error/set"; message: string }
  | { type: "error/clear" };

export function reduceConnection(state: ConnectionState, action: Action): ConnectionState {
  if (action.type !== "connection/status") return state;
  const peer =
    action.peer !== undefined
      ? action.peer
      : action.status === "idle" || action.status === "closed"
        ? null
        : state.peer;
  if (peer === state.peer && action.status === state.status) return state;
  return { status: action.status, peer };
}

export function reduceOnboarding(state: OnboardingState, action: Action): OnboardingState {
  switch (action.type) {
    case "onboarding/check":
      return state.step === "checking" && !state.busy ? state : { step: "checking", busy: false };
    case "onboarding/request":
      return { step: action.choice === "create" ? "creating" : "joining", busy: true };
    case "onboarding/failed":
      return state.step === "choose" && !state.busy ? state : { step: "choose", busy: false };
    case "onboarding/ready":
      return state.step === "ready" && !state.busy ? state : { step: "ready", busy: false };
    default:
      return state;
  }
}

export function reduceChain(state: ChainState, action: Action): ChainState {
  if (action.type !== "chain/set" || action.id === state.id) return state;
  return { id: action.id, head: 0 };
}

export function reduceNode(state: NodeState, action: Action): NodeState {
  if (action.type !== "node/set" || action.name === state.name) return state;
  return { name: action.name };
}

export function reduceError(state: string | null, action: Action): string | null {
  if (action.type === "error/set") return action.message === state ? state : action.message;
  if (action.type === "error/clear") return state === null ? state : null;
  return state;
}

function sameSettings(a: SettingsState, b: SettingsState): boolean {
  return (
    a.provider === b.provider &&
    a.model === b.model &&
    a.baseUrl === b.baseUrl &&
    a.workspace === b.workspace &&
    a.saving === b.saving
  );
}

export function reduceSettings(state: SettingsState, action: Action): SettingsState {
  switch (action.type) {
    case "settings/patch": {
      const next: SettingsState = { ...state, ...action.patch };
      return sameSettings(next, state) ? state : next;
    }
    case "settings/saving":
      return action.saving === state.saving ? state : { ...state, saving: action.saving };
    default:
      return state;
  }
}

function compareEvents(a: ChainEvent, b: ChainEvent): number {
  if (a.seq !== b.seq) return a.seq - b.seq;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/** An event can only take a place in a chain if it has a real position and identity. */
function usable(event: ChainEvent): boolean {
  return Number.isFinite(event.seq) && event.seq > 0 && event.chain.length > 0 && event.id.length > 0;
}

/**
 * Sorts by seq and keeps the first event for each seq and each id. The first
 * copy wins because the position is already spoken for; nothing overwrites it.
 */
export function dedupeBySeq(events: readonly ChainEvent[]): readonly ChainEvent[] {
  const ids = new Set<string>();
  const seqs = new Set<number>();
  const kept: ChainEvent[] = [];
  for (const event of events) {
    if (!usable(event)) continue;
    if (ids.has(event.id) || seqs.has(event.seq)) continue;
    ids.add(event.id);
    seqs.add(event.seq);
    kept.push(event);
  }
  return kept.sort(compareEvents);
}

/**
 * Adds the events we do not hold yet. Events from another chain are ignored:
 * joining a chain adopts its transcript, it never mixes two of them.
 */
export function mergeEvents(
  current: readonly ChainEvent[],
  incoming: readonly ChainEvent[],
  chain: string | null,
): readonly ChainEvent[] {
  if (incoming.length === 0) return current;
  const ids = new Set(current.map((event) => event.id));
  const seqs = new Set(current.map((event) => event.seq));
  const fresh: ChainEvent[] = [];
  for (const event of incoming) {
    if (!usable(event)) continue;
    if (chain !== null && event.chain !== chain) continue;
    if (ids.has(event.id) || seqs.has(event.seq)) continue;
    ids.add(event.id);
    seqs.add(event.seq);
    fresh.push(event);
  }
  if (fresh.length === 0) return current;
  return [...current, ...fresh].sort(compareEvents);
}

/** A whole transcript: scoped to the chain, then deduped and sorted. */
export function replaceEvents(
  incoming: readonly ChainEvent[],
  chain: string | null,
): readonly ChainEvent[] {
  const scoped = chain === null ? incoming : incoming.filter((event) => event.chain === chain);
  return dedupeBySeq(scoped);
}

export function reduceEvents(
  events: readonly ChainEvent[],
  chain: string | null,
  action: Action,
): readonly ChainEvent[] {
  if (action.type === "events/merge") return mergeEvents(events, action.events, chain);
  if (action.type === "events/replace") return replaceEvents(action.events, chain);
  if (action.type === "events/clear") return events.length === 0 ? events : [];
  return events;
}

/** The chain an event list belongs to, if it says. Used before hello has landed. */
function chainOf(events: readonly ChainEvent[]): string | null {
  for (const event of events) {
    if (usable(event)) return event.chain;
  }
  return null;
}

function headOf(events: readonly ChainEvent[]): number {
  return events[events.length - 1]?.seq ?? 0;
}

export function reduce(state: AppState, action: Action): AppState {
  const connection = reduceConnection(state.connection, action);
  const onboarding = reduceOnboarding(state.onboarding, action);
  const node = reduceNode(state.node, action);
  const settings = reduceSettings(state.settings, action);
  const error = reduceError(state.error, action);

  let chain = reduceChain(state.chain, action);
  let events = action.type === "chain/set" && action.id !== state.chain.id ? [] : state.events;

  if (action.type === "events/merge" || action.type === "events/replace") {
    // The first event can name the chain when hello has not arrived yet.
    const id = chain.id ?? chainOf(action.events);
    if (id !== null) {
      if (chain.id !== id) chain = { id, head: 0 };
      events = reduceEvents(events, id, action);
      const head = headOf(events);
      if (head !== chain.head) chain = { ...chain, head };
    }
  } else if (action.type === "events/clear") {
    events = reduceEvents(events, chain.id, action);
    if (chain.head !== 0) chain = { ...chain, head: 0 };
  }

  // A chain is now known, so onboarding is over whatever step it was on.
  const settled =
    chain.id !== null && onboarding.step !== "ready"
      ? { step: "ready" as const, busy: false }
      : onboarding;

  if (
    connection === state.connection &&
    settled === state.onboarding &&
    chain === state.chain &&
    node === state.node &&
    events === state.events &&
    settings === state.settings &&
    error === state.error
  ) {
    return state;
  }

  return { connection, onboarding: settled, chain, node, events, settings, error };
}

export interface StateInit {
  readonly node?: string;
  readonly chain?: string | null;
  readonly settings?: SettingsPatch;
  readonly onboarding?: Partial<OnboardingState>;
  readonly connection?: Partial<ConnectionState>;
}

export const INITIAL_STATE: AppState = Object.freeze({
  connection: Object.freeze({ status: "idle" as const, peer: null }),
  onboarding: Object.freeze({ step: "checking" as const, busy: false }),
  chain: Object.freeze({ id: null, head: 0 }),
  node: Object.freeze({ name: "" }),
  events: Object.freeze([]) as readonly ChainEvent[],
  settings: Object.freeze({
    provider: "lmstudio",
    model: "local-model",
    baseUrl: "http://127.0.0.1:1234/v1",
    workspace: "",
    saving: false,
  }),
  error: null,
});

/** A fresh store state; `init` is what the shell knows before the first frame. */
export function initialState(init: StateInit = {}): AppState {
  return {
    connection: { ...INITIAL_STATE.connection, ...init.connection },
    onboarding: { ...INITIAL_STATE.onboarding, ...init.onboarding },
    chain: { id: init.chain ?? null, head: 0 },
    node: { name: init.node ?? INITIAL_STATE.node.name },
    events: [],
    settings: { ...INITIAL_STATE.settings, ...init.settings, saving: false },
    error: null,
  };
}

export interface Store {
  readonly getState: () => AppState;
  readonly subscribe: (listener: () => void) => () => void;
  readonly dispatch: (action: Action) => void;
}

/**
 * One store, many readers. `getState` returns the same object until something
 * actually changes, which is what `useSyncExternalStore` requires; a dispatch
 * that changes nothing notifies nobody.
 */
export function createStore(initial?: AppState): Store {
  let state = initial ?? initialState();
  const listeners = new Set<() => void>();

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispatch: (action) => {
      const next = reduce(state, action);
      if (next === state) return;
      state = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

/** The store the app renders from. The shell dispatches into it. */
export const appStore: Store = createStore();
