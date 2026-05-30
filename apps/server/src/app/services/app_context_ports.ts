import type {
  PackRuntimeControl,
  PackRuntimeLookupPort,
  PackRuntimeObservation
} from '../../core/pack_runtime_ports.js';
import type { PackManifestLoader } from '../../packs/manifest/loader.js';
import type { RuntimeDatabaseBootstrap } from '../runtime/runtime_bootstrap.js';
import type {
  RuntimeClockProjectionService
} from '../runtime/runtime_clock_projection.js';
import type { PackHostApi, WorldEnginePort } from '../runtime/world_engine_ports.js';
import type { ContextAssemblyPort } from './context/context_memory_ports.js';

export interface PackCatalogService {
  listAvailablePacks(): string[];
  getPacksDir(): string;
  resolveByInstanceId(instanceId: string): { packFolderName: string } | null;
  getLoader(): PackManifestLoader;
}

export interface PluginHostPort {
  syncPackRuntime?(context: unknown, packId: string): Promise<void>;
  getRuntimeWebSnapshot?(context: unknown, packId: string): Promise<unknown>;
  resolveRuntimeWebAsset?(
    context: unknown,
    input: {
      packId: string;
      pluginId: string;
      installationId: string;
      assetPath: string;
    }
  ): Promise<unknown>;
}

export interface AppContextPorts {
  runtimeBootstrap?: RuntimeDatabaseBootstrap;
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

export const getRuntimeBootstrap = (input: {
  runtimeBootstrap?: RuntimeDatabaseBootstrap | undefined;
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
  runtimeClockProjection?: RuntimeClockProjectionService;
  packId?: string;
}): VisibleClockSnapshot => {
  const projection = input.runtimeClockProjection;
  if (!projection) {
    return { absolute_ticks: '0', calendars: [], source: 'clock_fallback' };
  }

  if (input.packId) {
    const projected = projection.readFormattedClock(input.packId);
    if (projected) {
      return {
        absolute_ticks: projected.absolute_ticks,
        calendars: projected.calendars,
        source: 'host_projection'
      };
    }
    return { absolute_ticks: '0', calendars: [], source: 'clock_fallback' };
  }

  for (const packId of projection.getKnownPackIds()) {
    const projected = projection.readFormattedClock(packId);
    if (projected) {
      return {
        absolute_ticks: projected.absolute_ticks,
        calendars: projected.calendars,
        source: 'host_projection'
      };
    }
  }

  return { absolute_ticks: '0', calendars: [], source: 'clock_fallback' };
};
