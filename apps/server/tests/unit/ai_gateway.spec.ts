import { describe, expect, it, vi } from 'vitest';

import { adaptPromptBundleToAiMessages } from '../../src/ai/adapters/prompt_bundle_adapter.js';
import { createModelGateway } from '../../src/ai/gateway.js';
import type { AiProviderAdapter, AiProviderAdapterResult } from '../../src/ai/providers/types.js';
import { resolveAiRoute } from '../../src/ai/route_resolver.js';
import { resolveAiTaskConfig } from '../../src/ai/task_definitions.js';
import { createAiTaskService } from '../../src/ai/task_service.js';
import type { AiRegistryConfig, AiTaskRequest, ModelGatewayResponse } from '../../src/ai/types.js';

const createAgentDecisionTaskRequest = (): AiTaskRequest => ({
  task_id: 'task-agent-decision',
  task_type: 'agent_decision',
  pack_id: 'world-death-note',
  actor_ref: { agent_id: 'agent-001', actor_display_name: '夜神月' },
  input: {
    actor_display_name: '夜神月',
    world_name: '死亡笔记',
    attributes: {
      mock_action_type: 'post_message'
    },
    inference_id: 'inf-001'
  },
  prompt_context: {
    prompt_bundle: {
      system_prompt: 'system prompt',
      role_prompt: 'role prompt',
      world_prompt: 'world prompt',
      context_prompt: 'context prompt',
      output_contract_prompt: 'output contract prompt',
      combined_prompt: 'combined prompt',
      metadata: {
        source_prompt_keys: ['global_prefix', 'agent_initial_context']
      }
    }
  },
  metadata: {
    inference_id: 'inf-001'
  }
});

const createCompletedStructuredResult = (content: string): AiProviderAdapterResult => ({
  status: 'completed',
  finish_reason: 'stop',
  output: {
    mode: 'json_schema',
    json: {
      action_type: 'post_message',
      payload: {
        content
      }
    }
  },
  usage: {
    latency_ms: 1
  },
  safety: {
    blocked: false,
    reason_code: null,
    provider_signal: null
  },
  raw_ref: {
    provider_request_id: 'req-mock',
    provider_response_id: 'resp-mock'
  },
  error: null
});

const createFailedStructuredResult = (): AiProviderAdapterResult => ({
  status: 'failed',
  finish_reason: 'error',
  output: {
    mode: 'json_schema'
  },
  safety: {
    blocked: false,
    reason_code: null,
    provider_signal: null
  },
  raw_ref: {
    provider_request_id: 'req-openai',
    provider_response_id: null
  },
  error: {
    code: 'OPENAI_FAIL',
    message: 'forced openai failure',
    retryable: false,
    stage: 'provider'
  }
});

const createMockOnlyRegistry = (): AiRegistryConfig => ({
  version: 1,
  providers: [{ provider: 'mock', enabled: true }],
  models: [
    {
      provider: 'mock',
      model: 'mock-default',
      endpoint_kind: 'custom_http',
      capabilities: {
        text_generation: true,
        structured_output: 'json_schema',
        tool_calling: false,
        vision_input: false,
        embeddings: false,
        rerank: false
      },
      tags: ['default'],
      availability: 'active'
    }
  ],
  routes: [
    {
      route_id: 'default.agent_decision',
      task_types: ['agent_decision'],
      preferred_models: [{ provider: 'mock', model: 'mock-default' }],
      fallback_models: [],
      constraints: { response_modes: ['json_schema'] },
      defaults: { allow_fallback: false, audit_level: 'standard' }
    }
  ]
});

const createFallbackRegistry = (): AiRegistryConfig => ({
  version: 1,
  providers: [
    { provider: 'openai', enabled: true },
    { provider: 'mock', enabled: true }
  ],
  models: [
    {
      provider: 'openai',
      model: 'openai-primary',
      endpoint_kind: 'responses',
      capabilities: {
        text_generation: true,
        structured_output: 'json_schema',
        tool_calling: false,
        vision_input: false,
        embeddings: false,
        rerank: false
      },
      tags: ['default'],
      availability: 'active'
    },
    {
      provider: 'mock',
      model: 'mock-fallback',
      endpoint_kind: 'custom_http',
      capabilities: {
        text_generation: true,
        structured_output: 'json_schema',
        tool_calling: false,
        vision_input: false,
        embeddings: false,
        rerank: false
      },
      tags: ['fallback'],
      availability: 'active'
    }
  ],
  routes: [
    {
      route_id: 'default.agent_decision',
      task_types: ['agent_decision'],
      preferred_models: [{ provider: 'openai', model: 'openai-primary' }],
      fallback_models: [{ provider: 'mock', model: 'mock-fallback' }],
      defaults: { allow_fallback: true, audit_level: 'standard' }
    }
  ]
});

