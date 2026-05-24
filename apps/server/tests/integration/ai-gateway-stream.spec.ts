import { describe, expect, it } from 'vitest';

import type { ModelGatewayExecutionInput } from '../../src/ai/gateway.js';
import { createModelGateway } from '../../src/ai/gateway.js';
import type { AiProviderAdapter, AiProviderAdapterChunk, AiProviderAdapterRequest, AiProviderAdapterResult } from '../../src/ai/providers/types.js';
import type { AiRegistryConfig } from '../../src/ai/types.js';

// ── Helpers ────────────────────────────────────────────────────────────

const streamRegistry: AiRegistryConfig = {
  version: 1,
  providers: [
    { provider: 'openai', enabled: true },
    { provider: 'anthropic', enabled: true }
  ],
  models: [
    {
      provider: 'openai', model: 'gpt-4.1-mini', endpoint_kind: 'chat_completions',
      capabilities: { text_generation: true, structured_output: 'json_schema', tool_calling: true, vision_input: false, embeddings: false, rerank: false },
      tags: ['default'], availability: 'active'
    },
    {
      provider: 'anthropic', model: 'claude-sonnet-4-6', endpoint_kind: 'messages',
      capabilities: { text_generation: true, structured_output: 'json_schema', tool_calling: true, vision_input: false, embeddings: false, rerank: false },
      tags: ['default'], availability: 'active'
    }
  ],
  routes: [
    {
      route_id: 'default.agent_decision',
      task_types: ['agent_decision'],
      preferred_models: [{ provider: 'openai', model: 'gpt-4.1-mini' }],
      fallback_models: [{ provider: 'anthropic', model: 'claude-sonnet-4-6' }],
      defaults: { timeout_ms: 30000, retry_limit: 0, allow_fallback: true, audit_level: 'minimal' }
    }
  ]
};

const buildStreamInput = (overrides?: Partial<ModelGatewayExecutionInput>): ModelGatewayExecutionInput => ({
  request: {
    invocation_id: 'stream-test-1',
    task_id: 'task-1',
    task_type: 'agent_decision',
    messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
    response_mode: 'free_text',
    sampling: { temperature: 0, max_output_tokens: 100 }
  },
  task_request: {
    task_id: 'task-1',
    task_type: 'agent_decision',
    input: {},
    prompt_context: { prompt_bundle_v2: {} }
  },
  task_config: {
    definition: {
      task_type: 'agent_decision',
      default_response_mode: 'free_text',
      default_prompt_preset: 'default',
      default_decoder: 'passthrough'
    },
    override: null,
    output: { mode: 'free_text' },
    prompt: {},
    parse: {},
    route: {},
    tools: [],
    tool_policy: { mode: 'disabled' }
  },
  ...overrides
});

const collectChunks = async (iterable: AsyncIterable<AiProviderAdapterChunk>): Promise<AiProviderAdapterChunk[]> => {
  const chunks: AiProviderAdapterChunk[] = [];
  for await (const chunk of iterable) {
    chunks.push(chunk);
  }
  return chunks;
};

// ── Streaming adapter fixture ──────────────────────────────────────────

const createStreamingAdapter = (
  provider: string,
  chunks: AiProviderAdapterChunk[]
): AiProviderAdapter => ({
  provider,
  async execute(_input: AiProviderAdapterRequest): Promise<AiProviderAdapterResult> {
    return {
      status: 'completed',
      finish_reason: 'stop',
      output: { mode: 'free_text', text: 'fallback' },
      usage: undefined,
      safety: { blocked: false, reason_code: null, provider_signal: null },
      raw_ref: undefined,
      error: null
    };
  },
  async *executeStream(_input: AiProviderAdapterRequest, _signal?: AbortSignal): AsyncIterable<AiProviderAdapterChunk> {
    for (const chunk of chunks) {
      yield chunk;
    }
  }
});

// ── Tests ──────────────────────────────────────────────────────────────

