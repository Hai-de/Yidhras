import type { PackRuntimeHandle } from '../../core/pack_runtime_handle.js';
import type { PackRuntimeStatusSnapshot } from '../../core/pack_runtime_health.js';
import type { PackRuntimeHost } from '../../core/pack_runtime_host.js';
import type { PackRuntimeRegistry } from '../../core/pack_runtime_registry.js';
import { syncExperimentalPackPluginRuntime } from '../../plugins/runtime.js';
import type { AppContext } from '../context.js';

export interface ExperimentalPackRuntimeRegistrySnapshot {
  loaded_pack_ids: string[];
  items: Array<{
    pack_id: string;
    current_tick: string;
    runtime_speed: ReturnType<PackRuntimeHandle['getRuntimeSpeedSnapshot']>;
    status: 'loaded' | 'running' | 'paused' | 'stopped' | 'failed';
    message?: string | null;
  }>;
}

export interface ExperimentalSystemHealthSnapshot {
  system_health_level: AppContext['startupHealth']['level'];
  runtime_ready: boolean;
  available_world_packs: string[];
  startup_errors: string[];
}

export const buildExperimentalPackRuntimeRegistrySnapshot = (
  registry: PackRuntimeRegistry
): ExperimentalPackRuntimeRegistrySnapshot => {
  const handles = registry.listHandles();
  return {
    loaded_pack_ids: registry.listLoadedPackIds(),
    items: handles.map(handle => ({
      pack_id: handle.pack_id,
      current_tick: handle.getClockSnapshot().current_tick,
      runtime_speed: handle.getRuntimeSpeedSnapshot(),
      status: handle.getHealthSnapshot().status,
      message: handle.getHealthSnapshot().message ?? null
    }))
  };
};

export const buildExperimentalSystemHealthSnapshot = (
  context: AppContext
): ExperimentalSystemHealthSnapshot => {
  return {
    system_health_level: context.startupHealth.level,
    runtime_ready: context.getRuntimeReady(),
    available_world_packs: [...context.startupHealth.available_world_packs],
    startup_errors: [...context.startupHealth.errors]
  };
};

export const getExperimentalPackRuntimeStatusSnapshot = (
  context: AppContext,
  packId: string
): PackRuntimeStatusSnapshot | null => {
  const handle = context.sim.getPackRuntimeHandle(packId);
  if (!handle) {
    return null;
  }

  return {
    pack_id: handle.pack_id,
    pack_folder_name: handle.pack_folder_name,
    health_status: handle.getHealthSnapshot().status,
    current_tick: handle.getClockSnapshot().current_tick,
    runtime_speed: handle.getRuntimeSpeedSnapshot(),
    startup_level: context.startupHealth.level,
    runtime_ready: context.sim.getActivePack()?.metadata.id === packId && context.getRuntimeReady(),
    message: handle.getHealthSnapshot().message ?? null
  };
};

export const loadExperimentalPackRuntime = async (
  context: AppContext,
  packRef: string
): Promise<{ handle: PackRuntimeHandle; loaded: boolean; already_loaded: boolean }> => {
  const result = await context.sim.loadExperimentalPackRuntime(packRef);
  await syncExperimentalPackPluginRuntime(context, result.handle.pack_id);
  return result;
};

export const unloadExperimentalPackRuntime = async (
  context: AppContext,
  packId: string
): Promise<{ acknowledged: true; unloaded: boolean }> => {
  return {
    acknowledged: true,
    unloaded: await context.sim.unloadExperimentalPackRuntime(packId)
  };
};

export const registerExperimentalPackRuntimeHost = (
  registry: PackRuntimeRegistry,
  packId: string,
  host: PackRuntimeHost
): PackRuntimeHandle => {
  registry.register(packId, host);
  return host.getHandle();
};