describe('ai gateway unit', () => {
  it('resolves pack-aware route and prioritizes explicit model hint without failing when the hinted model is absent from route candidates', () => {
    const selected = resolveAiRoute({
      task_type: 'agent_decision',
      pack_id: 'world-death-note',
      response_mode: 'json_schema',
      route_hint: {
        provider: 'openai',
        model: 'missing-model'
      },
      task_override: {
        route: {
          provider: 'openai',
          model: 'gpt-4.1'
        }
      }
    });

    expect(selected.route.route_id).toBe('default.agent_decision');
    expect(selected.primary_model_candidates.length).toBeGreaterThan(0);
    expect(selected.primary_model_candidates[0]?.provider).toBe('openai');
  });

  it('adapts prompt bundle into structured ai messages and merges task config from pack overrides', () => {
    const taskConfig = resolveAiTaskConfig({
      taskType: 'agent_decision',
      packAiConfig: {
        defaults: {
          prompt_preset: 'default_decision_v1',
          decoder: 'default_json_schema',
          route_id: 'default.agent_decision',
          privacy_tier: 'trusted_cloud'
        },
        tasks: {
          agent_decision: {
            prompt: {
              preset: 'death_note_agent_decision_v1',
              system_append: 'system append',
              developer_append: 'developer append',
              include_sections: ['pack_rules', 'recent_events']
            },
            parse: {
              required_fields: ['action_type', 'payload']
            }
          }
        }
      }
    });

    expect(taskConfig.prompt.preset).toBe('death_note_agent_decision_v1');
    expect(taskConfig.route.route_id).toBe('default.agent_decision');
    expect(taskConfig.parse.required_fields).toEqual(['action_type', 'payload']);

    const messages = adaptPromptBundleToAiMessages({
      promptBundle: createAgentDecisionTaskRequest().prompt_context.prompt_bundle!,
      taskConfig
    });

    expect(messages).toHaveLength(3);
    expect(messages[0]?.role).toBe('system');
    expect(messages[1]?.role).toBe('developer');
    expect(messages[2]?.role).toBe('user');
    expect(messages[0]?.parts[0]?.type).toBe('text');
  });

  it('executes through mock gateway and returns decoded structured output', async () => {
    const mockAdapter: AiProviderAdapter = {
      provider: 'mock',
      execute: vi.fn(async () => createCompletedStructuredResult('mock-only success'))
    };

    const mockOnlyGateway = createModelGateway({
      registryConfig: createMockOnlyRegistry(),
      adapters: [mockAdapter]
    });

    const taskService = createAiTaskService({ gateway: mockOnlyGateway });
    const result = await taskService.runTask<Record<string, unknown>>(createAgentDecisionTaskRequest(), {
      packAiConfig: null
    });

    expect(result.output.action_type).toBe('post_message');
    expect(result.invocation.provider).toBe('mock');
    expect(result.invocation.status).toBe('completed');
    expect(result.invocation.trace?.task_type).toBe('agent_decision');
  });

  it('falls back to the next candidate when the primary provider fails and records attempts', async () => {
    const failingAdapter: AiProviderAdapter = {
      provider: 'openai',
      execute: vi.fn(async () => createFailedStructuredResult())
    };

    const fallbackAdapter: AiProviderAdapter = {
      provider: 'mock',
      execute: vi.fn(async () => createCompletedStructuredResult('fallback success'))
    };

    const gateway = createModelGateway({
      registryConfig: createFallbackRegistry(),
      adapters: [failingAdapter, fallbackAdapter]
    });

    const request = createAgentDecisionTaskRequest();
    const taskConfig = resolveAiTaskConfig({
      taskType: 'agent_decision',
      packAiConfig: null
    });
    const messages = adaptPromptBundleToAiMessages({
      promptBundle: request.prompt_context.prompt_bundle!,
      taskConfig
    });

    const response: ModelGatewayResponse = await gateway.execute({
      request: {
        invocation_id: 'inv-fallback',
        task_id: request.task_id,
        task_type: request.task_type,
        provider_hint: null,
        model_hint: null,
        route_id: 'default.agent_decision',
        messages,
        response_mode: 'json_schema',
        structured_output: {
          schema_name: 'agent_decision_schema',
          json_schema: taskConfig.output.schema!,
          strict: true
        },
        tools: [],
        tool_policy: { mode: 'disabled' },
        execution: {
          timeout_ms: 1000,
          retry_limit: 0,
          allow_fallback: true,
          idempotency_key: null
        },
        governance: {
          audit_level: 'standard',
          privacy_tier: 'trusted_cloud',
          safety_profile: null
        },
        metadata: {
          inference_id: 'inf-001'
        }
      },
      task_request: request,
      task_config: taskConfig
    });

    expect(response.status).toBe('completed');
    expect(response.provider).toBe('mock');
    expect(response.fallback_used).toBe(true);
    expect(response.attempted_models).toEqual(['openai:openai-primary', 'mock:mock-fallback']);
    expect(response.trace?.attempts).toHaveLength(2);
    expect(response.trace?.attempts[0]?.provider).toBe('openai');
    expect(response.trace?.attempts[1]?.provider).toBe('mock');
  });
});
