import { describe, expect, it } from 'vitest';

import { buildWorkflowPromptBundle } from '../../../src/context/workflow/orchestrator.js';
import type { InferenceContext } from '../../../src/inference/types.js';
import type { MemoryContextPack } from '../../../src/memory/types.js';

const baseMemoryContext = {
  short_term: [],
  long_term: [],
  summaries: [],
  diagnostics: {
    selected_count: 0,
    skipped_count: 0,
    memory_selection: { selected_entry_ids: [], dropped: [] }
  }
} satisfies MemoryContextPack;

const createContext = (overrides: Partial<InferenceContext> = {}): InferenceContext => ({
  inference_id: 'inf-workflow-orchestrator-001',
  actor_ref: { identity_id: 'actor-001', identity_type: 'agent', role: 'active', agent_id: 'agent-001', atmosphere_node_id: null },
  actor_display_name: 'Agent One',
  identity: { id: 'actor-001', type: 'agent', name: 'Agent One', provider: null, status: null, claims: null },
  binding_ref: null,
  resolved_agent_id: 'agent-001',
  agent_snapshot: null,
  tick: 42n,
  agent_capabilities: [],
  strategy: 'model_routed',
  attributes: {},
  world_pack: { id: 'test-pack', name: 'Test Pack', version: '1.0.0' },
  world_prompts: { global_prefix: 'World rules', agent_persona: 'You are {{ actor_name }}.' },
  world_ai: null,
  visible_variables: {},
  variable_context: { layers: [] },
  variable_context_summary: { namespaces: [], layer_count: 0 },
  policy_summary: {
    social_post_read_allowed: true,
    social_post_readable_fields: ['id', 'content'],
    social_post_write_allowed: true,
    social_post_writable_fields: ['content']
  },
  transmission_profile: { policy: 'reliable', drop_reason: null, delay_ticks: '0', drop_chance: 0, derived_from: [] },
  context_run: {
    id: 'ctx-workflow-orchestrator-001',
    created_at_tick: '42',
    selected_node_ids: ['node-1'],
    nodes: [
      {
        id: 'node-1',
        node_type: 'manual_note',
        scope: 'agent',
        source_kind: 'manual',
        source_ref: null,
        content: { text: 'Important memory note' },
        tags: [],
        importance: 1,
        salience: 1,
        created_at: '42',
        visibility: { level: 'visible_flexible', read_access: 'visible', blocked: false, policy_gate: 'allow' },
        mutability: { level: 'flexible', can_summarize: true, can_reorder: true, can_hide: true },
        placement_policy: { preferred_slot: null, locked: false, tier: 'memory' },
        provenance: { created_by: 'system', created_at_tick: '42' },
        metadata: {}
      }
    ],
    diagnostics: { source_adapter_names: [], node_count: 1, node_counts_by_type: { manual_note: 1 }, selected_node_ids: ['node-1'], dropped_nodes: [] }
  },
  memory_context: baseMemoryContext,
  pack_state: { actor_roles: [], actor_state: null, owned_artifacts: [], world_state: null, latest_event: null, recent_events: [] },
  pack_runtime: { invocation_rules: [] },
  ...overrides
});

describe('prompt workflow orchestrator', () => {
  it('builds agent_decision bundle with track and step diagnostics', async () => {
    const { bundle } = await buildWorkflowPromptBundle({
      context: createContext(),
      taskType: 'agent_decision'
    });

    expect(bundle.metadata.workflow_task_type).toBe('agent_decision');
    expect(bundle.metadata.workflow_profile_id).toBe('agent-decision-default');
    expect(bundle.tree.metadata.workflow?.workflow_step_keys).toContain('finalize');
    expect(bundle.tree.metadata.processing_trace ?? bundle.tree.metadata.workflow).toBeDefined();
    expect(bundle.slots.system_core).toContain('Yidhras');
    expect(Object.values(bundle.slots).join('\n')).toContain('Important memory note');
  });

  it('injects conversation_history slot for chat profile', async () => {
    const { bundle } = await buildWorkflowPromptBundle({
      context: createContext({
        current_agent_id: 'agent-001',
        conversation_profile: 'chat-follow-up',
        agent_conversation_memory: {
          id: 'mem-1',
          owner_agent_id: 'agent-001',
          conversation_id: 'conv-1',
          entries: [
            {
              id: 'entry-1',
              turn_number: 1,
              speaker_agent_id: 'agent-002',
              kind: 'original',
              original_content: '你在调查什么？',
              current_content: '你在调查什么？',
              provenance: { operator: { kind: 'agent', id: 'agent-002' }, capability: 'conversation.record' },
              recorded_at: 1,
              modifications: []
            }
          ]
        }
      }),
      taskType: 'agent_decision',
      profileId: 'chat-follow-up'
    });

    expect(bundle.metadata.workflow_profile_id).toBe('chat-follow-up');
    expect(bundle.slots.conversation_history).toContain('你在调查什么');
  });
});
