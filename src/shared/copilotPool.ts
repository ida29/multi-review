import { CopilotClient } from '@github/copilot-sdk';

/**
 * Pool of CopilotClient instances, one per model.
 * Clients are started once and reused across multiple file reviews.
 * This limits the number of concurrent CLI server processes.
 */
export class CopilotClientPool {
  private readonly clients = new Map<string, CopilotClient>();
  private started = false;

  constructor(private readonly models: readonly string[]) {}

  /**
   * Start all clients in parallel.
   * Must be called before getClient().
   */
  async start(): Promise<void> {
    if (this.started) return;

    const entries = await Promise.all(
      this.models.map(async (model) => {
        const client = new CopilotClient();
        await client.start();
        return [model, client] as const;
      }),
    );

    for (const [model, client] of entries) {
      this.clients.set(model, client);
    }

    this.started = true;
  }

  /**
   * Get the client for a specific model.
   * Throws if pool not started or model not found.
   */
  getClient(model: string): CopilotClient {
    if (!this.started) {
      throw new Error('CopilotClientPool not started. Call start() first.');
    }
    const client = this.clients.get(model);
    if (!client) {
      throw new Error(`No client found for model: ${model}`);
    }
    return client;
  }

  /**
   * Stop all clients gracefully.
   */
  async stop(): Promise<void> {
    await Promise.all(Array.from(this.clients.values()).map((c) => c.stop().catch(() => {})));
    this.clients.clear();
    this.started = false;
  }

  /** Number of active clients */
  get size(): number {
    return this.clients.size;
  }
}
