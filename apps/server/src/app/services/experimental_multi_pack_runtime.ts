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
import {
  buildExperimentalPackRuntimeSnapshot,
  buildExperimentalRuntimeControlPlaneSnapshot,
  type ExperimentalPackRuntimeSnapshot,
  type ExperimentalRuntimeControlPlaneSnapshot
} from './experimental_runtime_control_plane_service.js';

export { type ExperimentalPackRuntimeSnapshot, type ExperimentalRuntimeControlPlaneSnapshot } from './experimental_runtime_control_plane_service.js';

export type ExperimentalPackRuntimeRegistrySnapshot = ExperimentalRuntimeControlPlaneSnapshot;

export interface ExperimentalSystemHealthSnapshot {
  system_health_level: AppContext['startupHealth']['level'];
  runtime_ready: boolean;
  available_world_packs: string[];
  startup_errors: string[];
}

export const buildExperimentalPackRuntimeRegistrySnapshot = async (
  context: AppContext
): Promise<ExperimentalPackRuntimeRegistrySnapshot> => {
  return buildExperimentalRuntimeControlPlaneSnapshot(context);
};

export const buildExperimentalSystemHealthSnapshot = (
  context: AppContext
): ExperimentalSystemHealthSnapshot => {
  return {
    system_health_level: context.startupHealth.level,
    runtime_ready: context.sim.isRuntimeReady(),
    available_world_packs: [...context.startupHealth.available_world_packs],
    startup_errors: [...context.startupHealth.errors]
  };
};

export const getExperimentalPackRuntimeStatusSnapshot = async (
  context: AppContext,
  packId: string
): Promise<PackRuntimeStatusSnapshot & { control_plane?: ExperimentalPackRuntimeSnapshot } | null> => {
  const observation = getPackRuntimeObservation({
    packRuntimeObservation: context.packRuntimeObservation
  });
  const snapshot = observation.getStatus(packId);
  if (!snapshot) {
    return null;
  }

  const runtimeReadyPackId = getPackRuntimeLookupPort({
    packRuntimeLookup: context.packRuntimeLookup
  }).getActivePackId();
  const controlPlane = await buildExperimentalPackRuntimeSnapshot(context, packId);

  return {
    ...snapshot,
    startup_level: context.startupHealth.level,
    runtime_ready: runtimeReadyPackId === packId && context.sim.isRuntimeReady(),
    message: snapshot.message ?? null,
    control_plane: controlPlane ?? undefined
  };
};

export const loadExperimentalPackRuntime = async (
  context: AppContext,
  packRef: string
): Promise<{ handle: PackRuntimeHandle; loaded: boolean; already_loaded: boolean }> => {
  const result = await getPackRuntimeControl({
    packRuntimeControl: context.packRuntimeControl
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
      packRuntimeControl: context.packRuntimeControl
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
