import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AiProviderAdapterRequest } from '../../src/ai/providers/types.js';
import { createXiaomiMiMoProviderAdapter } from '../../src/ai/providers/xiaomi_mimo.js';
import type { AiMessage, AiTaskRequestMetadata } from '../../src/ai/types.js';
import { expectDefined } from '../helpers/assertions.js';

const createMessage = (role: AiMessage['role'], text: string): AiMessage => ({
  role,
  parts: [{ type: 'text', text }],
});

const createAdapterRequest = (
  overrides?: Partial<AiProviderAdapterRequest>,
): AiProviderAdapterRequest => ({
  request: {
    invocation_id: 'inv-mimo-test',
    task_id: 'task-mimo-test',
    task_type: 'agent_decision',
    provider_hint: null,
    model_hint: null,
    route_id: null,
    messages: [createMessage('user', '你是🐷吗？')],
    response_mode: 'free_text',
    structured_output: null,
    tools: [],
    tool_policy: { mode: 'disabled' },
    execution: { timeout_ms: 30000, retry_limit: 0, allow_fallback: true, idempotency_key: null },
    governance: { privacy_tier: 'trusted_cloud', audit_level: 'standard', safety_profile: null },
    metadata: {
      prompt_preset: 'default',
      decoder: 'auto',
      workflow_task_type: 'agent_decision',
      task_metadata: null,
      task_input: {},
      inference_id: null,
      workflow_profile_id: null,
      workflow_profile_version: null,
      workflow_step_keys: [],
      processing_trace: null,
    },
    ...overrides?.request,
  },
  task_request: {
    task_id: 'task-mimo-test',
    task_type: 'agent_decision',
    pack_id: 'test-pack',
    actor_ref: { identity_id: 'agent-001', identity_type: 'agent', role: 'active', agent_id: 'agent-001', atmosphere_node_id: null },
    input: { actor_display_name: 'Test', world_name: 'Test World' },
    prompt_context: { prompt_bundle_v2: null },
    output_contract: undefined,
    route_hints: {},
    metadata: { prompt_version: '1.0.0', source_prompt_keys: [] } satisfies AiTaskRequestMetadata,
    ...overrides?.task_request,
  },
  task_config: {
    tools: [],
    tool_policy: { mode: 'disabled' as const },
    route: { privacy_tier: 'trusted_cloud' as const },
    prompt: { preset: 'default' },
    output: { mode: 'free_text', strict: false },
    parse: { decoder: 'auto', unwrap: undefined, field_alias: undefined, defaults: undefined, required_fields: [] },
    override: null,
    metadata: undefined,
    ...overrides?.task_config,
    definition: {
      task_type: 'agent_decision',
      default_response_mode: 'free_text',
      default_prompt_preset: 'default',
      default_decoder: 'auto',
    },
  },
  model_entry: {
    provider: 'mimo',
    model: 'mimo-v2.5-pro',
    endpoint_kind: 'chat_completions',
    capabilities: {
      text_generation: true,
      structured_output: 'json_object',
      tool_calling: true,
      vision_input: false,
      embeddings: false,
      rerank: false,
    },
    tags: [],
    availability: 'active',
    ...overrides?.model_entry,
  },
  provider_config: {
    provider: 'mimo',
    api_key_env: 'TEST_MIMO_API_KEY',
    base_url: 'https://token-plan-sgp.xiaomimimo.com/v1',
    enabled: true,
    ...overrides?.provider_config,
  },
});

