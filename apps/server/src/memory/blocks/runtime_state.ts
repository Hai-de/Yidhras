import type { MemoryRuntimeState } from './types.js';

export const createInitialMemoryRuntimeState = (memoryId: string): MemoryRuntimeState => {
  return {
    memory_id: memoryId,
    trigger_count: 0,
    last_triggered_tick: null,
    last_inserted_tick: null,
    cooldown_until_tick: null,
    delayed_until_tick: null,
    retain_until_tick: null,
    currently_active: false,
    last_activation_score: null,
    recent_distance_from_latest_message: null
  };
};
