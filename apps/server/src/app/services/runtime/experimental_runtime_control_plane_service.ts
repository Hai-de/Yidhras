import { createLogger } from '../../../utils/logger.js';
const ercLogger = createLogger('exp-runtime-control-plane');
import type { DataContext, PortContext, RuntimeContext } from '../../context.js';
import { getPackRuntimeLookupPort, getPackRuntimeObservation } from '../app_context_ports.js';

export interface ExperimentalPackRuntimeSnapshot {
  pack_id: string;
  mode: 'loaded';
  runtime_ready: boolean;
  status: 'loaded' | 'running' | 'paused' | 'stopped' | 'failed';
  message: string | null;
  current_tick: string;
  runtime_speed: {
    mode: 'variable' | 'adaptive';
    step_ticks: string;
    range: { min: string; max: string };
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
  loaded_pack_ids: string[];
  items: ExperimentalPackRuntimeSnapshot[];
  startup_errors: string[];
}

const toExperimentalRuntimeSpeedSnapshot = (snapshot: {
  mode: 'variable' | 'adaptive';
  effective_step_ticks: string;
  source: 'default' | 'world_pack' | 'override';
  strategy: { range: { min: bigint; max: bigint } };
}): ExperimentalPackRuntimeSnapshot['runtime_speed'] => ({
  mode: snapshot.mode,
  step_ticks: snapshot.effective_step_ticks,
  range: {
    min: snapshot.strategy.range.min.toString(),
    max: snapshot.strategy.range.max.toString()
  },
  overridden: snapshot.source === 'override'
});

const readEnabledPluginCount = async (context: DataContext & RuntimeContext & PortContext, packId: string): Promise<number> => {
  try {
    const installations = await context.repos.plugin.listInstallationsByScope({
      scope_type: 'pack_local',
      scope_ref: packId
    });
    return installations.filter(installation => installation.lifecycle_state === 'enabled').length;
  } catch (err: unknown) {
    ercLogger.warn('Plugin installation query failed', { error: err instanceof Error ? err : new Error(String(err)) });
    return 0;
  }
};

export const buildExperimentalRuntimeControlPlaneSnapshot = async (
  context: DataContext & RuntimeContext & PortContext
): Promise<ExperimentalRuntimeControlPlaneSnapshot> => {
// @ts-expect-error -- EOPT strict mode
  const lookup = getPackRuntimeLookupPort({
    packRuntimeLookup: context.packRuntimeLookup
  });
// @ts-expect-error -- EOPT strict mode
  const observation = getPackRuntimeObservation({
    packRuntimeObservation: context.packRuntimeObservation
  });

   
  const loadedPackIds = context.listLoadedPackRuntimeIds();

  const items = await Promise.all(
    loadedPackIds.map(async packId => {
      const summary = lookup.getPackRuntimeSummary(packId);
      const status = observation.getStatus(packId);
      const runtimeSpeed = observation.getRuntimeSpeedSnapshot(packId);
      const enabledPluginCount = await readEnabledPluginCount(context, packId);

      return {
        pack_id: packId,
        mode: 'loaded' as const,
        runtime_ready: context.isRuntimeReady(),
        status: status?.health_status ?? summary?.health_status ?? 'loaded',
        message: status?.message ?? null,
        current_tick: status?.current_tick ?? summary?.current_tick ?? '0',
        runtime_speed: toExperimentalRuntimeSpeedSnapshot(
          runtimeSpeed ?? {
            mode: 'variable' as const,
            effective_step_ticks: '1',
            source: 'default' as const,
            strategy: { range: { min: 1n, max: 1n } }
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
    runtime_ready: context.isRuntimeReady(),
    loaded_pack_ids: loadedPackIds,
    items,
    startup_errors: [...context.startupHealth.errors]
  };
};

export const buildExperimentalPackRuntimeSnapshot = async (
  context: DataContext & RuntimeContext & PortContext,
  packId: string
): Promise<ExperimentalPackRuntimeSnapshot | null> => {
  const snapshot = await buildExperimentalRuntimeControlPlaneSnapshot(context);
  return snapshot.items.find(item => item.pack_id === packId) ?? null;
};
