import { createPluginStore } from '../../plugins/store.js';
import type { AppContext } from '../context.js';
import { getPackRuntimeLookupPort, getPackRuntimeObservation } from './app_context_ports.js';

export interface ExperimentalPackRuntimeSnapshot {
  pack_id: string;
  mode: 'active' | 'experimental_loaded';
  runtime_ready: boolean;
  status: 'loaded' | 'running' | 'paused' | 'stopped' | 'failed';
  message: string | null;
  current_tick: string;
  runtime_speed: {
    step_ticks: string;
    overridden: boolean;
  };
  scheduler: {
    summary_available: boolean;
    ownership_available: boolean;
    workers_available: boolean;
    operator_available: boolean;
  };
  plugin_runtime: {
    installed_enabled_plugin_count: number | null;
    web_surface_available: boolean;
  };
}

export interface ExperimentalRuntimeControlPlaneSnapshot {
  system_health_level: 'ok' | 'degraded' | 'fail';
  runtime_ready: boolean;
  active_pack_id: string | null;
  loaded_pack_ids: string[];
  items: ExperimentalPackRuntimeSnapshot[];
  startup_errors: string[];
}

const toExperimentalRuntimeSpeedSnapshot = (snapshot: {
  effective_step_ticks: string;
  source: 'default' | 'world_pack' | 'override';
}): ExperimentalPackRuntimeSnapshot['runtime_speed'] => ({
  step_ticks: snapshot.effective_step_ticks,
  overridden: snapshot.source === 'override'
});

const readEnabledPluginCount = async (context: AppContext, packId: string): Promise<number> => {
  if (!(context.prisma as Record<string, unknown>)?.pluginInstallation) {
    return 0;
  }

  const store = createPluginStore({ prisma: context.prisma });
  try {
    const installations = await store.listInstallationsByScope({
      scope_type: 'pack_local',
      scope_ref: packId
    });
    return installations.filter(installation => installation.lifecycle_state === 'enabled').length;
  } catch {
    return 0;
  }
};

export const buildExperimentalRuntimeControlPlaneSnapshot = async (
  context: AppContext
): Promise<ExperimentalRuntimeControlPlaneSnapshot> => {
  const lookup = getPackRuntimeLookupPort({
    packRuntimeLookup: context.packRuntimeLookup
  });
  const observation = getPackRuntimeObservation({
    packRuntimeObservation: context.packRuntimeObservation
  });

  const loadedPackIds = context.sim.getPackRuntimeRegistry().listLoadedPackIds();
  const activePackId = lookup.getActivePackId();

  const items = await Promise.all(
    loadedPackIds.map(async packId => {
      const summary = lookup.getPackRuntimeSummary(packId);
      const status = observation.getStatus(packId);
      const runtimeSpeed = observation.getRuntimeSpeedSnapshot(packId);
      const enabledPluginCount = await readEnabledPluginCount(context, packId);

      return {
        pack_id: packId,
        mode: activePackId === packId ? 'active' : 'experimental_loaded',
        runtime_ready: activePackId === packId && context.getRuntimeReady(),
        status: status?.health_status ?? summary?.health_status ?? 'loaded',
        message: status?.message ?? null,
        current_tick: status?.current_tick ?? summary?.current_tick ?? '0',
        runtime_speed: toExperimentalRuntimeSpeedSnapshot(
          runtimeSpeed ?? {
            effective_step_ticks: '1',
            source: 'default'
          }
        ),
        scheduler: {
          summary_available: true,
          ownership_available: true,
          workers_available: true,
          operator_available: true
        },
        plugin_runtime: {
          installed_enabled_plugin_count: enabledPluginCount,
          web_surface_available: enabledPluginCount > 0
        }
      } satisfies ExperimentalPackRuntimeSnapshot;
    })
  );

  return {
    system_health_level: context.startupHealth.level,
    runtime_ready: context.getRuntimeReady(),
    active_pack_id: activePackId,
    loaded_pack_ids: loadedPackIds,
    items,
    startup_errors: [...context.startupHealth.errors]
  };
};

export const buildExperimentalPackRuntimeSnapshot = async (
  context: AppContext,
  packId: string
): Promise<ExperimentalPackRuntimeSnapshot | null> => {
  const snapshot = await buildExperimentalRuntimeControlPlaneSnapshot(context);
  return snapshot.items.find(item => item.pack_id === packId) ?? null;
};
