import type { LocationState, SpatialRuntime } from '../../packs/runtime/spatial_runtime.js';
import type { PerceptionRuleEngine } from '../../perception/rule_engine.js';
import type { ContextNode } from '../types.js';

export const buildSpatialProximityContextNodes = async (input: {
  entityId: string;
  spatialRuntime: SpatialRuntime;
  tick: string;
  agentCapabilities?: string[];
  investigationCounts?: Record<string, number>;
  perceptionRuleEngine?: PerceptionRuleEngine;
}): Promise<ContextNode[]> => {
  const {
    entityId, spatialRuntime, tick,
    agentCapabilities = [],
    investigationCounts = {},
    perceptionRuleEngine
  } = input;

  const location = await spatialRuntime.getLocation(entityId);
  if (!location) {
    return [];
  }

  const locationState = await spatialRuntime.getLocationState(location);
  const neighbors = spatialRuntime.neighbors(location);

  // Resolve neighbor labels concurrently
  const neighborStates = await Promise.all(
    neighbors.map((n) => spatialRuntime.getLocationState(n))
  );
  const neighborLabels = neighborStates.map(
    (s: LocationState | null, i: number) => s?.label ?? neighbors[i]
  );

  const investigationCount = investigationCounts[location] ?? 0;

  // Use unified perception engine for environment perception if available
  let visibleDescription = '';
  let hiddenDescription: string | null = null;
  let perceptionLevel: string | null = null;
  let matchedRuleId: string | null = null;

  if (perceptionRuleEngine) {
    const result = await perceptionRuleEngine.evaluate({
      location: {
        locationId: location,
        publicDescription: locationState?.publicDescription ?? null,
        hiddenDetails: locationState?.hiddenDetails ?? null,
        tags: locationState?.tags ?? []
      },
      observerEntityId: entityId,
      observerRelation: 'same',
      agentCapabilities,
      investigationCount
    });

    perceptionLevel = result.level;
    visibleDescription = result.visibleDescription;
    hiddenDescription = result.hiddenDescription;
    matchedRuleId = result.matchedRuleId;
  } else {
    // Fallback when no engine is provided (should not happen in production)
    const publicDesc = locationState?.publicDescription ?? '';
    if (publicDesc) {
      visibleDescription = publicDesc;
    }
    if (investigationCount > 0 && locationState?.hiddenDetails) {
      const hd = locationState.hiddenDetails;
      hiddenDescription = Array.isArray(hd) ? hd.join(' ') : hd;
    }
    perceptionLevel = investigationCount > 0 ? 'full' : 'partial';
  }

  // Build text representation
  const lines: string[] = [];
  const label = locationState?.label ?? location;
  lines.push(`你当前在: ${label}`);

  if (visibleDescription) {
    lines.push(visibleDescription);
  }

  if (hiddenDescription) {
    lines.push(`[调查发现] ${hiddenDescription}`);
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
        public_description: locationState?.publicDescription ?? null,
        hidden_details: investigationCount > 0 ? (locationState?.hiddenDetails ?? null) : null,
        has_investigated: investigationCount > 0,
        perception_level: perceptionLevel,
        matched_rule_id: matchedRuleId
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