describe('Xiaomi MiMo provider adapter', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    process.env.TEST_MIMO_API_KEY = 'sk-mimo-test-key';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.TEST_MIMO_API_KEY;
  });

  it('returns auth missing result when API key is not configured', async () => {
    delete process.env.TEST_MIMO_API_KEY;
    const adapter = createXiaomiMiMoProviderAdapter();
    const result = await adapter.execute(createAdapterRequest());
    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('AI_PROVIDER_AUTH_MISSING');
  });

  it('sends request to the correct MiMo chat completions endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'x-request-id': 'mimo-req-001' }),
      json: async () => ({
        id: 'mimo-chat-001',
        object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content: '我不是🐷，我是小米MiMo大模型助手。' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 12, completion_tokens: 18, total_tokens: 30 },
      }),
    } as unknown as Response);
    global.fetch = fetchMock;

    const adapter = createXiaomiMiMoProviderAdapter();
    const result = await adapter.execute(createAdapterRequest());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0]?.[0] as string;
      expect(url).toBe('https://token-plan-sgp.xiaomimimo.com/v1/chat/completions');

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(body.model).toBe('mimo-v2.5-pro');
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe('user');
    expect(body.messages[0].content).toBe('你是🐷吗？');

    expect(result.status).toBe('completed');
    expect(result.finish_reason).toBe('stop');
    expect(result.output.text).toBe('我不是🐷，我是小米MiMo大模型助手。');
    expect(result.output.mode).toBe('free_text');
    expect(result.usage?.input_tokens).toBe(12);
    expect(result.usage?.output_tokens).toBe(18);
    expect(result.usage?.total_tokens).toBe(30);
    expect(result.raw_ref?.provider_request_id).toBe('mimo-req-001');
    expect(result.raw_ref?.provider_response_id).toBe('mimo-chat-001');
  });

  it('uses Authorization Bearer header with the API key', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        id: 'mimo-auth-test',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    } as unknown as Response);
    global.fetch = fetchMock;

    const adapter = createXiaomiMiMoProviderAdapter();
    await adapter.execute(createAdapterRequest());

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer sk-mimo-test-key');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('passes sampling parameters to the request body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        id: 'mimo-sampling-test',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: {},
      }),
    } as unknown as Response);
    global.fetch = fetchMock;

    const adapter = createXiaomiMiMoProviderAdapter();
    await adapter.execute(createAdapterRequest({
      request: {
        ...createAdapterRequest().request,
        sampling: {
          temperature: 0.8,
          top_p: 0.9,
          max_output_tokens: 500,
        },
      },
    }));

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(body.temperature).toBe(0.8);
    expect(body.top_p).toBe(0.9);
    expect(body.max_tokens).toBe(500);
  });

  it('handles HTTP error responses gracefully', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers({ 'x-request-id': 'mimo-err-001' }),
      json: async () => ({ error: { code: 'authentication_error', message: 'Invalid API key' } }),
    } as unknown as Response);
    global.fetch = fetchMock;

    const adapter = createXiaomiMiMoProviderAdapter();
    const result = await adapter.execute(createAdapterRequest());

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('authentication_error');
    expect(result.error?.message).toBe('Invalid API key');
    expect(result.error?.retryable).toBe(false);
  });

  it('handles rate limit (429) responses as retryable', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers({ 'x-request-id': 'mimo-rl-001' }),
      json: async () => ({ error: { code: 'rate_limit_exceeded', message: 'Too many requests' } }),
    } as unknown as Response);
    global.fetch = fetchMock;

    const adapter = createXiaomiMiMoProviderAdapter();
    const result = await adapter.execute(createAdapterRequest());

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('rate_limit_exceeded');
    expect(result.error?.retryable).toBe(true);
  });

  it('respects custom base_url override via model_entry', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        id: 'mimo-custom-base',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: {},
      }),
    } as unknown as Response);
    global.fetch = fetchMock;

    const adapter = createXiaomiMiMoProviderAdapter();
    await adapter.execute(createAdapterRequest({
      model_entry: {
        ...createAdapterRequest().model_entry,
        base_url: 'https://custom-mimo-proxy.example.com/v1',
      },
    }));

    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url).toBe('https://custom-mimo-proxy.example.com/v1/chat/completions');
  });

  it('works with mimo-v2.5-pro model', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        id: 'mimo-v25-test',
        choices: [{ index: 0, message: { role: 'assistant', content: 'MiMo V2.5 Pro 响应' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 8, total_tokens: 13 },
      }),
    } as unknown as Response);
    global.fetch = fetchMock;

    const adapter = createXiaomiMiMoProviderAdapter();
    const result = await adapter.execute(createAdapterRequest({
      model_entry: {
        ...createAdapterRequest().model_entry,
        model: 'mimo-v2.5-pro',
      },
    }));

    expect(result.status).toBe('completed');
    expect(result.output.text).toBe('MiMo V2.5 Pro 响应');
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(body.model).toBe('mimo-v2.5-pro');
  });

  it('streams text deltas correctly', async () => {
    const encoder = new TextEncoder();
    const sseChunks = [
      'data: {"id":"mimo-s-1","choices":[{"index":0,"delta":{"role":"assistant","content":"我不是"},"finish_reason":null}]}\n\n',
      'data: {"id":"mimo-s-2","choices":[{"index":0,"delta":{"content":"🐷，我是MiMo助手"},"finish_reason":null}]}\n\n',
      'data: {"id":"mimo-s-3","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":3,"total_tokens":8}}\n\n',
      'data: [DONE]\n\n',
    ];
    const streamChunks = sseChunks.map(chunk => encoder.encode(chunk));

    let readIndex = 0;
    const mockBody = {
      getReader() {
        return {
          async read() {
            if (readIndex >= streamChunks.length) {
              return { done: true, value: undefined };
            }
            return { done: false, value: streamChunks[readIndex++] };
          },
          releaseLock() {},
        };
      },
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      body: mockBody,
    } as unknown as Response);
    global.fetch = fetchMock;

    const adapter = createXiaomiMiMoProviderAdapter();
    const chunks: import('../../src/ai/providers/types.js').AiProviderAdapterChunk[] = [];
    const executeStream = expectDefined(adapter.executeStream, 'executeStream');
    for await (const chunk of executeStream(createAdapterRequest())) {
      chunks.push(chunk);
    }

    const textDeltas = chunks.filter(c => c.type === 'text_delta');
    expect(textDeltas).toHaveLength(2);
    expect(textDeltas[0]).toMatchObject({ type: 'text_delta', text: '我不是' });
    expect(textDeltas[1]).toMatchObject({ type: 'text_delta', text: '🐷，我是MiMo助手' });

    const finish = chunks.find(c => c.type === 'finish');
    const finishChunk = expectDefined(finish, 'finish chunk');
    expect(finishChunk.type).toBe('finish');
    if ('finish_reason' in finishChunk) {
      expect(finish.finish_reason).toBe('stop');
      expect(finish.usage?.total_tokens).toBe(8);
    }

    const streamBody = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(streamBody.stream).toBe(true);
  });
});
