/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- deps cast from ServiceContainer Record<string, unknown> */
import type { SimulationManager } from '../../core/simulation.js';
import type { ServiceProvider } from '../provider.js';
import { TOKENS } from '../tokens.js';

export const packRuntimeLookupProvider: ServiceProvider = {
  provide: TOKENS.packRuntimeLookup,
  deps: [TOKENS.sim],
  useFactory: (deps) => {
     
    const { sim } = deps as unknown as { sim: SimulationManager };
    return {
      hasPackRuntime: (packId: string) => sim.getPackRuntimeHandle(packId) !== null,
      assertPackScope: (packId: string, _feature: string) => packId.trim(),
      getPackRuntimeSummary: (packId: string) => {
        const handle = sim.getPackRuntimeHandle(packId);
        if (!handle) return null;
        return {
          pack_id: handle.instance_id,
          pack_folder_name: handle.pack_folder_name,
          health_status: handle.getHealthSnapshot().status,
          current_tick: handle.getClockSnapshot().current_tick,
          runtime_ready: true
        };
      }
    };
  }
};

export const packRuntimeObservationProvider: ServiceProvider = {
  provide: TOKENS.packRuntimeObservation,
  deps: [TOKENS.sim],
  useFactory: (deps) => {
     
    const { sim } = deps as unknown as { sim: SimulationManager };
    return {
      getStatus: (packId: string) => sim.getPackRuntimeStatusSnapshot(packId),
      listStatuses: () => sim.listRuntimeStatuses(),
      getClockSnapshot: (packId: string) =>
        sim.getPackRuntimeHandle(packId)?.getClockSnapshot() ?? null,
      getRuntimeSpeedSnapshot: (packId: string) =>
        sim.getPackRuntimeHandle(packId)?.getRuntimeSpeedSnapshot() ?? null
    };
  }
};

export const packRuntimeControlProvider: ServiceProvider = {
  provide: TOKENS.packRuntimeControl,
  deps: [TOKENS.sim],
  useFactory: (deps) => {
     
    const { sim } = deps as unknown as { sim: SimulationManager };
    return {
      load: (packRef: string) => sim.loadExperimentalPackRuntime(packRef),
      unload: (packId: string) => sim.unloadExperimentalPackRuntime(packId)
    };
  }
};
