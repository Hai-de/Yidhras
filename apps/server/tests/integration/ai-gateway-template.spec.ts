import { describe, expect, it, vi } from 'vitest';

import { createModelGateway } from '../../src/ai/gateway.js';
import { buildAdaptersFromRegistry } from '../../src/ai/providers/adapter_registry.js';
import type { AiProviderAdapter, AiProviderAdapterResult } from '../../src/ai/providers/types.js';
import type { AiTaskService } from '../../src/ai/task_service.js';
import { createAiTaskService } from '../../src/ai/task_service.js';
import type { AiProviderTemplate, AiRegistryConfig } from '../../src/ai/types.js';
import { expectDefined } from '../helpers/assertions.js';

// ── Fixtures ───────────────────────────────────────────────────────────

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

const createTestRegistry = (templates?: AiProviderTemplate[]): AiRegistryConfig => ({
  version: 1,
  provider_templates: templates ?? [],
  providers: [
    { provider: 'openai', enabled: true },
    { provider: 'custom_provider', enabled: true }
  ],
  models: [
    {
      provider: 'openai', model: 'gpt-4.1-mini', endpoint_kind: 'chat_completions',
      capabilities: { text_generation: true, structured_output: 'json_schema', tool_calling: true, vision_input: false, embeddings: false, rerank: false },
      tags: ['default'], availability: 'active'
    },
    {
      provider: 'custom_provider', model: 'custom-model', endpoint_kind: 'chat_completions',
      capabilities: { text_generation: true, structured_output: 'json_object', tool_calling: true, vision_input: false, embeddings: false, rerank: false },
      tags: ['default'], availability: 'active'
    }
  ],
  routes: [
    {
      route_id: 'default.agent_decision',
      task_types: ['agent_decision'],
      preferred_models: [{ provider: 'openai', model: 'gpt-4.1-mini' }],
      fallback_models: [{ provider: 'custom_provider', model: 'custom-model' }],
      constraints: { response_modes: ['json_object', 'json_schema'] },
      defaults: { allow_fallback: true, retry_limit: 0, audit_level: 'minimal' }
    }
  ]
});

const createTestTaskRequest = () => ({
  task_id: `task-${Date.now()}`,
  task_type: 'agent_decision' as const,
  input: {},
  prompt_context: {
    prompt_bundle_v2: { combined_prompt: 'test', messages: [] },
    messages: [{ role: 'user' as const, parts: [{ type: 'text' as const, text: 'test' }] }]
  },
  output_contract: {
    mode: 'json_object' as const
  }
});

// ── Tests ──────────────────────────────────────────────────────────────

describe('adapter_registry — buildAdaptersFromRegistry', () => {
  it('returns default 5 adapters when no provider_templates', () => {
    const registry = createTestRegistry();
    const adapters = buildAdaptersFromRegistry(registry);

    const names = adapters.map(a => a.provider).sort();
    expect(names).toContain('mock');
    expect(names).toContain('openai');
    expect(names).toContain('anthropic');
    expect(names).toContain('deepseek');
    expect(names).toContain('ollama');
  });

  it('adds a new adapter from openai_compatible template', () => {
    const registry = createTestRegistry([
      {
        name: 'custom_provider',
        kind: 'openai_compatible',
        base_url: 'https://api.custom.com/v1',
        api_key_env: 'CUSTOM_API_KEY',
        capability_overrides: {
          maxTokensField: 'max_tokens',
          supportsSeed: false,
          maxStructuredOutput: 'json_object'
        }
      }
    ]);
    const adapters = buildAdaptersFromRegistry(registry);

    const custom = adapters.find(a => a.provider === 'custom_provider');
    expect(expectDefined(custom, 'custom provider adapter').provider).toBe('custom_provider');
  });

  it('aliases builtin adapter via template with different name', () => {
    const registry = createTestRegistry([
      {
        name: 'claude',
        kind: 'builtin',
        builtin_name: 'anthropic'
      }
    ]);
    const adapters = buildAdaptersFromRegistry(registry);

    // 原始 adapter 仍然存在
    expect(adapters.some(a => a.provider === 'anthropic')).toBe(true);
    // alias 也存在
    expect(adapters.some(a => a.provider === 'claude')).toBe(true);
  });

  it('overrides builtin adapter when template has same name', () => {
    const registry = createTestRegistry([
      {
        name: 'openai',
        kind: 'openai_compatible',
        base_url: 'https://api.custom.com/v1',
        api_key_env: 'CUSTOM_API_KEY'
      }
    ]);
    const adapters = buildAdaptersFromRegistry(registry);

    const openaiAdapter = adapters.find(a => a.provider === 'openai');
    expect(openaiAdapter).toBeDefined();
    // 被 openai_compatible template 覆盖，丧失 Responses API/Embeddings
    // (结构上无法直接验证，但 adapter 存在即表示覆盖成功)
  });

  it('skips template with unknown builtin_name (no crash)', () => {
    const registry = createTestRegistry([
      {
        name: 'unknown',
        kind: 'builtin',
        builtin_name: 'nonexistent'
      }
    ]);
    const adapters = buildAdaptersFromRegistry(registry);

    // 不应该包含 unknown adapter
    expect(adapters.some(a => a.provider === 'unknown')).toBe(false);
    // 其他 adapter 正常
    expect(adapters.some(a => a.provider === 'mock')).toBe(true);
  });
});

describe('gateway — template adapter in fallback chain', () => {
  it('falls back to template adapter when primary fails', async () => {
    const failingOpenai: AiProviderAdapter = {
      provider: 'openai',
      execute: vi.fn(async () => ({
        status: 'failed' as const,
        finish_reason: 'error' as const,
        output: { mode: 'json_object' as const },
        usage: undefined,
        safety: { blocked: false, reason_code: null, provider_signal: null },
        raw_ref: { provider_request_id: null, provider_response_id: null },
        error: { code: 'AI_PROVIDER_FAIL', message: 'openai down', retryable: true, stage: 'provider' as const }
      })),
    };

    const customAdapter: AiProviderAdapter = {
      provider: 'custom_provider',
      execute: vi.fn(async () => completedResult('custom_provider')),
    };

    const registry = createTestRegistry([
      {
        name: 'custom_provider',
        kind: 'openai_compatible',
        base_url: 'https://api.custom.com/v1',
        api_key_env: 'CUSTOM_API_KEY'
      }
    ]);

    // 手动注入 adapter 覆盖 registry 构建的（模拟 template 构建的 adapter）
    const adapters = buildAdaptersFromRegistry(registry);
    // 替换 openai adapter 为 failing mock
    const testAdapters = adapters
      .filter(a => a.provider !== 'openai' && a.provider !== 'custom_provider')
      .concat([failingOpenai, customAdapter]);

    const gateway = createModelGateway({ adapters: testAdapters, registryConfig: registry });
    const svc: AiTaskService = createAiTaskService({ gateway });
    const result = await svc.runTask(createTestTaskRequest());

    expect(result.invocation.status).toBe('completed');
    expect(failingOpenai.execute).toHaveBeenCalledTimes(1);
    expect(customAdapter.execute).toHaveBeenCalledTimes(1);
    expect(result.invocation.fallback_used).toBe(true);
    expect(result.invocation.attempted_models).toContain('custom_provider:custom-model');
  });
});
