import type { ContextNode } from '../../context/types.js';
import type { MemoryActivationEvaluation, MemoryBehavior, MemoryBlock } from './types.js';

const buildMemoryBlockNodeType = (block: MemoryBlock): string => {
  switch (block.kind) {
    case 'fact':
      return 'memory_block_fact';
    case 'reflection':
      return 'memory_block_reflection';
    case 'plan':
      return 'memory_block_plan';
    case 'dossier':
      return 'memory_block_dossier';
    case 'rule':
      return 'memory_block_rule';
    case 'hypothesis':
      return 'memory_block_hypothesis';
    case 'reminder':
      return 'memory_block_reminder';
    case 'summary':
      return 'memory_block_summary';
    default:
      return 'memory_block';
  }
};

const buildPlacementPolicy = (behavior: MemoryBehavior): ContextNode['placement_policy'] => {
  return {
    preferred_slot: behavior.placement.slot,
    locked: false,
    tier: 'memory'
  };
};

const buildVisibility = (): ContextNode['visibility'] => {
  return {
    level: 'visible_flexible',
    read_access: 'visible',
    policy_gate: 'allow',
    blocked: false
  };
};

const buildMutability = (): ContextNode['mutability'] => {
  return {
    level: 'flexible',
    can_summarize: true,
    can_reorder: true,
    can_hide: true
  };
};

export const materializeMemoryBlockToContextNode = (input: {
  block: MemoryBlock;
  behavior: MemoryBehavior;
  evaluation: MemoryActivationEvaluation;
}): ContextNode => {
  const { block, behavior, evaluation } = input;
  const titlePrefix = block.title && block.title.trim().length > 0 ? `${block.title.trim()}\n` : '';

  return {
    id: block.id,
    node_type: buildMemoryBlockNodeType(block),
    scope: 'agent',
    source_kind: 'manual',
    source_ref: {
      memory_block_id: block.id,
      source_kind: block.source_ref?.source_kind ?? null,
      source_id: block.source_ref?.source_id ?? null,
      source_message_id: block.source_ref?.source_message_id ?? null
    },
    actor_ref: block.owner_agent_id ? { agent_id: block.owner_agent_id } : null,
    content: {
      text: `${titlePrefix}${block.content_text}`,
      ...(block.content_structured ? { structured: block.content_structured } : {}),
      raw: {
        kind: block.kind,
        source_ref: block.source_ref
      }
    },
    tags: ['memory_block', `memory_kind:${block.kind}`, ...block.tags],
    importance: block.importance,
    salience: block.salience,
    confidence: block.confidence,
    created_at: block.created_at_tick,
    occurred_at: block.updated_at_tick,
    expires_at: null,
    visibility: buildVisibility(),
    mutability: buildMutability(),
    placement_policy: buildPlacementPolicy(behavior),
    provenance: {
      created_by: 'system',
      created_at_tick: block.created_at_tick,
      parent_node_ids: []
    },
    metadata: {
      memory_block_id: block.id,
      memory_kind: block.kind,
      activation_score: evaluation.activation_score,
      activation_status: evaluation.status,
      triggered_by: evaluation.matched_triggers,
      placement_anchor: behavior.placement.anchor,
      placement_depth: behavior.placement.depth,
      placement_order: behavior.placement.order,
      placement_mode: behavior.placement.mode,
      recent_distance_from_latest_message: evaluation.recent_distance_from_latest_message,
      source_message_id: block.source_ref?.source_message_id ?? null,
      source_kind: block.source_ref?.source_kind ?? null,
      title: block.title
    }
  };
};
