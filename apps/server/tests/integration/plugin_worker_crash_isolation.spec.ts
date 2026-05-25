import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PACK_ID = 'crash-isolation-pack';
const INSTALLATION_ID = 'installation-crash-test';

const { getWorkerInstances, resetWorkerState, MockWorker } = vi.hoisted(() => {
  let counter = 0;
  const instances: Array<{ on: (e: string, fn: (...args: unknown[]) => void) => void; emit: (e: string, ...args: unknown[]) => boolean; removeAllListeners: () => void }> = [];

  class FakeWorker {
    public readonly threadId: number;
    private listeners = new Map<string, Array<(...args: unknown[]) => void>>();

    constructor(_url: string | URL, _options?: unknown) {
      this.threadId = ++counter;
      instances.push(this);
    }

    on(event: string, fn: (...args: unknown[]) => void) {
      const arr = this.listeners.get(event) ?? [];
      arr.push(fn);
      this.listeners.set(event, arr);
      return this;
    }

    postMessage(_message: unknown) {}

    async terminate() {
      return 0;
    }

    removeAllListeners() {
      this.listeners.clear();
    }

    // Test helpers
    emit(event: string, ...args: unknown[]) {
      const arr = this.listeners.get(event) ?? [];
      for (const fn of arr) {
        fn(...args);
      }
      return true;
    }
  }

  const getWorkerInstances = () => instances;
  const resetWorkerState = () => { counter = 0; instances.length = 0; };

  return { MockWorker: FakeWorker, getWorkerInstances, resetWorkerState };
});

vi.mock('node:worker_threads', () => ({
  Worker: MockWorker,
  parentPort: null
}));

vi.mock('../../src/plugins/worker/worker_entry_resolver.js', () => ({
  resolvePluginWorkerEntry: () => ({ workerUrl: new URL('file:///fake/worker_entry.js') }),
  resolvePluginWorkerEntryUrl: () => new URL('file:///fake/worker_entry.js')
}));

const { PluginWorkerClient } = await import('../../src/plugins/worker/PluginWorkerClient.js');
const { PluginWorkerCrashError } = await import('../../src/plugins/worker/errors.js');

const createClient = (options?: { onCrash?: (error: Error) => void }) =>
  new PluginWorkerClient({
    context: {} as never,
    packId: PACK_ID,
    pluginId: 'plugin.crash.test',
    installationId: INSTALLATION_ID,
    grantedCapabilities: [],
    onCrash: options?.onCrash
  });

describe('plugin Worker crash isolation', () => {
  beforeEach(() => {
    resetWorkerState();
  });

  afterEach(() => {
    for (const worker of getWorkerInstances()) {
      worker.removeAllListeners();
    }
    getWorkerInstances().length = 0;
  });

  it('rejects all pending requests and marks client not alive on worker error crash', async () => {
    const onCrash = vi.fn();
    const client = createClient({ onCrash });

    expect(client.isAlive()).toBe(true);

    const activationPromise = client.activate({
      hostApiVersion: '2.0.0',
      manifest: {} as never,
      installation: {} as never,
      artifactRoot: '/fake',
      entrypointPath: 'file:///fake/plugin.js',
      packId: PACK_ID,
      grantedCapabilities: []
    }).catch((error: unknown) => error);

    const mockWorker = getWorkerInstances().at(-1)!;
    const crashError = new Error('Worker thread crashed');
    mockWorker.emit('error', crashError);

    expect(client.isAlive()).toBe(false);

    const result = await activationPromise;
    expect(result).toBeInstanceOf(Error);

    expect(onCrash).toHaveBeenCalledWith(crashError);

    await expect(client.invoke('data_cleaner', 'clean', {})).rejects.toThrow(PluginWorkerCrashError);
  });

  it('rejects pending and calls onCrash on non-zero worker exit', async () => {
    const onCrash = vi.fn();
    const client = createClient({ onCrash });

    const mockWorker = getWorkerInstances().at(-1)!;

    const invokePromise = client.invoke('data_cleaner', 'clean', {}).catch((error: unknown) => error);

    mockWorker.emit('exit', 1);

    expect(client.isAlive()).toBe(false);
    expect(onCrash).toHaveBeenCalled();
    const invokeResult = await invokePromise;
    expect(invokeResult).toBeInstanceOf(Error);

    await expect(client.activate({} as never)).rejects.toThrow(PluginWorkerCrashError);
  });

  it('does not trigger crash handler on zero exit code', async () => {
    const onCrash = vi.fn();
    const client = createClient({ onCrash });

    const mockWorker = getWorkerInstances().at(-1)!;
    mockWorker.emit('exit', 0);

    expect(client.isAlive()).toBe(false);
    expect(onCrash).not.toHaveBeenCalled();
  });
});

