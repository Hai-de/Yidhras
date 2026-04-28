import type { WorldStateDeltaOperation } from '@yidhras/contracts';

interface StateTransformDefinition {
  source: string;
  ranges: Array<{ min: number; max: number; label: string }>;
  target: string;
}

interface ActorStateEntry {
  entity_id: string;
  state_json: Record<string, unknown>;
}

interface TransformsForActor {
  actorEntityId: string;
  currentStateJson: Record<string, unknown>;
  mergedStateJson: Record<string, unknown>;
  changed: boolean;
}

const isNumber = (value: unknown): value is number => {
  return typeof value === 'number' && Number.isFinite(value);
};

const findMatchingLabel = (
  value: number,
  ranges: Array<{ min: number; max: number; label: string }>
): string | null => {
  for (const range of ranges) {
    if (value >= range.min && value <= range.max) {
      return range.label;
    }
  }
  return null;
};

/**
 * Evaluate all state_transforms for all actors in the pack.
 *
 * Returns upsert_entity_state delta operations for any actor whose state_json
 * was modified by a transform. Reads the full current state_json, merges in
 * computed target keys, and emits a full replacement — matching the
 * upsert_entity_state semantics in world_engine_persistence.
 */
export const evaluateStateTransforms = (input: {
  packId: string;
  actorStates: ActorStateEntry[];
  transformDefs: StateTransformDefinition[];
  logDebug: (message: string, meta?: Record<string, unknown>) => void;
  logWarn: (message: string, meta?: Record<string, unknown>) => void;
}): WorldStateDeltaOperation[] => {
  const { packId, actorStates, transformDefs, logDebug, logWarn } = input;

  if (transformDefs.length === 0 || actorStates.length === 0) {
    return [];
  }

  const actorTransforms = new Map<string, TransformsForActor>();

  for (const actor of actorStates) {
    const current = { ...actor.state_json };
    actorTransforms.set(actor.entity_id, {
      actorEntityId: actor.entity_id,
      currentStateJson: current,
      mergedStateJson: current,
      changed: false
    });
  }

  for (const transform of transformDefs) {
    for (const [, entry] of actorTransforms) {
      const sourceValue = entry.mergedStateJson[transform.source];

      if (sourceValue === undefined || sourceValue === null) {
        logDebug('state_transform source key not found in actor state', {
          pack_id: packId,
          entity_id: entry.actorEntityId,
          source: transform.source,
          target: transform.target
        });
        continue;
      }

      if (!isNumber(sourceValue)) {
        logDebug('state_transform source value is not a number, skipping', {
          pack_id: packId,
          entity_id: entry.actorEntityId,
          source: transform.source,
          target: transform.target,
          actual_type: typeof sourceValue
        });
        continue;
      }

      const label = findMatchingLabel(sourceValue, transform.ranges);

      if (label === null) {
        logWarn('state_transform value outside all ranges, no target written', {
          pack_id: packId,
          entity_id: entry.actorEntityId,
          source: transform.source,
          target: transform.target,
          value: sourceValue,
          ranges: transform.ranges
        });
        continue;
      }

      entry.mergedStateJson = {
        ...entry.mergedStateJson,
        [transform.target]: label
      };
      entry.changed = true;
    }
  }

  const operations: WorldStateDeltaOperation[] = [];

  for (const [, entry] of actorTransforms) {
    if (!entry.changed) {
      continue;
    }

    operations.push({
      op: 'upsert_entity_state' as const,
      target_ref: entry.actorEntityId,
      namespace: 'core',
      payload: {
        next: entry.mergedStateJson,
        previous: entry.currentStateJson,
        reason: 'state_transform_evaluation'
      }
    });
  }

  return operations;
};
