import type { PackRuntimeHost } from '../../core/pack_runtime_host.js';
import type { RuntimeSpeedSnapshot } from '../../core/runtime_speed.js';
import type { WorldPack } from '../../packs/manifest/loader.js';
import type { AppContext } from '../context.js';

const getActiveHost = (context: AppContext): PackRuntimeHost | null => {
  const activeId = context.packRuntimeLookup?.getActivePackId();
  if (!activeId) return null;
  return context.getPackRuntimeHost?.(activeId) ?? null;
};

export const resolvePackTick = (
  context: AppContext,
  packRuntime?: { getCurrentTick(): bigint } | null
): bigint => {
  if (packRuntime) return packRuntime.getCurrentTick();
  const host = getActiveHost(context);
  if (host) return host.getCurrentTick();
  return 0n;
};

export const resolvePackRevision = (
  context: AppContext,
  packRuntime?: { getCurrentRevision(): bigint } | null
): bigint => {
  if (packRuntime) return packRuntime.getCurrentRevision();
  const host = getActiveHost(context);
  if (host) return host.getCurrentRevision();
  return 0n;
};

export const resolveActivePack = (
  context: AppContext,
  packRuntime?: { getPack(): WorldPack } | null
): WorldPack | undefined => {
  if (packRuntime) return packRuntime.getPack();
  const host = getActiveHost(context);
  if (host) return host.getPack();
  return undefined;
};

export const resolveRuntimeSpeed = (
  context: AppContext,
  packRuntime?: { getRuntimeSpeedSnapshot(): RuntimeSpeedSnapshot } | null
): RuntimeSpeedSnapshot => {
  if (packRuntime) return packRuntime.getRuntimeSpeedSnapshot();
  const host = getActiveHost(context);
  if (host) return host.getRuntimeSpeedSnapshot();
  return {
    mode: 'fixed',
    source: 'default',
    configured_step_ticks: null,
    override_step_ticks: null,
    override_since: null,
    effective_step_ticks: '1'
  };
};

export const resolveAllTimes = (
  context: AppContext,
  packRuntime?: { getAllTimes(): unknown } | null
): unknown => {
  if (packRuntime) return packRuntime.getAllTimes();
  const host = getActiveHost(context);
  if (host) return host.getAllTimes();
  return [];
};
