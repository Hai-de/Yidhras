import { describe, expect, it } from 'vitest';

import { runSnapshotTrack } from '../../src/context/workflow/tracks/snapshot_track.js';
import type { PromptSlotConfig } from '../../src/inference/prompt_slot_config.js';
import type { InferenceContext } from '../../src/inference/types.js';

const buildContext = (): InferenceContext =>
  ({
    actor_ref: { actor_id: 'a1', actor_type: 'agent', role: 'test', agent_id: 'ag1', identity_id: 'id1', actor_label: 'Test' },
    actor_display_name: 'Test',
    resolved_agent_id: 'ag1',
    agent_snapshot: null,
    identity: { id: 'id1', type: 'agent' },
    binding_ref: null,
    world_pack: { id: 'wp1', name: 'test', version: '1' },
    tick: 42n,
    strategy: 'mock',
    attributes: {},
    world_prompts: {},
    variable_context: { layers: [], alias_values: {} },
    variable_context_summary: { layer_count: 0, total_variables: 0 },
    context_run: { nodes: [], id: 'cr1', created_at_tick: '42', diagnostics: { source_adapter_names: [], node_count: 0, node_counts_by_type: {}, selected_node_ids: [], dropped_nodes: [] }, selected_node_ids: [] },
    memory_context: { short_term: [], long_term: [], summaries: [], diagnostics: { source_adapter_names: [], entry_counts: {}, total_entries: 0 } },
    pack_state: { actor_roles: [], actor_state: null, owned_artifacts: [], world_state: null, latest_event: null },
    pack_runtime: { invocation_rules: [] },
    inference_id: 'inf-1',
    visible_variables: {},
    policy_summary: { policies: [], active_policy_count: 0, query_count: 0 },
    transmission_profile: { profile: 'standard' }
  } as unknown as InferenceContext);

describe('runSnapshotTrack', () => {
  it('generates post_process section when slot is enabled', () => {
    const registry: Record<string, PromptSlotConfig> = {
      post_process: {
        id: 'post_process',
        display_name: 'Post Process',
        default_priority: 10,
        include_in_combined: false,
        enabled: true
      }
    };
    const { result, trace } = runSnapshotTrack(buildContext(), registry);

    expect(result).toHaveLength(1);
    expect(result[0].track).toBe('snapshot');
    expect(result[0].section_type).toBe('context_snapshot');
    expect(result[0].slot).toBe('post_process');
    expect(result[0].removable).toBe(true);
    expect(result[0].content_blocks[0]).toMatchObject({ kind: 'json' });
    expect(trace.track).toBe('snapshot');
  });

  it('returns empty when post_process is disabled', () => {
    const registry: Record<string, PromptSlotConfig> = {
      post_process: {
        id: 'post_process',
        display_name: 'Post Process',
        default_priority: 10,
        include_in_combined: false,
        enabled: false
      }
    };
    const { result, trace } = runSnapshotTrack(buildContext(), registry);

    expect(result).toHaveLength(0);
    expect(trace.decisions[0]).toMatchObject({ reason: 'post_process slot disabled' });
  });
});
