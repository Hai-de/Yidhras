import type {
  InferencePackStateSnapshot,
  InferencePolicySummary
} from '../../inference/types.js';
import type { ContextNode } from '../types.js';

const buildPolicySummaryText = (policySummary: InferencePolicySummary): string => {
  return [
    `Social post read allowed: ${policySummary.social_post_read_allowed}`,
    `Readable fields: ${policySummary.social_post_readable_fields.join(', ') || 'none'}`,
    `Social post write allowed: ${policySummary.social_post_write_allowed}`,
    `Writable fields: ${policySummary.social_post_writable_fields.join(', ') || 'none'}`
  ].join('\n');
};

const buildRecordExcerpt = (label: string, value: Record<string, unknown> | null): string => {
  if (!value || Object.keys(value).length === 0) {
    return `${label}: none`;
  }

  const preview = Object.entries(value)
    .slice(0, 6)
    .map(([key, entryValue]) => `${key}=${typeof entryValue === 'string' ? entryValue : JSON.stringify(entryValue)}`)
    .join(', ');

  return `${label}: ${preview}`;
};

const buildOwnedArtifactsText = (packState: InferencePackStateSnapshot): string => {
  if (packState.owned_artifacts.length === 0) {
    return 'Owned artifacts: none';
  }

  return `Owned artifacts: ${packState.owned_artifacts.map(artifact => artifact.id).join(', ')}`;
};

