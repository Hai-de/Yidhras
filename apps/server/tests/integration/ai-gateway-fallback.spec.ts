import { describe, expect, it, vi } from 'vitest';

import { createModelGateway } from '../../src/ai/gateway.js';
import type { AiProviderAdapter, AiProviderAdapterResult } from '../../src/ai/providers/types.js';
import type { AiTaskService } from '../../src/ai/task_service.js';
import { createAiTaskService } from '../../src/ai/task_service.js';
import type { AiRegistryConfig } from '../../src/ai/types.js';

// ── Adapter fixtures ───────────────────────────────────────────────────

const completedResult = (provider: string): AiProviderAdapterResult => ({
  status: 'completed',
  finish_reason: 'stop',
  output: {
    mode: 'json_object',
    text: JSON.stringify({ action_type: 'idle', payload: {}, confidence: 0.5 })
  },
  usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, latency_ms: 100 },
  safety: { blocked: false, reason_code: null, provider_signal: null },
  raw_ref: { provider_request_id: `req-${provider}`, provider_response_id: `resp-${provider}` },
  error: null
});

const authErrorResult = (provider: string): AiProviderAdapterResult => ({
  status: 'failed',
  finish_reason: 'error',
  output: { mode: 'json_schema' },
  usage: undefined,
  safety: { blocked: false, reason_code: null, provider_signal: null },
  raw_ref: { provider_request_id: null, provider_response_id: null },
  error: {
    code: 'AI_PROVIDER_AUTH_INVALID',
    message: `${provider} auth failed`,
    retryable: false,
    stage: 'provider'
  }
});

const serverErrorResult = (provider: string): AiProviderAdapterResult => ({
  status: 'failed',
  finish_reason: 'error',
  output: { mode: 'json_schema' },
  usage: undefined,
  safety: { blocked: false, reason_code: null, provider_signal: null },
  raw_ref: { provider_request_id: null, provider_response_id: null },
  error: {
    code: 'AI_PROVIDER_FAIL',
    message: `${provider} server error`,
    retryable: true,
    stage: 'provider'
  }
});

const rateLimitResult = (provider: string): AiProviderAdapterResult => ({
  status: 'failed',
  finish_reason: 'error',
  output: { mode: 'json_schema' },
  usage: undefined,
  safety: { blocked: false, reason_code: null, provider_signal: null },
  raw_ref: { provider_request_id: null, provider_response_id: null },
  error: {
    code: 'AI_PROVIDER_RATE_LIMIT',
    message: `${provider} rate limited`,
    retryable: true,
    stage: 'provider'
  }
});

// ── Registry fixture ───────────────────────────────────────────────────

const createMultiProviderRegistry = (): AiRegistryConfig => ({
  version: 1,
  providers: [
    { provider: 'openai', enabled: true },
    { provider: 'anthropic', enabled: true },
    { provider: 'deepseek', enabled: true }
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
    },
    {
      provider: 'deepseek', model: 'deepseek-chat', endpoint_kind: 'chat_completions',
      capabilities: { text_generation: true, structured_output: 'json_object', tool_calling: true, vision_input: false, embeddings: false, rerank: false },
      tags: ['default'], availability: 'active'
    }
  ],
  routes: [
    {
      route_id: 'default.agent_decision',
      task_types: ['agent_decision'],
      preferred_models: [{ provider: 'openai', model: 'gpt-4.1-mini' }],
      fallback_models: [
        { provider: 'anthropic', model: 'claude-sonnet-4-6' },
        { provider: 'deepseek', model: 'deepseek-chat' }
      ],
      constraints: { response_modes: ['json_object', 'json_schema'] },
      defaults: { allow_fallback: true, retry_limit: 0, audit_level: 'minimal' }
    }
  ]
});

// ── Helper ─────────────────────────────────────────────────────────────

