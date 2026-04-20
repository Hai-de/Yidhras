import type { PackRuntimeHandle } from '../../core/pack_runtime_handle.js';
import type { PackRuntimeStatusSnapshot } from '../../core/pack_runtime_health.js';
import type { PackRuntimeHost } from '../../core/pack_runtime_host.js';
import type { PackRuntimeRegistry } from '../../core/pack_runtime_registry.js';
import { syncExperimentalPackPluginRuntime } from '../../plugins/runtime.js';
import type { AppContext } from '../context.js';
import {
  getPackRuntimeControl,
  getPackRuntimeLookupPort,
  getPackRuntimeObservation
} from './app_context_ports.js';

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
  const observation = getPackRuntimeObservation({
    packRuntimeObservation: context.packRuntimeObservation,
    sim: context.sim
  });
  const snapshot = observation.getStatus(packId);
  if (!snapshot) {
    return null;
  }

  const runtimeReadyPackId = getPackRuntimeLookupPort({
    packRuntimeLookup: context.packRuntimeLookup,
    sim: context.sim
  }).getActivePackId();

  return {
    ...snapshot,
    startup_level: context.startupHealth.level,
    runtime_ready: runtimeReadyPackId === packId && context.getRuntimeReady(),
    message: snapshot.message ?? null
  };
};

export const loadExperimentalPackRuntime = async (
  context: AppContext,
  packRef: string
): Promise<{ handle: PackRuntimeHandle; loaded: boolean; already_loaded: boolean }> => {
  const result = await getPackRuntimeControl({
    packRuntimeControl: context.packRuntimeControl,
    sim: context.sim
  }).load(packRef);
  await syncExperimentalPackPluginRuntime(context, result.handle.pack_id);
  return result;
};

export const unloadExperimentalPackRuntime = async (
  context: AppContext,
  packId: string
): Promise<{ acknowledged: true; unloaded: boolean }> => {
  return {
    acknowledged: true,
    unloaded: await getPackRuntimeControl({
      packRuntimeControl: context.packRuntimeControl,
      sim: context.sim
    }).unload(packId)
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
