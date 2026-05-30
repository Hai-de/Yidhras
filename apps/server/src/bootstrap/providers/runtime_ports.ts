import { TOKENS } from '../tokens.js';

export const packRuntimeLookupProvider = {
  provide: TOKENS.packRuntimeLookup,
  deps: [TOKENS.sim] as const,
  useFactory: (deps) => {
    const sim = deps.sim;
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
} as const satisfies import('../provider.js').ServiceProvider;

export const packRuntimeObservationProvider = {
  provide: TOKENS.packRuntimeObservation,
  deps: [TOKENS.sim] as const,
  useFactory: (deps) => {
    const sim = deps.sim;
    return {
      getStatus: (packId: string) => sim.getPackRuntimeStatusSnapshot(packId),
      listStatuses: () => sim.listRuntimeStatuses(),
      getClockSnapshot: (packId: string) =>
        sim.getPackRuntimeHandle(packId)?.getClockSnapshot() ?? null,
      getRuntimeSpeedSnapshot: (packId: string) =>
        sim.getPackRuntimeHandle(packId)?.getRuntimeSpeedSnapshot() ?? null
    };
  }
} as const satisfies import('../provider.js').ServiceProvider;

export const packRuntimeControlProvider = {
  provide: TOKENS.packRuntimeControl,
  deps: [TOKENS.sim] as const,
  useFactory: (deps) => {
    const sim = deps.sim;
    return {
      load: (packRef: string) => sim.loadExperimentalPackRuntime(packRef),
      unload: (packId: string) => sim.unloadExperimentalPackRuntime(packId)
    };
  }
} as const satisfies import('../provider.js').ServiceProvider;
