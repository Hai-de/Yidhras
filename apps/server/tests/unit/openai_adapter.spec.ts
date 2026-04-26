import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createOpenAiProviderAdapter } from '../../src/ai/providers/openai.js';
import type { AiProviderAdapterRequest } from '../../src/ai/providers/types.js';
import type { AiMessage } from '../../src/ai/types.js';

const createMessage = (role: AiMessage['role'], text: string): AiMessage => ({
  role,
  parts: [{ type: 'text', text }],
});

const createAdapterRequest = (
  overrides?: Partial<AiProviderAdapterRequest>,
): AiProviderAdapterRequest => ({
  request: {
    invocation_id: 'inv-test',
    task_id: 'task-test',
    task_type: 'agent_decision',
    provider_hint: null,
    model_hint: null,
    route_id: null,
    messages: [createMessage('user', 'Hello')],
    response_mode: 'json_object',
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
    task_id: 'task-test',
    task_type: 'agent_decision',
    pack_id: 'test-pack',
    actor_ref: { identity_id: 'agent-001', identity_type: 'agent', role: 'active', agent_id: 'agent-001', atmosphere_node_id: null },
    input: { actor_display_name: 'Test', world_name: 'Test World' },
    prompt_context: { prompt_bundle: null },
    output_contract: undefined,
    route_hints: {},
    metadata: { prompt_version: '1.0.0', source_prompt_keys: [] } as any,
    ...overrides?.task_request,
  },
  task_config: {
    route: { privacy_tier: 'trusted_cloud' as const },
    prompt: { preset: 'default' },
    output: { mode: 'json_object', strict: false },
    parse: { decoder: 'auto', unwrap: undefined, field_alias: undefined, defaults: undefined, required_fields: [] },
    override: null,
    metadata: undefined,
    ...overrides?.task_config,
  },
  model_entry: {
    provider: 'openai',
    model: 'gpt-4.1-mini',
    endpoint_kind: 'chat_completions',
    capabilities: {
      text_generation: true,
      structured_output: 'json_schema',
      tool_calling: true,
      vision_input: true,
      embeddings: false,
      rerank: false,
    },
    tags: [],
    availability: 'active',
    ...overrides?.model_entry,
  },
  provider_config: {
    provider: 'openai',
    api_key_env: 'TEST_OPENAI_KEY',
    enabled: true,
    ...overrides?.provider_config,
  },
});

describe('OpenAI provider adapter', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    process.env.TEST_OPENAI_KEY = 'sk-test-key';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.TEST_OPENAI_KEY;
  });

  it('returns auth missing result when API key is not configured', async () => {
    delete process.env.TEST_OPENAI_KEY;
    const adapter = createOpenAiProviderAdapter();
    const result = await adapter.execute(createAdapterRequest());
    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('AI_PROVIDER_AUTH_MISSING');
  });

  it('calls chat completions endpoint for chat_completions kind', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'x-request-id': 'req-123' }),
      json: async () => ({
        id: 'chatcmpl-123',
        object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content: 'Hello back!' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    } as unknown as Response);
    global.fetch = fetchMock;

    const adapter = createOpenAiProviderAdapter();
    const result = await adapter.execute(createAdapterRequest());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url).toContain('/chat/completions');
    expect(result.status).toBe('completed');
    expect(result.output.text).toBe('Hello back!');
    expect(result.output.mode).toBe('free_text');
  });

  it('parses tool calls from chat completion response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'x-request-id': 'req-456' }),
      json: async () => ({
        id: 'chatcmpl-456',
        object: 'chat.completion',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: 'call-1',
              type: 'function',
              function: { name: 'search', arguments: '{"query":"test"}' },
            }],
          },
          finish_reason: 'tool_calls',
        }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      }),
    } as unknown as Response);
    global.fetch = fetchMock;

    const adapter = createOpenAiProviderAdapter();
    const result = await adapter.execute(createAdapterRequest({
      request: {
        ...createAdapterRequest().request,
        tools: [{ name: 'search', description: 'search tool', input_schema: { type: 'object', properties: { query: { type: 'string' } } }, strict: false }],
        tool_policy: { mode: 'allowed' },
      },
    }));

    expect(result.status).toBe('completed');
    expect(result.output.mode).toBe('tool_call');
    expect(result.output.tool_calls).toHaveLength(1);
    expect(result.output.tool_calls?.[0]?.name).toBe('search');
    expect(result.output.tool_calls?.[0]?.arguments).toMatchObject({ query: 'test' });
  });

  it('handles error responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers({ 'x-request-id': 'req-err' }),
      json: async () => ({ error: { code: 'rate_limit_exceeded', message: 'Too many requests' } }),
    } as unknown as Response);
    global.fetch = fetchMock;

    const adapter = createOpenAiProviderAdapter();
    const result = await adapter.execute(createAdapterRequest());

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('rate_limit_exceeded');
    expect(result.error?.retryable).toBe(true);
  });

  it('calls responses endpoint for responses kind', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'x-request-id': 'req-resp' }),
      json: async () => ({
        id: 'resp-123',
        object: 'response',
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'Response API reply' }] }],
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      }),
    } as unknown as Response);
    global.fetch = fetchMock;

    const adapter = createOpenAiProviderAdapter();
    const result = await adapter.execute(createAdapterRequest({
      model_entry: {
        ...createAdapterRequest().model_entry,
        endpoint_kind: 'responses',
      },
    }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url).toContain('/responses');
    expect(result.status).toBe('completed');
    expect(result.output.text).toBe('Response API reply');
  });
});
