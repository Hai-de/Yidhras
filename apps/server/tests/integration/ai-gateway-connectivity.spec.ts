import { config as dotenvConfig } from 'dotenv';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

dotenvConfig({ path: resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '.env') });

import { describe, expect, it } from 'vitest';

import { createModelGateway } from '../../src/ai/gateway.js';
import type { AiRegistryConfig, ModelGatewayExecutionInput } from '../../src/ai/types.js';

const hasApiKey = typeof process.env.DEEPSEEK_API_KEY === 'string' && process.env.DEEPSEEK_API_KEY.trim().length > 0;

const registry: AiRegistryConfig = {
  version: 1,
  providers: [
    {
      provider: 'deepseek',
      api_key_env: 'DEEPSEEK_API_KEY',
      base_url: 'https://api.deepseek.com/v1',
      enabled: true,
      metadata: { strategy: 'deepseek_first' }
    }
  ],
  models: [
    {
      provider: 'deepseek',
      model: 'deepseek-chat',
      endpoint_kind: 'chat_completions',
      capabilities: {
        text_generation: true,
        structured_output: 'json_object',
        tool_calling: true,
        vision_input: false,
        embeddings: false,
        rerank: false,
        max_context_tokens: 131072,
        max_output_tokens: 8192
      },
      tags: ['default', 'deepseek-first'],
      availability: 'active',
      defaults: {
        timeout_ms: 30000,
        temperature: 0.2,
        max_output_tokens: 4096
      }
    }
  ],
  routes: [
    {
      route_id: 'default.agent_decision',
      task_types: ['agent_decision'],
      preferred_models: [{ provider: 'deepseek', model: 'deepseek-chat' }],
      fallback_models: [],
      constraints: {
        require_structured_output: false,
        privacy_tier: 'trusted_cloud'
      },
      defaults: {
        timeout_ms: 30000,
        retry_limit: 0,
        allow_fallback: false,
        audit_level: 'minimal'
      }
    }
  ]
};

const buildInput = (overrides?: Partial<ModelGatewayExecutionInput>): ModelGatewayExecutionInput => ({
  request: {
    invocation_id: 'connectivity-test',
    task_id: 'connectivity-task',
    task_type: 'agent_decision',
    messages: [{ role: 'user', parts: [{ type: 'text', text: '你是小🐷吗？' }] }],
    response_mode: 'free_text',
    sampling: { temperature: 0, max_output_tokens: 100 }
  },
  task_request: {
    task_id: 'connectivity-task',
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
  ...overrides
});

describe.runIf(hasApiKey)('AI Gateway to DeepSeek connectivity', () => {
  it('responds to a simple "Hello" message', async () => {
    const gateway = createModelGateway({ registryConfig: registry });
    const result = await gateway.execute(buildInput());

    expect(result.status).toBe('completed');
    expect(result.provider).toBe('deepseek');
    expect(result.model).toBe('deepseek-chat');
    expect(result.output.text).toBeTruthy();

    console.log(`[connectivity] provider=${result.provider} model=${result.model}`);
    console.log(`[connectivity] finish_reason=${result.finish_reason}`);
    console.log(`[connectivity] usage input=${result.usage?.input_tokens} output=${result.usage?.output_tokens}`);
    console.log(`[connectivity] response text:\n${result.output.text}`);
  }, 30000);
});
