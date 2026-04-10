import type { ContextOverlayEntry } from '../overlay/types.js';
import type { ContextNode } from '../types.js';

const buildOverlayText = (entry: ContextOverlayEntry): string => {
  if (entry.title && entry.title.trim().length > 0) {
    return `${entry.title.trim()}\n${entry.content_text}`;
  }

  return entry.content_text;
};

const buildOverlayNodeType = (entry: ContextOverlayEntry): string => {
  switch (entry.overlay_type) {
    case 'self_note':
      return 'overlay_self_note';
    case 'target_dossier':
      return 'overlay_target_dossier';
    case 'system_summary':
      return 'overlay_system_summary';
    default:
      return 'overlay_entry';
  }
};

const buildPlacementPolicy = (entry: ContextOverlayEntry): ContextNode['placement_policy'] => {
  if (entry.overlay_type === 'system_summary') {
    return {
      preferred_slot: 'memory_summary',
      locked: false,
      tier: 'memory'
    };
  }

  return {
    preferred_slot: entry.persistence_mode === 'persistent' ? 'memory_long_term' : 'memory_short_term',
    locked: false,
    tier: 'memory'
  };
};

export const buildContextNodesFromOverlayEntries = (entries: ContextOverlayEntry[]): ContextNode[] => {
  return entries.map(entry => ({
    id: entry.id,
    node_type: buildOverlayNodeType(entry),
    scope: entry.created_by === 'system' ? 'system' : 'agent',
    source_kind: 'overlay',
    source_ref: {
      overlay_id: entry.id,
      overlay_type: entry.overlay_type,
      pack_id: entry.pack_id
    },
    actor_ref: entry.actor_id ? { agent_id: entry.actor_id } : null,
    content: {
      text: buildOverlayText(entry),
      ...(entry.content_structured ? { structured: entry.content_structured } : {}),
      raw: {
        overlay_type: entry.overlay_type,
        persistence_mode: entry.persistence_mode,
        status: entry.status
      }
    },
    tags: ['overlay', entry.overlay_type, ...entry.tags],
    importance: entry.overlay_type === 'system_summary' ? 0.9 : 0.7,
    salience: entry.persistence_mode === 'persistent' ? 0.85 : 0.75,
    confidence: 1,
    created_at: entry.created_at_tick,
    occurred_at: entry.updated_at_tick,
    expires_at: null,
    visibility: {
      level: 'writable_overlay',
      read_access: 'visible',
      policy_gate: 'allow',
      blocked: false
    },
    mutability: {
      level: 'overlay',
      can_summarize: true,
      can_reorder: true,
      can_hide: true
    },
    placement_policy: buildPlacementPolicy(entry),
    provenance: {
      created_by: entry.created_by,
      created_at_tick: entry.created_at_tick,
      parent_node_ids: entry.source_node_ids
    },
    metadata: {
      overlay_type: entry.overlay_type,
      overlay_status: entry.status,
      persistence_mode: entry.persistence_mode,
      title: entry.title,
      pack_id: entry.pack_id,
      actor_id: entry.actor_id
    }
  }));
};