describe('plugin Worker consecutive failure tracking', () => {
  let postedMessages: Array<{ type: string; requestId: string }>;

  beforeEach(() => {
    resetWorkerState();
    postedMessages = [];
  });

  afterEach(() => {
    for (const worker of getWorkerInstances()) {
      worker.removeAllListeners();
    }
    getWorkerInstances().length = 0;
  });

  const createClientWithCapture = (options?: { onCrash?: (error: Error) => void }) => {
    const client = new PluginWorkerClient({
      context: {} as never,
      packId: PACK_ID,
      pluginId: 'plugin.crash.test',
      installationId: INSTALLATION_ID,
      grantedCapabilities: [],
      onCrash: options?.onCrash
    });
    // Hijack the mock worker's postMessage to capture request IDs
    const mockWorker = getWorkerInstances().at(-1)!;
    const origPost = mockWorker.postMessage;
    mockWorker.postMessage = (msg: unknown) => {
      const m = msg as { type: string; requestId: string };
      postedMessages.push(m);
      origPost.call(mockWorker, msg);
    };
    return client;
  };

  const simulateInvokeFailure = (worker: ReturnType<typeof getWorkerInstances>[number], requestId: string) => {
    worker.emit('message', {
      type: 'invoke_result',
      requestId,
      ok: false,
      error: { message: 'invocation failed' }
    });
  };

  const simulateInvokeSuccess = (worker: ReturnType<typeof getWorkerInstances>[number], requestId: string) => {
    worker.emit('message', {
      type: 'invoke_result',
      requestId,
      ok: true,
      result: { cleaned: 'ok' }
    });
  };

  it('resets consecutive failure counter on successful invoke', async () => {
    const onCrash = vi.fn();
    const client = createClientWithCapture({ onCrash });
    const worker = getWorkerInstances().at(-1)!;

    // Fail once
    const p1 = client.invoke('data_cleaner', 'clean', {}).catch(() => {});
    simulateInvokeFailure(worker, postedMessages.at(-1)!.requestId);
    await p1;

    // Succeed — should reset counter
    const p2 = client.invoke('data_cleaner', 'clean', {});
    simulateInvokeSuccess(worker, postedMessages.at(-1)!.requestId);
    await p2;

    expect(client.isAlive()).toBe(true);
    expect(onCrash).not.toHaveBeenCalled();
  });

  it('triggers crash after maxConsecutiveFailures consecutive invoke failures', async () => {
    const onCrash = vi.fn();
    const client = createClientWithCapture({ onCrash });
    const worker = getWorkerInstances().at(-1)!;

    // maxConsecutiveFailures defaults to 3. Fail 3 times in a row.
    for (let i = 0; i < 3; i++) {
      const p = client.invoke('data_cleaner', 'clean', {}).catch(() => {});
      simulateInvokeFailure(worker, postedMessages.at(-1)!.requestId);
      await p;
    }

    expect(client.isAlive()).toBe(false);
    expect(onCrash).toHaveBeenCalledTimes(1);
    expect(onCrash).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('exceeded max consecutive invocation failures')
    }));

    // Subsequent calls must be rejected immediately
    await expect(client.invoke('data_cleaner', 'clean', {})).rejects.toThrow(PluginWorkerCrashError);
  });

  it('does not count activate/deactivate failures toward consecutive limit', async () => {
    // activate and deactivate failures are lifecycle events, not invocation failures
    // They are handled by their own timeout mechanisms, not counted as consecutive invoke failures
    const onCrash = vi.fn();
    const client = createClientWithCapture({ onCrash });
    const worker = getWorkerInstances().at(-1)!;

    // Fail an activation (different message type — not counted as invoke failure)
    const actPromise = client.activate({
      hostApiVersion: '2.0.0',
      manifest: {} as never,
      installation: {} as never,
      artifactRoot: '/fake',
      entrypointPath: 'file:///fake/plugin.js',
      packId: PACK_ID,
      grantedCapabilities: []
    }).catch(() => {});
    worker.emit('message', {
      type: 'activation_result',
      requestId: postedMessages.at(-1)!.requestId,
      ok: false,
      error: { message: 'activation failed' }
    });
    await actPromise;

    // Client should still be alive after activation failure (not invoke consecutive failure)
    expect(client.isAlive()).toBe(true);

    // Now fail invoke 3 times — should still trigger crash (activation failure didn't advance counter)
    for (let i = 0; i < 3; i++) {
      const p = client.invoke('data_cleaner', 'clean', {}).catch(() => {});
      simulateInvokeFailure(worker, postedMessages.at(-1)!.requestId);
      await p;
    }

    expect(client.isAlive()).toBe(false);
    expect(onCrash).toHaveBeenCalledTimes(1);
  });
});
