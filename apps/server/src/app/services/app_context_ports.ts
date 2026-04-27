import type {
  PackRuntimeControl,
  PackRuntimeLookupPort,
  PackRuntimeObservation
} from '../../core/pack_runtime_ports.js';
import type { RuntimeSpeedSnapshot } from '../../core/runtime_speed.js';
import type { WorldPack } from '../../packs/manifest/loader.js';
import type { RuntimeDatabaseBootstrap } from '../runtime/runtime_bootstrap.js';
import type {
  ActivePackRuntimeProjectionPort,
  RuntimeClockProjectionService
} from '../runtime/runtime_clock_projection.js';
import type { PackHostApi, WorldEnginePort } from '../runtime/world_engine_ports.js';
import type { ContextAssemblyPort } from './context_memory_ports.js';

export interface ActivePackRuntimeFacade {
  init(packFolderName: string): Promise<void>;
  getActivePack(): WorldPack | undefined;
  resolvePackVariables(template: string, permission?: unknown, actorState?: Record<string, unknown> | null): string;
  getStepTicks(): bigint;
  getRuntimeSpeedSnapshot(): RuntimeSpeedSnapshot;
  setRuntimeSpeedOverride(stepTicks: bigint): void;
  clearRuntimeSpeedOverride(): void;
  getCurrentTick(): bigint;
  getCurrentRevision(): bigint;
  getAllTimes(): unknown;
  step(amount?: bigint): Promise<void>;
}

export interface HostRuntimeKernelFacade extends ActivePackRuntimeFacade, ActivePackRuntimeProjectionPort {}

export interface PackCatalogService {
  listAvailablePacks(): string[];
  getPacksDir(): string;
}

export interface PluginHostPort {
  syncActivePackRuntime?(context: unknown): Promise<void>;
  syncPackRuntime?(context: unknown, packId: string): Promise<void>;
  getRuntimeWebSnapshot?(context: unknown, packId: string, surface: 'stable' | 'experimental'): Promise<unknown>;
  resolveRuntimeWebAsset?(
    context: unknown,
    input: {
      packId: string;
      pluginId: string;
      installationId: string;
      assetPath: string;
      surface: 'stable' | 'experimental';
    }
  ): Promise<unknown>;
}

export interface AppContextPorts {
  runtimeBootstrap?: RuntimeDatabaseBootstrap;
  activePackRuntime?: ActivePackRuntimeFacade;
  packRuntimeObservation?: PackRuntimeObservation;
  packRuntimeControl?: PackRuntimeControl;
  packRuntimeLookup?: PackRuntimeLookupPort;
  worldEngine?: WorldEnginePort;
  packHostApi?: PackHostApi;
  runtimeClockProjection?: RuntimeClockProjectionService;
  contextAssembly?: ContextAssemblyPort;
}

export interface VisibleClockSnapshot {
  absolute_ticks: string;
  calendars: unknown;
  source: 'host_projection' | 'clock_fallback';
}

const resolveVisibleClockPackId = (input: {
  activePackRuntime?: { getActivePack(): WorldPack | undefined };
  activePack?: { getActivePack(): WorldPack | undefined };
}): string | null => {
  return input.activePackRuntime?.getActivePack()?.metadata.id?.trim()
    ?? input.activePack?.getActivePack()?.metadata.id?.trim()
    ?? null;
};

export const getActivePackRuntimeFacade = (input: {
  activePackRuntime?: ActivePackRuntimeFacade;
}): ActivePackRuntimeFacade => {
  if (input.activePackRuntime) {
    return input.activePackRuntime;
  }

  throw new Error('[app_context_ports] activePackRuntime port is required but not provided');
};

export const getRuntimeBootstrap = (input: {
  runtimeBootstrap?: RuntimeDatabaseBootstrap;
}): RuntimeDatabaseBootstrap => {
  if (input.runtimeBootstrap) {
    return input.runtimeBootstrap;
  }

  throw new Error('[app_context_ports] runtimeBootstrap port is required but not provided');
};

export const getPackRuntimeObservation = (input: {
  packRuntimeObservation?: PackRuntimeObservation;
}): PackRuntimeObservation => {
  if (input.packRuntimeObservation) {
    return input.packRuntimeObservation;
  }

  throw new Error('[app_context_ports] packRuntimeObservation port is required but not provided');
};

export const getPackRuntimeControl = (input: {
  packRuntimeControl?: PackRuntimeControl;
}): PackRuntimeControl => {
  if (input.packRuntimeControl) {
    return input.packRuntimeControl;
  }

  throw new Error('[app_context_ports] packRuntimeControl port is required but not provided');
};

export const getPackRuntimeLookupPort = (input: {
  packRuntimeLookup?: PackRuntimeLookupPort;
}): PackRuntimeLookupPort => {
  if (input.packRuntimeLookup) {
    return input.packRuntimeLookup;
  }

  throw new Error('[app_context_ports] packRuntimeLookup port is required but not provided');
};

export const getWorldEnginePort = (input: {
  worldEngine?: WorldEnginePort;
}): WorldEnginePort => {
  if (input.worldEngine) {
    return input.worldEngine;
  }

  throw new Error('[app_context_ports] worldEngine port is required but not provided');
};

export const getPackHostApi = (input: {
  packHostApi?: PackHostApi;
}): PackHostApi => {
  if (input.packHostApi) {
    return input.packHostApi;
  }

  throw new Error('[app_context_ports] packHostApi port is required but not provided');
};

export const hasWorldEnginePort = (context: AppContextPorts): context is AppContextPorts & {
  worldEngine: WorldEnginePort;
} => {
  return Boolean(context.worldEngine);
};

export const hasPackHostApi = (context: AppContextPorts): context is AppContextPorts & {
  packHostApi: PackHostApi;
} => {
  return Boolean(context.packHostApi);
};

export const readVisibleClockSnapshot = (input: {
  clock: { getCurrentTick(): bigint };
  activePack?: { getActivePack(): WorldPack | undefined };
  activePackRuntime?: { getActivePack(): WorldPack | undefined };
  runtimeClockProjection?: RuntimeClockProjectionService;
}): VisibleClockSnapshot => {
  const packId = resolveVisibleClockPackId({
    activePackRuntime: input.activePackRuntime,
    activePack: input.activePack
  });
  const projected = packId ? input.runtimeClockProjection?.readFormattedClock(packId) : null;

  if (projected) {
    return {
      absolute_ticks: projected.absolute_ticks,
      calendars: projected.calendars,
      source: 'host_projection'
    };
  }

  return {
    absolute_ticks: input.clock.getCurrentTick().toString(),
    calendars: [],
    source: 'clock_fallback'
  };
};
