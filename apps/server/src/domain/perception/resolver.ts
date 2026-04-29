import type { AppInfrastructure } from '../../app/context.js';
import type { InferencePackStateSnapshot } from '../../inference/types.js';
import { listPackEntityStates } from '../../packs/storage/entity_state_repo.js';

export interface PerceptionDecisionItem {
  state_namespace: string;
  entity_id: string;
  visible: boolean;
  reason: string;
}

export interface PerceptionResolutionResult {
  visible_state_entries: Array<{
    entity_id: string;
    state_namespace: string;
    state_json: Record<string, unknown>;
  }>;
  hidden_state_entries: PerceptionDecisionItem[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const buildPackStateVisibilitySet = (packState: InferencePackStateSnapshot): Set<string> => {
  const visible = new Set<string>();

  if (packState.actor_state) {
    visible.add(`actor:core`);
  }
  if (packState.world_state) {
    visible.add(`__world__:world`);
  }
  for (const artifact of packState.owned_artifacts) {
    visible.add(`${artifact.id}:core`);
  }

  return visible;
};

export const resolvePerceptionForSubject = async (
  context: AppInfrastructure,
  input: {
    packId: string;
    packState: InferencePackStateSnapshot;
  }
): Promise<PerceptionResolutionResult> => {
  const states = await listPackEntityStates(context.packStorageAdapter, input.packId);
  const visibleSet = buildPackStateVisibilitySet(input.packState);

  const visible_state_entries: PerceptionResolutionResult['visible_state_entries'] = [];
  const hidden_state_entries: PerceptionDecisionItem[] = [];

  for (const state of states) {
    const visibilityKey = `${state.entity_id}:${state.state_namespace}`;
    if (visibleSet.has(visibilityKey)) {
      visible_state_entries.push({
        entity_id: state.entity_id,
        state_namespace: state.state_namespace,
        state_json: state.state_json
      });
      continue;
    }

    hidden_state_entries.push({
      entity_id: state.entity_id,
      state_namespace: state.state_namespace,
      visible: false,
      reason: 'not_in_current_subject_perception_window'
    });
  }

  return {
    visible_state_entries,
    hidden_state_entries
  };
};

export const filterProjectionReadableFields = <T extends Record<string, unknown>>(
  record: T,
  allowedFields: string[]
): Partial<T> => {
  const allowed = new Set(allowedFields);
  const output: Partial<T> = {};
  for (const [key, value] of Object.entries(record)) {
    if (allowed.has(key) && isRecord(output)) {
// eslint-disable-next-line security/detect-object-injection -- 从内部枚举构造的键
      (output as Record<string, unknown>)[key] = value;
    }
  }
  return output;
};
