import type { SchedulerDecisionKernelPort } from './scheduler_decision_kernel_port.js';
import type { SchedulerDecisionSidecarClientOptions } from './sidecar/scheduler_decision_sidecar_client.js';
import { createSchedulerDecisionSidecarClient, SchedulerDecisionSidecarClient } from './sidecar/scheduler_decision_sidecar_client.js';

export interface SidecarHandle {
  client: SchedulerDecisionKernelPort;
  packId: string;
}

interface QueuedRequest {
  packId: string;
  options: SchedulerDecisionSidecarClientOptions;
  resolve(handle: SidecarHandle): void;
  reject(error: unknown): void;
}

export class SchedulerSidecarPool {
  private readonly active = new Map<string, SchedulerDecisionSidecarClient>();
  private readonly queue: QueuedRequest[] = [];

  constructor(private readonly maxProcesses: number) {}

  public async acquire(
    packId: string,
    options: SchedulerDecisionSidecarClientOptions
  ): Promise<SidecarHandle> {
    const existing = this.active.get(packId);
    if (existing) {
      return { client: existing, packId };
    }

    if (this.active.size < this.maxProcesses) {
      const client = createSchedulerDecisionSidecarClient({
        ...options,
        packId
      });
      await client.start();
      this.active.set(packId, client);
      return { client, packId };
    }

    return new Promise<SidecarHandle>((resolve, reject) => {
      this.queue.push({ packId, options, resolve, reject });
    });
  }

  public async release(packId: string): Promise<void> {
    const client = this.active.get(packId);
    if (!client) {
      return;
    }

    await client.stop();
    this.active.delete(packId);

    this.processQueue();
  }

  public async shutdown(): Promise<void> {
    const clients = Array.from(this.active.values());
    this.active.clear();

    for (const request of this.queue) {
      request.reject(new Error('SchedulerSidecarPool is shutting down'));
    }
    this.queue.length = 0;

    await Promise.all(clients.map(client => client.stop()));
  }

  public activeCount(): number {
    return this.active.size;
  }

  public queuedCount(): number {
    return this.queue.length;
  }

  private processQueue(): void {
    while (this.queue.length > 0 && this.active.size < this.maxProcesses) {
      const next = this.queue.shift();
      if (!next) {
        break;
      }

      const client = createSchedulerDecisionSidecarClient({
        ...next.options,
        packId: next.packId
      });

      client
        .start()
        .then(() => {
          this.active.set(next.packId, client);
          next.resolve({ client, packId: next.packId });
        })
        .catch(error => {
          next.reject(error);
          this.processQueue();
        });
    }
  }
}
