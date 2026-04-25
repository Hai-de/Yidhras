import { bench, describe } from 'vitest';

import { adaptPromptBundleToAiMessages } from '../../src/ai/adapters/prompt_bundle_adapter.js';
import { adaptPromptTreeToAiMessages } from '../../src/ai/adapters/prompt_tree_adapter.js';
import { resolveAiRoute } from '../../src/ai/route_resolver.js';
import { decodeAiTaskOutput } from '../../src/ai/task_decoder.js';
import type { AiResolvedTaskConfig, AiTaskRequest, ModelGatewayResponse } from '../../src/ai/types.js';
import type { PromptBundleV2 } from '../../src/inference/prompt_bundle_v2.js';

// --- Shared test data ---

const createAgentDecisionRequest = (): AiTaskRequest => ({
  task_id: 'task-agent-decision',
  task_type: 'agent_decision',
  pack_id: 'world-death-note',
  actor_ref: { agent_id: 'agent-001', actor_display_name: '夜神月' },
  input: { world_name: '死亡笔记', attributes: {}, inference_id: 'inf-001' },
  prompt_context: {
    prompt_bundle: {
      system_prompt: 'System prompt content here.',
      role_prompt: 'Role: Agent X.',
      world_prompt: 'World: Death Note universe.',
      context_prompt: 'Current tick: 1000.',
      output_contract_prompt: 'Return JSON.',
      combined_prompt: 'Combined prompt.',
      metadata: {
        prompt_version: 'phase-b-v1',
        source_prompt_keys: ['global_prefix'],
        workflow_task_type: 'agent_decision',
        workflow_profile_id: 'agent-decision-default',
        workflow_profile_version: '1',
        workflow_step_keys: ['memory_projection', 'placement_resolution'],
        processing_trace: {
          processor_names: ['memory-injector'],
          fragment_count_before: 4,
          fragment_count_after: 4,
          workflow_task_type: 'agent_decision',
          workflow_profile_id: 'agent-decision-default',
          workflow_profile_version: '1',
          workflow_step_keys: [],
          fragments: [],
          prompt_workflow: { task_type: 'agent_decision', profile_id: 'agent-decision-default', profile_version: '1', selected_step_keys: [], section_summary: { total_sections: 0 }, placement_summary: { total_fragments: 0, resolved_with_anchor: 0, fallback_count: 0 }, step_traces: [] }
        }
      }
    }
  },
  metadata: { inference_id: 'inf-001', workflow_task_type: 'agent_decision', prompt_version: 'phase-b-v1', source_prompt_keys: ['global_prefix'] }
});

const createTaskConfig = (): AiResolvedTaskConfig => ({
  definition: { task_type: 'agent_decision', default_response_mode: 'json_schema', default_prompt_preset: 'test', default_decoder: 'default' },
  override: null,
  output: { mode: 'json_schema' },
  prompt: { preset: 'test', system_append: 'append' },
  parse: { decoder: 'default_json_schema' },
  route: {}
});

const createCompletedResponse = (): ModelGatewayResponse => ({
  invocation_id: 'inv-bench',
  task_id: 'task-bench',
  task_type: 'agent_decision',
  provider: 'mock',
  model: 'mock-default',
  route_id: null,
  fallback_used: false,
  attempted_models: ['mock:mock-default'],
  status: 'completed',
  finish_reason: 'stop',
  output: { mode: 'json_schema', json: { action_type: 'post_message', payload: { content: 'bench output' } } }
});

const BASE_SLOTS: Record<string, unknown> = {
  system_core: { id: 'system_core', display_name: 'System Core', default_priority: 100, message_role: 'system', include_in_combined: true, combined_heading: 'System', enabled: true },
  system_policy: { id: 'system_policy', display_name: 'Policy', default_priority: 95, message_role: 'system', include_in_combined: true, combined_heading: 'Policy', enabled: true },
  role_core: { id: 'role_core', display_name: 'Role', default_priority: 90, message_role: 'developer', include_in_combined: true, combined_heading: 'Role', enabled: true },
  output_contract: { id: 'output_contract', display_name: 'Output', default_priority: 50, message_role: 'user', include_in_combined: true, combined_heading: null, enabled: true },
  post_process: { id: 'post_process', display_name: 'Post', default_priority: 60, message_role: 'user', include_in_combined: true, combined_heading: null, enabled: true }
};

const createV2Bundle = (): PromptBundleV2 => ({
  slots: {
    system_core: 'Core system instruction.',
    system_policy: 'Policy content.',
    role_core: 'Role: Agent X.',
    output_contract: 'Return JSON decision.',
    post_process: '{ "snapshot": true }'
  },
  combined_prompt: 'Core system instruction.\n\nPolicy content.\n\nRole: Agent X.\n\n{ "snapshot": true }\n\nReturn JSON decision.',
  metadata: { prompt_version: 'phase-c-v1', source_prompt_keys: ['system_core'], workflow_task_type: 'agent_decision', workflow_profile_id: 'agent-decision-default', workflow_profile_version: '1', workflow_step_keys: [] },
  tree: { inference_id: 'inf-test', task_type: 'agent_decision', fragments_by_slot: {}, slot_registry: BASE_SLOTS as Record<string, never>, metadata: { prompt_version: 'phase-c-v1', profile_id: null, profile_version: null, source_prompt_keys: ['system_core'] } }
});

// --- Benchmarks ---

describe('inference benchmarks', () => {
  describe('resolveAiRoute', () => {
    const routeInput = { task_type: 'agent_decision' as const, response_mode: 'json_schema' as const };

    bench('resolve route for agent_decision', () => {
      resolveAiRoute(routeInput);
    });

    bench('resolve route for context_summary', () => {
      resolveAiRoute({ task_type: 'context_summary', response_mode: 'json_schema' });
    });

    bench('resolve route with pack hint', () => {
      resolveAiRoute({ task_type: 'agent_decision', pack_id: 'world-death-note', response_mode: 'json_schema' });
    });
  });

  describe('adaptPromptBundleToAiMessages', () => {
    const request = createAgentDecisionRequest();
    const config = createTaskConfig();
    const bundle = request.prompt_context.prompt_bundle!;

    bench('adapt prompt bundle to messages', () => {
      adaptPromptBundleToAiMessages({ promptBundle: bundle, taskConfig: config });
    });
  });

  describe('adaptPromptTreeToAiMessages', () => {
    const v2 = createV2Bundle();
    const config = createTaskConfig();

    bench('adapt prompt tree v2 to messages', () => {
      adaptPromptTreeToAiMessages(v2, config);
    });
  });

  describe('decodeAiTaskOutput', () => {
    const response = createCompletedResponse();
    const config = createTaskConfig();

    bench('decode json_schema output', () => {
      decodeAiTaskOutput(response, config);
    });
  });
});
