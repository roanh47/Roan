import { randomUUID } from "node:crypto";
import type { EventStore } from "../chain/store.js";
import type { Event } from "../protocol/types.js";
import type { Tool, ToolContext } from "../types.js";
import { describeNodes, findNode, type NodeInfo } from "../chain/nodes.js";
import { probe } from "./discovery.js";

/**
 * Doing something on another machine — without turning the agent into a remote.
 *
 * Every device still runs its own turns against its own copy of the chain. This
 * adds one narrow thing: a turn on this machine may ask another node in the
 * chain to run one tool, and wait for the answer. The request and the answer
 * are chain events, so they survive a disconnect: if the other machine is off,
 * the request is simply still there when it comes back.
 *
 * Only tools on the allow list can travel. `run_shell` is on it because that is
 * the point — but it means the machine that executes is trusting the chain, and
 * the chain is only as closed as its peers.
 */
export const DELEGABLE_TOOLS: ReadonlySet<string> = new Set([
  "read_file",
  "write_file",
  "list_dir",
  "run_shell",
  "stat",
  "hash",
]);

export interface DelegationRequest {
  readonly requestId: string;
  readonly from: string;
  readonly target: string;
  readonly tool: string;
  readonly args: Record<string, unknown>;
}

function isDelegation(data: unknown): DelegationRequest | null {
  if (typeof data !== "object" || data === null) return null;
  const value = data as Record<string, unknown>;
  if (value["delegated"] !== true) return null;
  const requestId = value["requestId"];
  const target = value["target"];
  const tool = value["tool"];
  const from = value["from"];
  const args = value["args"];
  if (typeof requestId !== "string" || typeof target !== "string") return null;
  if (typeof tool !== "string" || typeof from !== "string") return null;
  if (typeof args !== "object" || args === null) return null;
  return { requestId, from, target, tool, args: args as Record<string, unknown> };
}

/** A request this node should carry out: it names us and is not our own. */
export function delegationFor(event: Event, node: string): DelegationRequest | null {
  if (event.type !== "tool_call") return null;
  const request = isDelegation(event.data);
  if (request === null) return null;
  if (request.target !== node || request.from === node) return null;
  return request;
}

export interface RelayOptions {
  readonly store: EventStore;
  readonly chain: string;
  readonly node: string;
  readonly tools: readonly Tool[];
  readonly cwd: string;
  readonly timeoutMs?: number;
  readonly log?: (message: string) => void;
}

/** Runs a request that came from another node and answers in the chain. */
export async function serveDelegation(
  options: RelayOptions,
  event: Event,
): Promise<boolean> {
  const request = delegationFor(event, options.node);
  if (request === null) return false;
  const log = options.log ?? (() => undefined);

  const tool = options.tools.find((candidate) => candidate.name === request.tool);
  if (tool === undefined || !DELEGABLE_TOOLS.has(request.tool)) {
    log(`relay: refused ${request.tool} from ${request.from}`);
    appendResult(options, request, false, `tool "${request.tool}" is not delegable`);
    return true;
  }

  const context: ToolContext = { cwd: options.cwd };
  try {
    const output = await tool.run(request.args, context);
    appendResult(options, request, true, output);
    log(`relay: ran ${request.tool} for ${request.from}`);
  } catch (error) {
    appendResult(options, request, false, error instanceof Error ? error.message : String(error));
    log(`relay: ${request.tool} failed for ${request.from}`);
  }
  return true;
}

function appendResult(
  options: RelayOptions,
  request: DelegationRequest,
  ok: boolean,
  output: string,
): void {
  options.store.append(options.chain, {
    id: randomUUID(),
    node: options.node,
    type: "tool_result",
    data: {
      delegated: true,
      requestId: request.requestId,
      from: request.from,
      target: request.target,
      tool: request.tool,
      ok,
      output,
    },
  });
}

/**
 * Asks another node to run one tool and waits for its answer.
 *
 * Polling the local store rather than holding a socket open is deliberate: the
 * answer may arrive on a different connection than the one that exists now, and
 * a chain that already keeps every event makes a second delivery path pointless.
 */
export async function callNode(
  options: RelayOptions,
  target: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<string> {
  if (target === options.node) throw new Error("that is this machine; call the tool directly");
  if (!DELEGABLE_TOOLS.has(tool)) {
    throw new Error(
      `"${tool}" cannot be run on another machine; allowed: ${[...DELEGABLE_TOOLS].join(", ")}`,
    );
  }

  const requestId = randomUUID();
  options.store.append(options.chain, {
    id: randomUUID(),
    node: options.node,
    type: "tool_call",
    data: { delegated: true, requestId, from: options.node, target, tool, args },
  });

  const deadline = Date.now() + (options.timeoutMs ?? 120_000);
  const head = options.store.head(options.chain);
  let scanned = Math.max(1, head);

  while (Date.now() < deadline) {
    await sleep(250);
    const now = options.store.head(options.chain);
    if (now < scanned) continue;
    const batch = options.store.read(options.chain, scanned + 1, Math.min(now - scanned, 200));
    scanned = now;
    for (const event of batch) {
      if (event.type !== "tool_result") continue;
      const data = event.data as Record<string, unknown> | null;
      if (data === null || data["requestId"] !== requestId) continue;
      const ok = data["ok"] === true;
      const output = typeof data["output"] === "string" ? data["output"] : "";
      if (!ok) throw new Error(`${target} could not run ${tool}: ${output}`);
      return output;
    }
  }
  throw new Error(`${target} did not answer ${tool} within the wait; the request is still in the chain`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The tool the agent calls. One entry point, with the node named explicitly. */
export function createRunOnNodeTool(options: RelayOptions, nodes: () => readonly NodeInfo[]): Tool {
  return {
    name: "run_on_node",
    description:
      "Run one tool on another machine in this chain (run_shell, read_file, write_file, list_dir). " +
      "Use it when the work belongs on that machine, not on this one. " +
      "Name the machine the way a person would, for example Roans-Server; the address is looked up in " +
      "the chain and probed before anything is sent.",
    parameters: {
      type: "object",
      properties: {
        node: { type: "string", description: "Which machine: its name, its address, or its node id" },
        tool: { type: "string", description: "Tool to run there" },
        args: { type: "object", description: "Arguments for that tool" },
      },
      required: ["node", "tool"],
    },
    async run(args) {
      const wanted = String(args["node"] ?? "");
      const tool = String(args["tool"] ?? "");
      const inner = typeof args["args"] === "object" && args["args"] !== null ? (args["args"] as Record<string, unknown>) : {};
      const known = nodes();
      if (wanted.length === 0) throw new Error(`node is required; in this chain: ${describeNodes(known)}`);
      const target = findNode(known, wanted);
      if (target === null) {
        throw new Error(`no machine called "${wanted}" in this chain; known: ${describeNodes(known)}`);
      }
      if (target.node === options.node) throw new Error(`${target.name} is this machine; call the tool directly`);
      if (target.host.length === 0) {
        throw new Error(`${target.name} has not announced an address, so it cannot be reached from here`);
      }
      // Ask the address before writing anything into the chain: an offline
      // machine would otherwise leave the turn waiting for minutes.
      if (!(await probe(target.host, target.port))) {
        throw new Error(
          `${target.name} is not reachable at ${target.host}:${String(target.port)} — is it on and is Tailscale up?`,
        );
      }
      return callNode(options, target.node, tool, inner);
    },
  };
}