describe('ModelGateway executeStream', () => {
  it('streams text_delta chunks and finishes', async () => {
    const adapter = createStreamingAdapter('openai', [
      { type: 'text_delta', text: 'Hello' },
      { type: 'text_delta', text: ' world' },
      { type: 'finish', finish_reason: 'stop', usage: { input_tokens: 10, output_tokens: 5 } }
    ]);

    const gateway = createModelGateway({
      adapters: [adapter],
      registryConfig: streamRegistry
    });

    const chunks = await collectChunks(gateway.executeStream(buildStreamInput()));

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toEqual({ type: 'text_delta', text: 'Hello' });
    expect(chunks[1]).toEqual({ type: 'text_delta', text: ' world' });
    expect(chunks[2].type).toBe('finish');
  });

  it('streams tool_call chunks (start + delta)', async () => {
    const adapter = createStreamingAdapter('openai', [
      { type: 'tool_call_start', index: 0, name: 'get_weather', call_id: 'call_1' },
      { type: 'tool_call_delta', index: 0, arguments_fragment: '{"city":"Beijing"}' },
      { type: 'finish', finish_reason: 'tool_call', usage: { output_tokens: 20 } }
    ]);

    const gateway = createModelGateway({
      adapters: [adapter],
      registryConfig: streamRegistry
    });

    const chunks = await collectChunks(gateway.executeStream(buildStreamInput()));

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toEqual({ type: 'tool_call_start', index: 0, name: 'get_weather', call_id: 'call_1' });
    expect(chunks[1]).toEqual({ type: 'tool_call_delta', index: 0, arguments_fragment: '{"city":"Beijing"}' });
    expect(chunks[2].type).toBe('finish');
  });

  it('falls back to non-streaming when adapter lacks executeStream', async () => {
    const nonStreamingAdapter: AiProviderAdapter = {
      provider: 'openai',
      async execute(_input: AiProviderAdapterRequest): Promise<AiProviderAdapterResult> {
        return {
          status: 'completed',
          finish_reason: 'stop',
          output: { mode: 'free_text', text: 'degraded output' },
          usage: { input_tokens: 5, output_tokens: 3 },
          safety: { blocked: false, reason_code: null, provider_signal: null },
          raw_ref: undefined,
          error: null
        };
      }
      // 无 executeStream
    };

    const gateway = createModelGateway({
      adapters: [nonStreamingAdapter],
      registryConfig: streamRegistry
    });

    const chunks = await collectChunks(gateway.executeStream(buildStreamInput()));

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual({ type: 'text_delta', text: 'degraded output' });
    expect(chunks[1].type).toBe('finish');
  });

  it('skips disabled providers', async () => {
    const disabledRegistry: AiRegistryConfig = {
      ...streamRegistry,
      providers: [{ provider: 'openai', enabled: false }]
    };

    const adapter = createStreamingAdapter('openai', [
      { type: 'text_delta', text: 'should not appear' }
    ]);

    const gateway = createModelGateway({
      adapters: [adapter],
      registryConfig: disabledRegistry
    });

    const chunks = await collectChunks(gateway.executeStream(buildStreamInput()));

    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe('error');
    expect((chunks[0] as { code: string }).code).toBe('STREAM_NO_PROVIDER');
  });

  it('yields error chunk when stream throws', async () => {
    const failingAdapter: AiProviderAdapter = {
      provider: 'openai',
      async execute(_input: AiProviderAdapterRequest): Promise<AiProviderAdapterResult> {
        return {
          status: 'failed',
          finish_reason: 'error',
          output: { mode: 'free_text' },
          usage: undefined,
          safety: { blocked: false, reason_code: null, provider_signal: null },
          raw_ref: undefined,
          error: { code: 'FAIL', message: 'x', retryable: true, stage: 'provider' }
        };
      },
      async *executeStream(_input: AiProviderAdapterRequest, _signal?: AbortSignal): AsyncIterable<AiProviderAdapterChunk> {
        throw new Error('stream explosion');
        yield { type: 'text_delta', text: 'unreachable' };
      }
    };

    const gateway = createModelGateway({
      adapters: [failingAdapter],
      registryConfig: streamRegistry
    });

    const chunks = await collectChunks(gateway.executeStream(buildStreamInput()));

    // 第一个 provider 抛异常 → 没有更多 candidate → STREAM_NO_PROVIDER
    expect(chunks[chunks.length - 1].type).toBe('error');
  });

  it('handles AbortSignal cancellation', async () => {
    const controller = new AbortController();
    let signalReceived: AbortSignal | undefined;

    const adapter: AiProviderAdapter = {
      provider: 'openai',
      async execute(_input: AiProviderAdapterRequest): Promise<AiProviderAdapterResult> {
        return {
          status: 'completed', finish_reason: 'stop',
          output: { mode: 'free_text', text: '' },
          usage: undefined,
          safety: { blocked: false, reason_code: null, provider_signal: null },
          raw_ref: undefined, error: null
        };
      },
      async *executeStream(_input: AiProviderAdapterRequest, signal?: AbortSignal): AsyncIterable<AiProviderAdapterChunk> {
        signalReceived = signal;
        yield { type: 'text_delta', text: 'before abort' };
        // simulate abort
        controller.abort();
        yield { type: 'finish', finish_reason: 'stop' };
      }
    };

    const gateway = createModelGateway({
      adapters: [adapter],
      registryConfig: streamRegistry
    });

    const chunks = await collectChunks(gateway.executeStream(buildStreamInput(), controller.signal));

    expect(signalReceived).toBeDefined();
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0]).toEqual({ type: 'text_delta', text: 'before abort' });
  });
});
