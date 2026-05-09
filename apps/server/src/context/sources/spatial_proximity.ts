import type { SpatialRuntime } from '../../packs/runtime/spatial_runtime.js';
import type { ContextNode } from '../types.js';

export const buildSpatialProximityContextNodes = async (input: {
  entityId: string;
  spatialRuntime: SpatialRuntime;
  tick: string;
}): Promise<ContextNode[]> => {
  const { entityId, spatialRuntime, tick } = input;

  const location = await spatialRuntime.getLocation(entityId);
  if (!location) {
    return [];
  }

  const neighbors = spatialRuntime.neighbors(location);

  const lines: string[] = [];
  lines.push(`你当前在: ${location}`);
  if (neighbors.length > 0) {
    lines.push(`邻接地点: ${neighbors.join(', ')}`);
  }

  const node: ContextNode = {
    id: `ctx-spatial-proximity:${entityId}:${tick}`,
    node_type: 'spatial_proximity',
    scope: 'pack',
    source_kind: 'spatial_proximity',
    source_ref: { entity_id: entityId },
    actor_ref: null,
    content: {
      text: lines.join('\n'),
      structured: {
        current_location: location,
        adjacent_locations: neighbors
      }
    },
    tags: ['spatial', 'location', 'pack'],
    importance: 0.8,
    salience: 0.7,
    created_at: tick,
    occurred_at: tick,
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
      created_at_tick: tick,
      parent_node_ids: []
    }
  };

  return [node];
};
