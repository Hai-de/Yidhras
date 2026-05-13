import type { LocationState, SpatialRuntime } from '../../packs/runtime/spatial_runtime.js';
import type { ContextNode } from '../types.js';

export const buildSpatialProximityContextNodes = async (input: {
  entityId: string;
  spatialRuntime: SpatialRuntime;
  tick: string;
  investigatedLocationIds?: string[];
}): Promise<ContextNode[]> => {
  const { entityId, spatialRuntime, tick, investigatedLocationIds } = input;

  const location = await spatialRuntime.getLocation(entityId);
  if (!location) {
    return [];
  }

  const locationState = await spatialRuntime.getLocationState(location);
  const neighbors = spatialRuntime.neighbors(location);
  const hasInvestigated = investigatedLocationIds?.includes(location) ?? false;

  // Resolve neighbor labels concurrently
  const neighborStates = await Promise.all(
    neighbors.map((n) => spatialRuntime.getLocationState(n))
  );
  const neighborLabels = neighborStates.map(
    (s: LocationState | null, i: number) => s?.label ?? neighbors[i]
  );

  const lines: string[] = [];

  // Current location with label
  const label = locationState?.label ?? location;
  lines.push(`你当前在: ${label}`);

  // Public description (always visible)
  const publicDesc = locationState?.publicDescription ?? '';
  if (publicDesc) {
    lines.push(publicDesc);
  }

  // Hidden details (only after investigation)
  if (hasInvestigated) {
    const hiddenDetails = locationState?.hiddenDetails;
    if (hiddenDetails) {
      lines.push(`[调查发现] ${hiddenDetails}`);
    }
  }

  if (neighbors.length > 0) {
    lines.push(`邻接地点: ${neighborLabels.join(', ')}`);
  }

  const text = lines.join('\n');

  const node: ContextNode = {
    id: `ctx-spatial-proximity:${entityId}:${tick}`,
    node_type: 'spatial_proximity',
    scope: 'pack',
    source_kind: 'spatial_proximity',
    source_ref: { entity_id: entityId },
    actor_ref: null,
    content: {
      text,
      structured: {
        current_location: label,
        current_location_id: location,
        adjacent_locations: neighborLabels,
        adjacent_location_ids: neighbors,
        public_description: publicDesc || null,
        hidden_details: hasInvestigated ? (locationState?.hiddenDetails ?? null) : null,
        has_investigated: hasInvestigated
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