export const buildRuntimeStateContextNodes = (input: {
  tick: string;
  resolved_agent_id: string | null;
  policy_summary?: InferencePolicySummary | null;
  pack_state?: InferencePackStateSnapshot | null;
}): ContextNode[] => {
  const nodes: ContextNode[] = [];

  if (input.policy_summary) {
    nodes.push({
      id: `ctx-policy-summary:${input.resolved_agent_id ?? 'unknown'}:${input.tick}`,
      node_type: 'policy_summary',
      scope: 'system',
      source_kind: 'policy_summary',
      source_ref: input.resolved_agent_id ? { entity_id: input.resolved_agent_id } : null,
      actor_ref: null,
      content: {
        text: buildPolicySummaryText(input.policy_summary),
        structured: input.policy_summary as unknown as Record<string, unknown>
      },
      tags: ['policy', 'system'],
      importance: 0.95,
      salience: 0.9,
      created_at: input.tick,
      occurred_at: input.tick,
      expires_at: null,
      visibility: {
        level: 'visible_fixed',
        read_access: 'visible',
        policy_gate: 'allow',
        blocked: false
      },
      mutability: {
        level: 'fixed',
        can_summarize: false,
        can_reorder: false,
        can_hide: false
      },
      placement_policy: {
        preferred_slot: 'system_policy',
        locked: true,
        tier: 'system'
      },
      provenance: {
        created_by: 'system',
        created_at_tick: input.tick,
        parent_node_ids: []
      }
    });
  }

  if (!input.pack_state) {
    return nodes;
  }

  if (input.pack_state.actor_state) {
    nodes.push({
      id: `ctx-pack-actor-state:${input.resolved_agent_id ?? 'unknown'}:${input.tick}`,
      node_type: 'pack_actor_state_snapshot',
      scope: 'pack',
      source_kind: 'pack_state',
      source_ref: input.resolved_agent_id ? { entity_id: input.resolved_agent_id, state_namespace: 'core' } : null,
      actor_ref: null,
      content: {
        text: buildRecordExcerpt('Actor state', input.pack_state.actor_state),
        structured: input.pack_state.actor_state
      },
      tags: ['pack-state', 'actor-state'],
      importance: 0.85,
      salience: 0.8,
      created_at: input.tick,
      occurred_at: input.tick,
      expires_at: null,
      visibility: {
        level: 'visible_fixed',
        read_access: 'visible',
        policy_gate: 'allow',
        blocked: false
      },
      mutability: {
        level: 'fixed',
        can_summarize: true,
        can_reorder: false,
        can_hide: false
      },
      placement_policy: {
        preferred_slot: 'world_context',
        locked: false,
        tier: 'world'
      },
      provenance: {
        created_by: 'system',
        created_at_tick: input.tick,
        parent_node_ids: []
      }
    });
  }

  if (input.pack_state.world_state) {
    nodes.push({
      id: `ctx-pack-world-state:${input.tick}`,
      node_type: 'pack_world_state_snapshot',
      scope: 'pack',
      source_kind: 'world_state',
      source_ref: { entity_id: '__world__', state_namespace: 'world' },
      actor_ref: null,
      content: {
        text: buildRecordExcerpt('World state', input.pack_state.world_state),
        structured: input.pack_state.world_state
      },
      tags: ['pack-state', 'world-state'],
      importance: 0.8,
      salience: 0.75,
      created_at: input.tick,
      occurred_at: input.tick,
      expires_at: null,
      visibility: {
        level: 'visible_fixed',
        read_access: 'visible',
        policy_gate: 'allow',
        blocked: false
      },
      mutability: {
        level: 'fixed',
        can_summarize: true,
        can_reorder: false,
        can_hide: false
      },
      placement_policy: {
        preferred_slot: 'world_context',
        locked: false,
        tier: 'world'
      },
      provenance: {
        created_by: 'system',
        created_at_tick: input.tick,
        parent_node_ids: []
      }
    });
  }

  if (input.pack_state.owned_artifacts.length > 0) {
    nodes.push({
      id: `ctx-pack-owned-artifacts:${input.resolved_agent_id ?? 'unknown'}:${input.tick}`,
      node_type: 'owned_artifacts_snapshot',
      scope: 'pack',
      source_kind: 'pack_state',
      source_ref: input.resolved_agent_id ? { holder_agent_id: input.resolved_agent_id } : null,
      actor_ref: null,
      content: {
        text: buildOwnedArtifactsText(input.pack_state),
        structured: {
          artifacts: input.pack_state.owned_artifacts
        }
      },
      tags: ['pack-state', 'artifact-state'],
      importance: 0.75,
      salience: 0.7,
      created_at: input.tick,
      occurred_at: input.tick,
      expires_at: null,
      visibility: {
        level: 'visible_flexible',
        read_access: 'visible',
        policy_gate: 'allow',
        blocked: false
      },
      mutability: {
        level: 'flexible',
        can_summarize: true,
        can_reorder: true,
        can_hide: true
      },
      placement_policy: {
        preferred_slot: 'world_context',
        locked: false,
        tier: 'world'
      },
      provenance: {
        created_by: 'system',
        created_at_tick: input.tick,
        parent_node_ids: []
      }
    });
  }

  if (input.pack_state.latest_event) {
    nodes.push({
      id: `ctx-pack-latest-event:${input.pack_state.latest_event.event_id}`,
      node_type: 'pack_latest_event_snapshot',
      scope: 'pack',
      source_kind: 'pack_state',
      source_ref: { event_id: input.pack_state.latest_event.event_id },
      actor_ref: null,
      content: {
        text: `Latest pack event: ${input.pack_state.latest_event.title} (${input.pack_state.latest_event.type})`,
        structured: input.pack_state.latest_event as unknown as Record<string, unknown>
      },
      tags: ['pack-state', 'latest-event'],
      importance: 0.7,
      salience: 0.8,
      created_at: input.pack_state.latest_event.created_at,
      occurred_at: input.pack_state.latest_event.created_at,
      expires_at: null,
      visibility: {
        level: 'visible_flexible',
        read_access: 'visible',
        policy_gate: 'allow',
        blocked: false
      },
      mutability: {
        level: 'flexible',
        can_summarize: true,
        can_reorder: true,
        can_hide: true
      },
      placement_policy: {
        preferred_slot: 'world_context',
        locked: false,
        tier: 'world'
      },
      provenance: {
        created_by: 'system',
        created_at_tick: input.pack_state.latest_event.created_at,
        parent_node_ids: []
      }
    });
  }

  return nodes;
};