const createGateway = (adapters: AiProviderAdapter[], registryConfig?: AiRegistryConfig) => {
  return createModelGateway({
    registryConfig: registryConfig ?? createMultiProviderRegistry(),
    adapters
  });
};

const createAiSvc = (adapters: AiProviderAdapter[], registryConfig?: AiRegistryConfig): AiTaskService => {
  return createAiTaskService({
    gateway: createGateway(adapters, registryConfig)
  });
};

const runTask = async (svc: AiTaskService) => {
  return svc.runTask({
    task_id: `task-${Date.now()}`,
    task_type: 'agent_decision',
    pack_id: 'test-pack',
    input: {},
    prompt_context: {
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'test' }] }]
    },
    output_contract: {
      mode: 'json_object'
    }
  });
};

// ── Tests ──────────────────────────────────────────────────────────────

describe('AI gateway multi-provider fallback', () => {
  it('uses primary provider (openai) when it succeeds', async () => {
    const openai = { provider: 'openai', execute: vi.fn(async () => completedResult('openai')) };
    const anthropic = { provider: 'anthropic', execute: vi.fn(async () => completedResult('anthropic')) };

    const svc = createAiSvc([openai, anthropic]);
    const result = await runTask(svc);

    expect(result.invocation.status).toBe('completed');
    expect(openai.execute).toHaveBeenCalledTimes(1);
    expect(anthropic.execute).not.toHaveBeenCalled();
    expect(result.invocation.attempted_models).toEqual(['openai:gpt-4.1-mini']);
  });

  it('falls back to anthropic when openai returns server error', async () => {
    const openai = { provider: 'openai', execute: vi.fn(async () => serverErrorResult('openai')) };
    const anthropic = { provider: 'anthropic', execute: vi.fn(async () => completedResult('anthropic')) };

    const svc = createAiSvc([openai, anthropic]);
    const result = await runTask(svc);

    expect(result.invocation.status).toBe('completed');
    expect(openai.execute).toHaveBeenCalledTimes(1);
    expect(anthropic.execute).toHaveBeenCalledTimes(1);
    expect(result.invocation.attempted_models).toContain('openai:gpt-4.1-mini');
    expect(result.invocation.attempted_models).toContain('anthropic:claude-sonnet-4-6');
    expect(result.invocation.fallback_used).toBe(true);
  });

  it('cascades to deepseek when openai and anthropic both fail', async () => {
    const openai = { provider: 'openai', execute: vi.fn(async () => serverErrorResult('openai')) };
    const anthropic = { provider: 'anthropic', execute: vi.fn(async () => serverErrorResult('anthropic')) };
    const deepseek = { provider: 'deepseek', execute: vi.fn(async () => completedResult('deepseek')) };

    const svc = createAiSvc([openai, anthropic, deepseek]);
    const result = await runTask(svc);

    expect(result.invocation.status).toBe('completed');
    expect(openai.execute).toHaveBeenCalledTimes(1);
    expect(anthropic.execute).toHaveBeenCalledTimes(1);
    expect(deepseek.execute).toHaveBeenCalledTimes(1);
    expect(result.invocation.attempted_models).toHaveLength(3);
    expect(result.invocation.fallback_used).toBe(true);
  });

  it('falls back to anthropic even on openai auth error (different provider keys)', async () => {
    const openai = { provider: 'openai', execute: vi.fn(async () => authErrorResult('openai')) };
    const anthropic = { provider: 'anthropic', execute: vi.fn(async () => completedResult('anthropic')) };

    const svc = createAiSvc([openai, anthropic]);
    const result = await runTask(svc);

    // auth error on OpenAI → still fallback to Anthropic (different API keys)
    expect(result.invocation.status).toBe('completed');
    expect(openai.execute).toHaveBeenCalledTimes(1);
    expect(anthropic.execute).toHaveBeenCalledTimes(1);
  });

  it('returns error when all providers fail', async () => {
    const openai = { provider: 'openai', execute: vi.fn(async () => serverErrorResult('openai')) };
    const anthropic = { provider: 'anthropic', execute: vi.fn(async () => serverErrorResult('anthropic')) };
    const deepseek = { provider: 'deepseek', execute: vi.fn(async () => serverErrorResult('deepseek')) };

    const svc = createAiSvc([openai, anthropic, deepseek]);

    await expect(runTask(svc)).rejects.toThrow();

    expect(openai.execute).toHaveBeenCalledTimes(1);
    expect(anthropic.execute).toHaveBeenCalledTimes(1);
    expect(deepseek.execute).toHaveBeenCalledTimes(1);
  });

  it('only calls primary when allow_fallback is false', async () => {
    const openai = { provider: 'openai', execute: vi.fn(async () => serverErrorResult('openai')) };
    const anthropic = { provider: 'anthropic', execute: vi.fn(async () => completedResult('anthropic')) };

    const registry = createMultiProviderRegistry();
    registry.routes[0].defaults!.allow_fallback = false;

    const gateway = createGateway([openai, anthropic], registry);
    const invocation = await gateway.execute({
      request: {
        invocation_id: 'inv-test-allow',
        task_id: 'task-test-allow',
        task_type: 'agent_decision',
        messages: [{ role: 'user', parts: [{ type: 'text', text: 'test' }] }],
        response_mode: 'json_object'
      },
      task_request: {
        task_id: 'task-test-allow',
        task_type: 'agent_decision',
        input: {},
        prompt_context: {}
      },
      task_config: {} as any
    });

    expect(invocation.status).toBe('failed');
    expect(invocation.attempted_models).toHaveLength(1);
    expect(invocation.attempted_models[0]).toContain('openai');
    expect(openai.execute).toHaveBeenCalledTimes(1);
    expect(anthropic.execute).not.toHaveBeenCalled();
  });

  it('skips provider not in adapter map and continues to next', async () => {
    const openai = { provider: 'openai', execute: vi.fn(async () => serverErrorResult('openai')) };
    const deepseek = { provider: 'deepseek', execute: vi.fn(async () => completedResult('deepseek')) };
    // anthropic adapter NOT registered

    const svc = createAiSvc([openai, deepseek]);
    const result = await runTask(svc);

    expect(result.invocation.status).toBe('completed');
    expect(openai.execute).toHaveBeenCalledTimes(1);
    expect(deepseek.execute).toHaveBeenCalledTimes(1);
    // anthropic 在 registry 中但这没有 adapter → 被跳过
    expect(result.invocation.attempted_models).toContain('anthropic:claude-sonnet-4-6');
  });
});

