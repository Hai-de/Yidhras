import type { ContributionDescriptor } from '../../src/plugins/worker/contribution_descriptors.js';
import type { PluginWorkerRuntimeSnapshot } from '../../src/plugins/worker/PluginWorkerClient.js';

export interface FakePluginWorkerClientCallLog {
  deactivates: string[];
  terminates: string[];
}

export const createFakeWorkerCallLog = (): FakePluginWorkerClientCallLog => ({
  deactivates: [],
  terminates: []
});

export class FakePluginWorkerClient {
  public static nextSnapshot: PluginWorkerRuntimeSnapshot = {
    descriptors: [],
    loadedServer: true,
    threadId: 1
  };

  public static nextActivateError: Error | null = null;

  /** Globally track deactivate/terminate across all instances. */
  public static calls: FakePluginWorkerClientCallLog = {
    deactivates: [],
    terminates: []
  };

  public readonly installationId: string;
  private readonly log: FakePluginWorkerClientCallLog;
  private _alive = true;

  constructor(input: { installationId: string; log?: FakePluginWorkerClientCallLog }) {
    this.installationId = input.installationId;
    this.log = input.log ?? FakePluginWorkerClient.calls;
  }

  async activate(): Promise<PluginWorkerRuntimeSnapshot> {
    if (FakePluginWorkerClient.nextActivateError) {
      throw FakePluginWorkerClient.nextActivateError;
    }
    return FakePluginWorkerClient.nextSnapshot;
  }

  async invoke(
    _contributionType: string,
    _invoke: string,
    _payload: unknown,
    _options?: { timeoutMs?: number }
  ): Promise<unknown> {
    return {};
  }

  async deactivate(): Promise<void> {
    this.log.deactivates.push(this.installationId);
  }

  async terminate(reason: string): Promise<void> {
    this._alive = false;
    this.log.terminates.push(`${this.installationId}:${reason}`);
  }

  isAlive(): boolean {
    return this._alive;
  }

  triggerCrash(error: Error): void {
    this._alive = false;
  }
}

export const resetFakeWorkerClientState = (): void => {
  FakePluginWorkerClient.nextSnapshot = {
    descriptors: [],
    loadedServer: true,
    threadId: 1
  };
  FakePluginWorkerClient.nextActivateError = null;
  FakePluginWorkerClient.calls.deactivates.length = 0;
  FakePluginWorkerClient.calls.terminates.length = 0;
};
