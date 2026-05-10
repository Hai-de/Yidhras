import { describe, expect, it, vi } from 'vitest';

import { createAnthropicProviderAdapter } from '../../src/ai/providers/anthropic.js';
import type { AiProviderAdapterRequest } from '../../src/ai/providers/types.js';

const buildInput = (overrides?: Partial<AiProviderAdapterRequest>): AiProviderAdapterRequest => ({
  request: {
    invocation_id: 'test-inv-1',
    task_id: 'task-1',
    task_type: 'agent_decision',
    messages: [
      { role: 'system', parts: [{ type: 'text', text: 'You are an AI agent.' }] },
      { role: 'user', parts: [{ type: 'text', text: 'What is the weather?' }] }
    ],
    response_mode: 'free_text'
  },
  task_request: {
    task_id: 'task-1',
    task_type: 'agent_decision',
    input: {}
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
  model_entry: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    endpoint_kind: 'messages',
    capabilities: {
      text_generation: true,
      structured_output: 'json_schema',
      tool_calling: true,
      vision_input: true,
      embeddings: false,
      rerank: false,
      max_context_tokens: 200000,
      max_output_tokens: 8192
    },
    tags: [],
    availability: 'active'
  },
  provider_config: {
    provider: 'anthropic',
    api_key_env: 'ANTHROPIC_API_KEY',
    base_url: 'https://api.anthropic.com/v1',
    enabled: true
  },
  ...overrides
});

describe('Anthropic adapter — auth', () => {
  it('returns AI_PROVIDER_AUTH_MISSING when API key is not set', async () => {
    const adapter = createAnthropicProviderAdapter();
    const input = buildInput({
      provider_config: {
        provider: 'anthropic',
        api_key_env: null,
        base_url: 'https://api.anthropic.com/v1',
        enabled: true
      }
    });

    const result = await adapter.execute(input);
    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('AI_PROVIDER_AUTH_MISSING');
    expect(result.error?.retryable).toBe(false);
  });
});

describe('Anthropic adapter — execute errors', () => {
  it('handles non-OK HTTP status with error payload', async () => {
    // 模拟 fetch 返回 401
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers(),
      json: async () => ({ error: { type: 'authentication_error', message: 'Invalid API key' } })
    });
    vi.stubGlobal('fetch', mockFetch);

    process.env['ANTHROPIC_API_KEY'] = 'test-key';

    const adapter = createAnthropicProviderAdapter();
    const result = await adapter.execute(buildInput());

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('authentication_error');
    expect(result.error?.retryable).toBe(false);

    vi.unstubAllGlobals();
    delete process.env['ANTHROPIC_API_KEY'];
  });

  it('handles 429 with rate limit hints', async () => {
    const mockHeaders = new Headers();
    mockHeaders.set('retry-after', '30');
    mockHeaders.set('x-ratelimit-remaining', '0');

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: mockHeaders,
      json: async () => ({ error: { type: 'rate_limit_error', message: 'Rate limited' } })
    });
    vi.stubGlobal('fetch', mockFetch);

    process.env['ANTHROPIC_API_KEY'] = 'test-key';

    const adapter = createAnthropicProviderAdapter();
    const result = await adapter.execute(buildInput());

    expect(result.status).toBe('failed');
    expect(result.rate_limit_hints?.retryAfterSeconds).toBe(30);
    expect(result.rate_limit_hints?.remainingQuota).toBe(0);

    vi.unstubAllGlobals();
    delete process.env['ANTHROPIC_API_KEY'];
  });
});

describe('Anthropic adapter — response parsing', () => {
  it('parses successful text response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'The weather is sunny.' }],
        model: 'claude-sonnet-4-6',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 15 }
      })
    });
    vi.stubGlobal('fetch', mockFetch);

    process.env['ANTHROPIC_API_KEY'] = 'test-key';

    const adapter = createAnthropicProviderAdapter();
    const result = await adapter.execute(buildInput());

    expect(result.status).toBe('completed');
    expect(result.finish_reason).toBe('stop');
    expect(result.output.text).toBe('The weather is sunny.');
    expect(result.usage?.input_tokens).toBe(10);
    expect(result.usage?.output_tokens).toBe(15);
    expect(result.usage?.total_tokens).toBe(25);

    vi.unstubAllGlobals();
    delete process.env['ANTHROPIC_API_KEY'];
  });

  it('parses tool_use response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        id: 'msg_456',
        type: 'message',
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'toolu_001', name: 'get_weather', input: { city: 'Beijing' } }
        ],
        model: 'claude-sonnet-4-6',
        stop_reason: 'tool_use',
        usage: { input_tokens: 20, output_tokens: 30 }
      })
    });
    vi.stubGlobal('fetch', mockFetch);

    process.env['ANTHROPIC_API_KEY'] = 'test-key';

    const adapter = createAnthropicProviderAdapter();
    const result = await adapter.execute(buildInput());

    expect(result.status).toBe('completed');
    expect(result.finish_reason).toBe('tool_call');
    expect(result.output.mode).toBe('tool_call');
    expect(result.output.tool_calls).toHaveLength(1);
    expect(result.output.tool_calls?.[0].name).toBe('get_weather');
    expect(result.output.tool_calls?.[0].arguments).toEqual({ city: 'Beijing' });

    vi.unstubAllGlobals();
    delete process.env['ANTHROPIC_API_KEY'];
  });

  it('handles safety-blocked response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        id: 'msg_789',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'I cannot help with that.' }],
        model: 'claude-sonnet-4-6',
        stop_reason: 'content_filter',
        usage: { input_tokens: 5, output_tokens: 10 }
      })
    });
    vi.stubGlobal('fetch', mockFetch);

    process.env['ANTHROPIC_API_KEY'] = 'test-key';

    const adapter = createAnthropicProviderAdapter();
    const result = await adapter.execute(buildInput());

    expect(result.status).toBe('blocked');
    expect(result.safety?.blocked).toBe(true);

    vi.unstubAllGlobals();
    delete process.env['ANTHROPIC_API_KEY'];
  });
});
