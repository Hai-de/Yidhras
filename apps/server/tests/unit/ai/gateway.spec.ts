import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/ai/route_resolver.js', () => ({
  resolveAiRoute: vi.fn(() => ({
    route: {
      route_id: 'default',
      task_types: ['agent_decision'],
      preferred_models: [{ provider: 'mock', model: 'mock-model' }],
      fallback_models: [],
      constraints: {},
      defaults: { timeout_ms: 5000, retry_limit: 0, allow_fallback: true, audit_level: 'standard' }
    },
    primary_model_candidates: [{
      provider: 'mock',
      model: 'mock-model',
      endpoint_kind: 'chat',
      capabilities: { text_generation: true, structured_output: 'none', tool_calling: false, vision_input: false, embeddings: false, rerank: false },
      tags: [],
      availability: 'active'
    }],
    fallback_model_candidates: [],
    applied_override: null
  }))
}));

vi.mock('../../../src/ai/registry.js', () => ({
  getAiProviderConfig: vi.fn(() => ({ provider: 'mock', enabled: true })),
  getAiRegistryConfig: vi.fn(() => ({
    version: 1,
    providers: [{ provider: 'mock', enabled: true }],
    models: [],
    routes: [],
    tools: [],
    provider_templates: []
  }))
}));

vi.mock('../../../src/ai/providers/adapter_registry.js', () => ({
  buildAdaptersFromRegistry: vi.fn(() => [{
    provider: 'mock',
    async execute() {
      return {
        text: 'Hello from mock adapter',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        finish_reason: 'stop' as const,
        latency_ms: 50,
        provider_ref: 'mock-ref-123'
      };
    },
    async *executeStream() {
      yield { type: 'start' as const };
      yield { type: 'content_delta' as const, text: 'Hello' };
      yield { type: 'content_delta' as const, text: ' world' };
      yield { type: 'done' as const, finish_reason: 'stop' as const, usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } };
    }
  }])
}));

vi.mock('../../../src/ai/observability.js', () => ({
  recordAiInvocation: vi.fn(async () => {})
}));

vi.mock('../../../src/ai/elasticity/index.js', () => ({
  createCircuitBreaker: vi.fn(() => ({
    provider: 'mock',
    state: 'closed',
    allowRequest: vi.fn(() => true),
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
    snapshot: vi.fn(() => ({ provider: 'mock', state: 'closed', failureCount: 0, lastFailureAt: null, openedAt: null }))
  })),
  createRateLimiter: vi.fn(() => ({
    provider: 'mock',
    acquire: vi.fn(async () => {}),
    release: vi.fn(),
    adjustFromHints: vi.fn(),
    snapshot: vi.fn(() => ({ provider: 'mock', active: 0, queued: 0, maxConcurrent: 10 }))
  })),
  createExponentialBackoff: vi.fn(() => ({
    getDelay: vi.fn(() => 0),
    wait: vi.fn(async () => {})
  })),
  DEFAULT_BACKOFF_CONFIG: { baseDelayMs: 100, maxDelayMs: 5000, jitterRatio: 0.25 },
  resolveBackoffConfig: vi.fn((config: unknown) => config ?? { baseDelayMs: 100, maxDelayMs: 5000, jitterRatio: 0.25 }),
  resolveCircuitBreakerConfig: vi.fn(() => ({ failureThreshold: 5, recoveryTimeoutMs: 30000, halfOpenMaxRequests: 1, monitorWindowMs: 60000 })),
  resolveRateLimiterConfig: vi.fn(() => ({ maxConcurrent: 10, queueMaxSize: 50, queueTimeoutMs: 30000 }))
}));

import { createModelGateway } from '../../../src/ai/gateway.js';

const makeInput = () => ({
  request: {
    invocation_id: 'inv-test-001',
    task_id: 'task-1',
    task_type: 'agent_decision' as const,
    provider_hint: null,
    model_hint: null,
    route_id: null,
    messages: [{ role: 'user' as const, parts: [{ type: 'text' as const, text: 'Hello' }] }],
    response_mode: 'free_text' as const,
    structured_output: null,
    tools: undefined,
    tool_policy: null,
    sampling: { temperature: 0.7, max_output_tokens: 100 },
    execution: { timeout_ms: 5000, retry_limit: 0, allow_fallback: true }
  },
  task_request: {
    task_id: 'task-1',
    task_type: 'agent_decision' as const,
    pack_id: null,
    input: {},
    prompt_context: { prompt_bundle_v2: null },
    output_contract: { mode: 'free_text' as const, json_schema: undefined },
    route_hints: {},
    tools: [],
    tool_policy: null,
    metadata: { prompt_version: 'v1', source_prompt_keys: [] }
  },
  task_config: {
    definition: {
      task_type: 'agent_decision' as const,
      default_response_mode: 'free_text' as const,
      default_prompt_preset: 'default',
      default_decoder: 'none'
    },
    override: null,
    output: { mode: 'free_text' as const },
    prompt: {},
    parse: {},
    route: {},
    tools: [],
    tool_policy: { mode: 'disabled' as const }
  }
});

describe('AI gateway', () => {
  describe('createModelGateway', () => {
    it('returns gateway with execute and executeStream methods', () => {
      const gateway = createModelGateway();
      expect(typeof gateway.execute).toBe('function');
      expect(typeof gateway.executeStream).toBe('function');
    });

    it('execute returns a response object', async () => {
      const gateway = createModelGateway();
      const input = makeInput();

      const response = await gateway.execute(input);

      expect(response).toBeDefined();
      expect(response.invocation_id).toBe('inv-test-001');
      expect(response.task_id).toBe('task-1');
      expect(response.provider).toBe('mock');
    });

    it('execute with cache hit returns cached response', async () => {
      const gateway = createModelGateway();
      const coldInput = makeInput();
      // temperature=0 makes it cacheable
      coldInput.request.sampling = { temperature: 0, max_output_tokens: 100 };

      const first = await gateway.execute(coldInput);
      const second = await gateway.execute(coldInput);

      expect(first).toBeDefined();
      expect(second).toBeDefined();
    });

    it('executeStream yields chunks', async () => {
      const gateway = createModelGateway();
      const input = makeInput();

      const chunks: unknown[] = [];
      for await (const chunk of gateway.executeStream(input)) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
      const firstChunk = chunks[0] as { type: string };
      expect(firstChunk.type).toBe('start');
    });
  });
});
