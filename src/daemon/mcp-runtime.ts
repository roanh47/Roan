import type { McpServerConfig } from "../chain/gates.js";
import { connectMcpServer, type McpConnection } from "../mcp/client.js";
import type { Tool } from "../types.js";

export type McpLog = (line: string) => void;

/**
 * The live MCP fleet: which servers this node can currently reach and the
 * tools they contribute. Config lives in the chain; this is the machinery
 * that dials it. A server that does not answer is skipped, not fatal — the
 * chain stays honest about it and the rest keeps working.
 */
export class McpRuntime {
  private connections = new Map<string, McpConnection>();
  private syncing: Promise<void> = Promise.resolve();
  private lastSynced: readonly McpServerConfig[] = [];
  /** Why the last dial of a server failed, for the screen that shows it. */
  private failures = new Map<string, string>();

  /**
   * `tokenFor` looks up the owner's sign-in for a server on this device. It
   * is asked at every dial, so a token saved a moment ago is used at once.
   */
  constructor(
    private readonly log: McpLog,
    private readonly tokenFor: (id: string) => Promise<string | null> = async () => null,
  ) {}

  /** What the last sync was told to dial; compared per turn. */
  syncedConfigs(): readonly McpServerConfig[] {
    return this.lastSynced;
  }

  /**
   * Dials every enabled server fresh. Config changes are rare and the chain
   * is the source of truth, so a sync rebuilds the fleet instead of diffing
   * it — simpler to reason about, and a dead server never lingers.
   */
  async sync(servers: readonly McpServerConfig[]): Promise<void> {
    const run = async (): Promise<void> => {
      this.lastSynced = servers;
      this.connections.clear();
      this.failures.clear();
      for (const config of servers) {
        if (!config.enabled) continue;
        try {
          const token = await this.tokenFor(config.id).catch(() => null);
          const connection = await connectMcpServer(config, token);
          this.connections.set(config.id, connection);
          this.failures.delete(config.id);
          this.log(`mcp: ${config.label} connected — ${String(connection.tools.length)} tools`);
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          this.failures.set(config.id, reason);
          this.log(`mcp: ${config.label} unreachable — ${reason}`);
        }
      }
    };
    // Serialize syncs: two config changes in a row should not race dials.
    this.syncing = this.syncing.then(run, run);
    await this.syncing;
  }

  /** The tools of every reachable server, in stable order. */
  tools(): Tool[] {
    const all: Tool[] = [];
    for (const connection of this.connections.values()) all.push(...connection.tools);
    return all;
  }

  /** Everything reachable right now, for the per-tool screen. */
  serverLabels(): { id: string; label: string; tools: string[]; live: boolean }[] {
    return [...this.connections.values()].map((connection) => ({
      id: connection.server.id,
      label: connection.server.label,
      live: true,
      tools: connection.tools.map((tool) => tool.name),
    }));
  }

  /** Why a server is not connected, or null when it is, or was never tried. */
  failure(id: string): string | null {
    return this.failures.get(id) ?? null;
  }

  /** How many tools a connected server brought; 0 when it is not connected. */
  toolCount(id: string): number {
    return this.connections.get(id)?.tools.length ?? 0;
  }

  /** True when the fleet matches the configs the chain just showed. */
  matches(configs: readonly McpServerConfig[]): boolean {
    const now = this.lastSynced;
    if (now.length !== configs.length) return false;
    const key = (config: McpServerConfig): string =>
      [config.id, config.transport, config.url ?? "", config.command ?? "", config.enabled ? "1" : "0"].join("|");
    return now.every(
      (config, index) => configs[index] !== undefined && key(config) === key(configs[index] as McpServerConfig),
    );
  }
}


