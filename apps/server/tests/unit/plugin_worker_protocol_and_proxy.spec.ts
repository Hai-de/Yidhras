import { describe, expect, it, vi } from 'vitest';

import {
  contributionDescriptorSchema,
  dataCleanerDescriptorSchema
} from '../../src/plugins/worker/contribution_descriptors.js';
import {
  createWorkerContributionProxies
} from '../../src/plugins/worker/contribution_proxy.js';
import {
  parseMainToWorkerMessage,
  parseWorkerToMainMessage,
  serializePluginError
} from '../../src/plugins/worker/protocol.js';
import { createWorkerPluginHostApi } from '../../src/plugins/worker/worker_host_api.js';

const createMockClient = (invoke: ReturnType<typeof vi.fn>) => ({
  invoke
});

describe('plugin Worker protocol and descriptors', () => {
  it('accepts valid Worker IPC messages and rejects unknown host methods', () => {
    expect(parseMainToWorkerMessage({
      type: 'deactivate',
      requestId: 'req-1'
    })).toMatchObject({ type: 'deactivate', requestId: 'req-1' });

    expect(parseWorkerToMainMessage({
      type: 'host_call',
      requestId: 'host-1',
      method: 'getCurrentTick',
      payload: { pack_id: 'pack-a' }
    })).toMatchObject({ type: 'host_call', method: 'getCurrentTick' });

    expect(() => parseWorkerToMainMessage({
      type: 'host_call',
      requestId: 'host-2',
      method: 'dangerousMainThreadEscape',
      payload: {}
    })).toThrow();
  });

  it('serializes plugin errors without leaking non-string codes', () => {
    const error = new Error('boom') as Error & { code?: unknown };
    error.code = 500;

    expect(serializePluginError(error)).toMatchObject({
      name: 'Error',
      message: 'boom',
      code: undefined
    });
  });

  it('applies descriptor defaults and rejects unknown capability keys', () => {
    const descriptor = dataCleanerDescriptorSchema.parse({
      type: 'data_cleaner',
      name: 'cleaner',
      invoke: 'clean',
      key: 'cleaner.key',
      version: '1.0.0'
    });

    expect(descriptor).toMatchObject({
      priority: 0,
      trigger: 'on_tick',
      config: {}
    });

    expect(() => contributionDescriptorSchema.parse({
      type: 'api_route',
      name: 'route',
      invoke: 'route',
      method: 'GET',
      path: '/route',
      capabilityKey: 'server.prisma.full_access'
    })).toThrow();
  });
});

describe('Worker-side Host API registration', () => {
  it('records descriptor-only registrations and rejects duplicate handlers/descriptors', () => {
    const runtime = createWorkerPluginHostApi({
      sendHostCall: async () => null,
      sendMessage: () => {}
    });

    const handler = vi.fn();
    runtime.host.registerHandler('clean', handler);
    runtime.host.registerDataCleaner({
      type: 'data_cleaner',
      name: 'Cleaner',
      invoke: 'clean',
      key: 'cleaner.key',
      version: '1.0.0'
    });

    expect(runtime.handlers.get('clean')).toBe(handler);
    expect(runtime.getDescriptors()).toHaveLength(1);
    expect(runtime.getDescriptors()[0]).toMatchObject({
      type: 'data_cleaner',
      capabilityKey: 'server.data_cleaner.register'
    });

    expect(() => runtime.host.registerHandler('clean', handler)).toThrow(/Duplicate plugin handler/);
    expect(() => runtime.host.registerDataCleaner({
      type: 'data_cleaner',
      name: 'Cleaner',
      invoke: 'clean-2',
      key: 'cleaner.other',
      version: '1.0.0'
    })).toThrow(/Duplicate plugin contribution descriptor/);
  });

  it('forwards requestInference through host_call sender', async () => {
    const sendHostCall = vi.fn(async () => ({
      content: 'ok',
      usage: { inputTokens: 1, outputTokens: 2 }
    }));
    const runtime = createWorkerPluginHostApi({
      sendHostCall,
      sendMessage: () => {}
    });

    await expect(runtime.host.requestInference({
      purpose: 'test',
      systemPrompt: 'system',
      userPrompt: 'user'
    })).resolves.toMatchObject({ content: 'ok' });

    expect(sendHostCall).toHaveBeenCalledWith('requestInference', expect.objectContaining({ purpose: 'test' }));
  });
});

describe('main-thread Worker contribution proxies', () => {
  it('JSON-clones BigInt payloads before Worker invocation and validates outputs', async () => {
    const invoke = vi.fn(async () => ({ cleaned: '42', diagnostics: [] }));
    const client = createMockClient(invoke);
    const proxies = createWorkerContributionProxies(client as never, [{
      type: 'data_cleaner',
      name: 'Cleaner',
      invoke: 'clean',
      priority: 0,
      key: 'cleaner.key',
      version: '1.0.0',
      trigger: 'on_tick',
      config: {}
    }]);

    await expect(proxies.data_cleaners[0]?.clean({
      text: '42',
      options: { currentTick: 100n }
    })).resolves.toMatchObject({ cleaned: '42' });

    expect(invoke).toHaveBeenCalledWith(
      'data_cleaner',
      'clean',
      { text: '42', options: { currentTick: '100' } },
      { timeoutMs: undefined }
    );
  });

  it('rejects invalid Worker outputs at the proxy boundary', async () => {
    const invoke = vi.fn(async () => ({ invalid: true }));
    const client = createMockClient(invoke);
    const proxies = createWorkerContributionProxies(client as never, [{
      type: 'slot_condition_evaluator',
      name: 'Slot Condition',
      invoke: 'evaluate',
      priority: 0,
      key: 'slot.condition',
      version: '1.0.0',
      config: {}
    }]);

    await expect(proxies.slot_condition_evaluators[0]?.evaluate({
      slot_id: 'slot-1',
      variables: {},
      conversation_meta: { turn_count: 1 },
      token_budget: { total: 100, used: 0, remaining: 100 },
      current_tick: 1,
      last_user_message: 'hello',
      options: {}
    })).rejects.toThrow();
  });
});
