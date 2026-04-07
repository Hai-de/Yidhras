import { listPackEntityStates } from './entity_state_repo.js';

export interface PackEntityStateProjectionRecord {
  entity_id: string;
  state_namespace: string;
  state_json: Record<string, unknown>;
}

export const listPackEntityStateProjectionRecords = async (
  packId: string
): Promise<PackEntityStateProjectionRecord[]> => {
  const states = await listPackEntityStates(packId);
  return states.map(state => ({
    entity_id: state.entity_id,
    state_namespace: state.state_namespace,
    state_json: state.state_json
  }));
};
