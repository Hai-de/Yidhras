import { describe, expect, it, vi } from 'vitest';

import { createModelGateway } from '../../src/ai/gateway.js';
import { createGatewayBackedInferenceProvider } from '../../src/ai/providers/gateway_backed.js';
import type {
  AiProviderAdapter,
  AiProviderAdapterResult
} from '../../src/ai/providers/types.js';
import {
  type AiTaskService,
  createAiTaskService
} from '../../src/ai/task_service.js';
import type { AiRegistryConfig } from '../../src/ai/types.js';
import type { InferenceProvider } from '../../src/inference/provider.js';
import type {
  InferenceContext,
  PromptBundle,
  ProviderDecisionRaw
} from '../../src/inference/types.js';

// ── Fixtures ──

const createAgentDecisionPromptBundle = (): PromptBundle => ({
  system_prompt: 'system prompt',
  role_prompt: 'role prompt',
  world_prompt: 'world prompt',
  context_prompt: 'context prompt',
  output_contract_prompt: 'output contract prompt',
  combined_prompt: 'combined prompt',
  metadata: {
    prompt_version: 'test-v1',
    source_prompt_keys: []
  }
});

const createMinimalInferenceContext = (): InferenceContext => ({
  inference_id: 'inf-test-001',
  actor_ref: {
    identity_id: 'agent-001',
    identity_type: 'agent',
    role: 'active',
    agent_id: 'agent-001',
    atmosphere_node_id: null
  },
  actor_display_name: 'Test Agent',
  identity: {
    id: 'agent-001',
    type: 'agent',
    name: 'Test Agent',
    provider: null,
    status: null,
    claims: null
  },
  binding_ref: null,
  resolved_agent_id: 'agent-001',
  agent_snapshot: null,
  tick: 1000n,
  strategy: 'model_routed',
  attributes: {},
  world_pack: { id: 'test-pack', name: 'Test Pack', version: '1.0.0' },
  world_prompts: {},
  world_ai: null,
  visible_variables: {},
  variable_context: {
    layers: [],
    alias_precedence: ['request', 'actor', 'runtime', 'pack', 'app', 'system'],
    strict_namespace: false
  },
  variable_context_summary: {
    namespaces: [],
    alias_precedence: ['request', 'actor', 'runtime', 'pack', 'app', 'system'],
    strict_namespace: false,
    layer_count: 0
  },
  policy_summary: {
    social_post_read_allowed: true,
    social_post_readable_fields: ['id', 'content'],
    social_post_write_allowed: true,
    social_post_writable_fields: ['content']
  },
  transmission_profile: {
    policy: 'reliable',
    drop_reason: null,
    delay_ticks: '1',
    drop_chance: 0,
    derived_from: ['test']
  },
  context_run: {
    id: 'ctx-test-001',
    created_at_tick: '1000',
    selected_node_ids: [],
    nodes: [],
    diagnostics: {
      source_adapter_names: [],
      node_count: 0,
      node_counts_by_type: {},
      selected_node_ids: [],
      dropped_nodes: []
    }
  },
  memory_context: {
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
  },
  pack_state: {
    actor_roles: [],
    actor_state: null,
    owned_artifacts: [],
    world_state: null,
    latest_event: null
  },
  pack_runtime: { invocation_rules: [] }
});

const createCompletedAdapterResult = (): AiProviderAdapterResult => ({
  status: 'completed',
  finish_reason: 'stop',
  output: {
    mode: 'json_schema',
    json: {
      action_type: 'post_message',
      payload: { content: 'test message' },
      confidence: 0.9
    }
  },
  usage: { latency_ms: 1 },
  safety: { blocked: false, reason_code: null, provider_signal: null },
  raw_ref: { provider_request_id: 'req-mock', provider_response_id: 'resp-mock' },
  error: null
});

const createFailedAdapterResult = (): AiProviderAdapterResult => ({
  status: 'failed',
  finish_reason: 'error',
  output: { mode: 'json_schema' },
  safety: { blocked: false, reason_code: null, provider_signal: null },
  raw_ref: { provider_request_id: 'req-fail', provider_response_id: null },
  error: {
    code: 'TEST_FAIL',
    message: 'forced test failure',
    retryable: false,
    stage: 'provider'
  }
});

const createTestRegistry = (): AiRegistryConfig => ({
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
      tags: ['default', 'local'],
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

// ── Tests ──

describe('gateway_backed inference provider', () => {
  const completedAdapter: AiProviderAdapter = {
    provider: 'mock',
    execute: vi.fn(async () => createCompletedAdapterResult())
  };

  const createTestAiTaskService = (): AiTaskService => {
    const gateway = createModelGateway({
      registryConfig: createTestRegistry(),
      adapters: [completedAdapter]
    });
    return createAiTaskService({ gateway });
  };

  it('executes model_routed inference and returns completed decision', async () => {
    const aiTaskService = createTestAiTaskService();
    const provider: InferenceProvider = createGatewayBackedInferenceProvider({
      aiTaskService
    });

    const context = createMinimalInferenceContext();
    const promptBundle = createAgentDecisionPromptBundle();

    const decision: ProviderDecisionRaw = await provider.run(context, promptBundle);

    expect(decision.action_type).toBe('post_message');
    expect(decision.payload).toMatchObject({ content: 'test message' });
    expect(decision.confidence).toBe(0.9);
    expect((decision.meta as Record<string, unknown> | undefined)?.ai_invocation_id).toBeDefined();
  });

  it('falls back to FALLBACK_DECISION when ai task service throws', async () => {
    const failingAdapter: AiProviderAdapter = {
      provider: 'mock',
      execute: vi.fn(async () => createFailedAdapterResult())
    };

    const gateway = createModelGateway({
      registryConfig: createTestRegistry(),
      adapters: [failingAdapter]
    });
    // No fallback models configured → gateway returns failed
    const aiTaskService = createAiTaskService({ gateway });
    const provider: InferenceProvider = createGatewayBackedInferenceProvider({
      aiTaskService
    });

    const context = createMinimalInferenceContext();
    const promptBundle = createAgentDecisionPromptBundle();

    const decision: ProviderDecisionRaw = await provider.run(context, promptBundle);

    // Should fall back to FALLBACK_DECISION (idle action)
    expect(decision.action_type).toBe('idle');
    expect(decision.target_ref).toBeNull();
    expect(decision.payload).toMatchObject({ reason: 'ai_provider_unavailable' });
    expect(decision.confidence).toBe(0);
  });
});
