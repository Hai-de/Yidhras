import { describe, expect, it, vi } from 'vitest';

import { adaptPromptBundleToAiMessages } from '../../src/ai/adapters/prompt_bundle_adapter.js';
import { createModelGateway } from '../../src/ai/gateway.js';
import type { AiProviderAdapter, AiProviderAdapterResult } from '../../src/ai/providers/types.js';
import { resolveAiRoute } from '../../src/ai/route_resolver.js';
import { resolveAiTaskConfig } from '../../src/ai/task_definitions.js';
import { buildAiTaskRequestFromInferenceContext } from '../../src/ai/task_prompt_builder.js';
import { createAiTaskService } from '../../src/ai/task_service.js';
import type { AiRegistryConfig, AiTaskRequest, ModelGatewayResponse } from '../../src/ai/types.js';
import type { InferenceContext } from '../../src/inference/types.js';
import type { MemoryContextPack } from '../../src/memory/types.js';

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
        prompt_version: 'phase-b-v1',
        source_prompt_keys: ['global_prefix', 'agent_initial_context'],
        workflow_task_type: 'agent_decision',
        workflow_profile_id: 'agent-decision-default',
        workflow_profile_version: '1',
        workflow_step_keys: ['legacy_memory_projection', 'placement_resolution'],
        processing_trace: {
          processor_names: ['memory-injector', 'prompt-workflow:placement_resolution'],
          fragment_count_before: 4,
          fragment_count_after: 4,
          workflow_task_type: 'agent_decision',
          workflow_profile_id: 'agent-decision-default',
          workflow_profile_version: '1',
          workflow_step_keys: ['legacy_memory_projection', 'placement_resolution'],
          fragments: [],
          prompt_workflow: {
            task_type: 'agent_decision',
            profile_id: 'agent-decision-default',
            profile_version: '1',
            selected_step_keys: ['legacy_memory_projection', 'placement_resolution'],
            section_summary: {
              total_sections: 2
            },
            placement_summary: {
              total_fragments: 4,
              resolved_with_anchor: 1,
              fallback_count: 0
            },
            step_traces: []
          }
        }
      }
    }
  },
  metadata: {
    inference_id: 'inf-001',
    prompt_version: 'phase-b-v1',
    source_prompt_keys: ['global_prefix', 'agent_initial_context'],
    workflow_task_type: 'agent_decision',
    workflow_profile_id: 'agent-decision-default',
    workflow_profile_version: '1',
    workflow_step_keys: ['legacy_memory_projection', 'placement_resolution']
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
  it('builds context_summary and memory_compaction ai task requests with task-aware workflow metadata', async () => {
    const baseMemoryContext = {
      short_term: [],
      long_term: [],
      summaries: [],
      diagnostics: {
        selected_count: 0,
        skipped_count: 0,
        memory_selection: {
          selected_entry_ids: [],
          dropped: []
        }
      }
    } satisfies MemoryContextPack;

    const inferenceContext = {
      inference_id: 'inf-task-aware-001',
      actor_ref: { identity_id: 'agent-001', identity_type: 'agent', role: 'active', agent_id: 'agent-001', atmosphere_node_id: null },
      actor_display_name: '夜神月',
      identity: { id: 'agent-001', type: 'agent', name: '夜神月', provider: null, status: null, claims: null },
      binding_ref: null,
      resolved_agent_id: 'agent-001',
      agent_snapshot: null,
      tick: 1000n,
      strategy: 'model_routed',
      attributes: {},
      world_pack: { id: 'world-death-note', name: '死亡笔记', version: '0.4.0' },
      world_prompts: {},
      world_ai: null,
      visible_variables: {},
      policy_summary: {
        social_post_read_allowed: true,
        social_post_readable_fields: ['id', 'content'],
        social_post_write_allowed: true,
        social_post_writable_fields: ['content']
      },
      transmission_profile: { policy: 'reliable', drop_reason: null, delay_ticks: '1', drop_chance: 0, derived_from: ['test'] },
      context_run: {
        id: 'ctx-task-aware-001',
        created_at_tick: '1000',
        selected_node_ids: [],
        nodes: [],
        diagnostics: { source_adapter_names: [], node_count: 0, node_counts_by_type: {}, selected_node_ids: [], dropped_nodes: [] }
      },
      memory_context: baseMemoryContext,
      pack_state: { actor_roles: [], actor_state: null, owned_artifacts: [], world_state: null, latest_event: null },
      pack_runtime: { invocation_rules: [] }
    } satisfies InferenceContext;

    const contextSummaryRequest = await buildAiTaskRequestFromInferenceContext(inferenceContext, { task_type: 'context_summary' });
    expect(contextSummaryRequest.task_type).toBe('context_summary');
    expect(contextSummaryRequest.prompt_context.prompt_bundle?.metadata?.workflow_task_type).toBe('context_summary');
    expect(contextSummaryRequest.prompt_context.prompt_bundle?.metadata?.workflow_profile_id).toBe('context-summary-default');
    expect(contextSummaryRequest.prompt_context.prompt_bundle?.metadata?.workflow_section_summary).toMatchObject({
      task_type: 'context_summary',
      section_policy: 'minimal',
      section_scores: expect.any(Array),
      section_policies: ['evidence_first']
    });

    const memoryCompactionRequest = await buildAiTaskRequestFromInferenceContext(inferenceContext, { task_type: 'memory_compaction' });
    expect(memoryCompactionRequest.task_type).toBe('memory_compaction');
    expect(memoryCompactionRequest.prompt_context.prompt_bundle?.metadata?.workflow_task_type).toBe('memory_compaction');
    expect(memoryCompactionRequest.prompt_context.prompt_bundle?.metadata?.workflow_profile_id).toBe('memory-compaction-default');
    expect(memoryCompactionRequest.prompt_context.prompt_bundle?.metadata?.workflow_section_summary).toMatchObject({
      task_type: 'memory_compaction',
      section_policy: 'minimal',
      section_scores: expect.any(Array),
      section_policies: ['memory_focused']
    });
  });

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

  it('adapts prompt bundle into structured ai messages and carries workflow metadata', () => {
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
    expect(messages[0]?.metadata).toMatchObject({
      workflow_task_type: 'agent_decision',
      workflow_profile_id: 'agent-decision-default',
      workflow_profile_version: '1',
      workflow_step_keys: ['legacy_memory_projection', 'placement_resolution'],
      workflow_section_summary: {
        total_sections: 2
      },
      workflow_placement_summary: {
        total_fragments: 4,
        resolved_with_anchor: 1,
        fallback_count: 0
      }
    });
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
    expect(result.invocation.trace?.workflow_task_type).toBe('agent_decision');
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
          inference_id: 'inf-001',
          workflow_profile_id: 'agent-decision-default'
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