describe('AI gateway circuit breaker state persistence', () => {
  it('circuit breaker state persists across gateway.execute() calls (Phase 0 fix)', async () => {
    const failingOpenai = { provider: 'openai', execute: vi.fn(async () => serverErrorResult('openai')) };
    const anthropic = { provider: 'anthropic', execute: vi.fn(async () => completedResult('anthropic')) };

    const gateway = createGateway([failingOpenai, anthropic]);
    const svc = createAiTaskService({ gateway });

    // Call 1: OpenAI 失败 → fallback 到 Anthropic
    const result1 = await runTask(svc);
    expect(result1.invocation.status).toBe('completed');
    expect(failingOpenai.execute).toHaveBeenCalledTimes(1);
    // CB 记录了一次失败

    // Call 2-5: OpenAI 继续失败
    for (let i = 0; i < 4; i++) {
      await runTask(svc);
    }
    // 连续 5 次失败 → circuit breaker 应该 open

    // Call 6: OpenAI 应被 circuit breaker 直接拒绝
    const callCountBefore = failingOpenai.execute.mock.calls.length;
    const result6 = await runTask(svc);
    expect(result6.invocation.status).toBe('completed');
    // circuit breaker open → 不应该调用 OpenAI
    expect(failingOpenai.execute).toHaveBeenCalledTimes(callCountBefore);
    // 直接跳过到 Anthropic
  });
});
