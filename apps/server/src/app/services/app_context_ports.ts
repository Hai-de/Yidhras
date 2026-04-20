import type { PackRuntimeHandle } from '../../core/pack_runtime_handle.js';
import type { PackRuntimeStatusSnapshot } from '../../core/pack_runtime_health.js';
import type {
  PackRuntimeControl,
  PackRuntimeLocator,
  PackRuntimeLookupPort,
  PackRuntimeObservation
} from '../../core/pack_runtime_ports.js';
import type { RuntimeSpeedSnapshot } from '../../core/runtime_speed.js';
import type { WorldPack } from '../../packs/manifest/loader.js';
import type { RuntimeDatabaseBootstrap } from '../runtime/runtime_bootstrap.js';
import type { RuntimeKernelFacade } from '../runtime/runtime_kernel_ports.js';
import type { PackHostApi, WorldEnginePort } from '../runtime/world_engine_ports.js';
import type { ContextAssemblyPort, MemoryRuntimePort } from './context_memory_ports.js';

export interface ActivePackRuntimeFacade {
  init(packFolderName: string): Promise<void>;
  getActivePack(): WorldPack | undefined;
  resolvePackVariables(template: string, permission?: unknown): string;
  getStepTicks(): bigint;
  getRuntimeSpeedSnapshot(): RuntimeSpeedSnapshot;
  setRuntimeSpeedOverride(stepTicks: bigint): void;
  clearRuntimeSpeedOverride(): void;
  getCurrentTick(): bigint;
  getAllTimes(): unknown;
  step(amount?: bigint): Promise<void>;
}

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
  packCatalog?: PackCatalogService;
  packRuntimeLocator?: PackRuntimeLocator;
  packRuntimeObservation?: PackRuntimeObservation;
  packRuntimeControl?: PackRuntimeControl;
  packRuntimeLookup?: PackRuntimeLookupPort;
  runtimeKernel?: RuntimeKernelFacade;
  worldEngine?: WorldEnginePort;
  packHostApi?: PackHostApi;
  pluginHost?: PluginHostPort;
  contextAssembly?: ContextAssemblyPort;
  memoryRuntime?: MemoryRuntimePort;
}

export const getActivePackRuntimeFacade = (input: {
  activePackRuntime?: ActivePackRuntimeFacade;
  sim: ActivePackRuntimeFacade;
}): ActivePackRuntimeFacade => {
  return input.activePackRuntime ?? input.sim;
};

export const getRuntimeBootstrap = (input: {
  runtimeBootstrap?: RuntimeDatabaseBootstrap;
  sim: RuntimeDatabaseBootstrap;
}): RuntimeDatabaseBootstrap => {
  return input.runtimeBootstrap ?? input.sim;
};

export const getPackRuntimeObservation = (input: {
  packRuntimeObservation?: PackRuntimeObservation;
  sim: {
    getPackRuntimeHandle(packId: string): PackRuntimeHandle | null;
    getPackRuntimeStatusSnapshot(packId: string): PackRuntimeStatusSnapshot | null;
  };
}): PackRuntimeObservation => {
  if (input.packRuntimeObservation) {
    return input.packRuntimeObservation;
  }

  return {
    getStatus: packId => {
      if (typeof input.sim.getPackRuntimeStatusSnapshot === 'function') {
        return input.sim.getPackRuntimeStatusSnapshot(packId);
      }

      const handle = input.sim.getPackRuntimeHandle(packId);
      if (!handle) {
        return null;
      }

      return {
        pack_id: handle.pack_id,
        pack_folder_name: handle.pack_folder_name,
        health_status: handle.getHealthSnapshot().status,
        current_tick: handle.getClockSnapshot().current_tick,
        runtime_speed: handle.getRuntimeSpeedSnapshot(),
        startup_level: 'degraded' as const,
        runtime_ready: false,
        message: handle.getHealthSnapshot().message ?? null
      };
    },
    listStatuses: () => [],
    getClockSnapshot: packId => input.sim.getPackRuntimeHandle(packId)?.getClockSnapshot() ?? null,
    getRuntimeSpeedSnapshot: packId => input.sim.getPackRuntimeHandle(packId)?.getRuntimeSpeedSnapshot() ?? null
  };
};

export const getPackRuntimeControl = (input: {
  packRuntimeControl?: PackRuntimeControl;
  sim: {
    loadExperimentalPackRuntime(packRef: string): Promise<{
      handle: PackRuntimeHandle;
      loaded: boolean;
      already_loaded: boolean;
    }>;
    unloadExperimentalPackRuntime(packId: string): Promise<boolean>;
  };
}): PackRuntimeControl => {
  if (input.packRuntimeControl) {
    return input.packRuntimeControl;
  }

  return {
    load: packRef => input.sim.loadExperimentalPackRuntime(packRef),
    unload: packId => input.sim.unloadExperimentalPackRuntime(packId)
  };
};

export const getPackRuntimeLookupPort = (input: {
  packRuntimeLookup?: PackRuntimeLookupPort;
  sim: {
    getActivePack(): WorldPack | undefined;
    getPackRuntimeHandle(packId: string): PackRuntimeHandle | null;
  };
}): PackRuntimeLookupPort => {
  if (input.packRuntimeLookup) {
    return input.packRuntimeLookup;
  }

  return {
    getActivePackId: () => input.sim.getActivePack()?.metadata.id ?? null,
    hasPackRuntime: packId => input.sim.getPackRuntimeHandle(packId) !== null,
    assertPackScope: (packId, _mode, _feature) => packId.trim(),
    getPackRuntimeSummary: packId => {
      const handle = input.sim.getPackRuntimeHandle(packId);
      if (!handle) {
        return null;
      }

      return {
        pack_id: handle.pack_id,
        pack_folder_name: handle.pack_folder_name,
        health_status: handle.getHealthSnapshot().status,
        current_tick: handle.getClockSnapshot().current_tick,
        runtime_ready: input.sim.getActivePack()?.metadata.id === handle.pack_id
      };
    }
  };
};

export const getWorldEnginePort = (input: {
  worldEngine?: WorldEnginePort;
  fallback: WorldEnginePort;
}): WorldEnginePort => {
  return input.worldEngine ?? input.fallback;
};

export const getPackHostApi = (input: {
  packHostApi?: PackHostApi;
  fallback: PackHostApi;
}): PackHostApi => {
  return input.packHostApi ?? input.fallback;
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
