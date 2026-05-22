import type { AggregatedClockSnapshot, MultiPackRuntimePort, PackRuntimePort } from '../app/services/pack/pack_runtime_ports.js';
import type { DefaultPackRuntimeRegistryService } from '../packs/orchestration/pack_runtime_registry_service.js';

/**
 * Multi-pack aggregation facade — extracted from SimulationManager.
 * Provides cross-pack queries and per-pack port access.
 */
export class MultiPackRuntimeFacade implements MultiPackRuntimePort {
  constructor(
    private readonly registryService: DefaultPackRuntimeRegistryService
  ) {}

  listPacks(): string[] {
    return this.registryService.listLoadedPackIds();
  }

  getPackTick(packId: string): bigint {
    const handle = this.registryService.getHandle(packId);
    if (!handle) {
      throw new Error(`[MultiPackRuntimeFacade] Pack not loaded: ${packId}`);
    }
    return BigInt(handle.getClockSnapshot().current_tick);
  }

  getGlobalClock(): AggregatedClockSnapshot {
    const ids = this.listPacks();
    const packs: AggregatedClockSnapshot['packs'] = {};
    for (const id of ids) {
      const handle = this.registryService.getHandle(id);
      if (handle) {
        packs[id] = {
          tick: BigInt(handle.getClockSnapshot().current_tick),
          revision: 0n // revision will be tracked per-pack in later phases
        };
      }
    }
    return {
      packs,
      primaryPackId: ids[0] ?? ''
    };
  }

  getPackRuntime(packId: string): PackRuntimePort {
    const handle = this.registryService.getHandle(packId);
    if (!handle) {
      throw new Error(`[MultiPackRuntimeFacade] Pack not loaded: ${packId}`);
    }
    const instance = (handle as unknown as { instance?: { getPackRuntimePort?: () => PackRuntimePort } }).instance;
    if (instance?.getPackRuntimePort) {
      return instance.getPackRuntimePort();
    }
    // Fallback: wrap via handle's internal instance (registry-dependent path)
    throw new Error(
      `[MultiPackRuntimeFacade] Cannot construct PackRuntimePort for ${packId}: ` +
      `PackRuntimeInstance.getPackRuntimePort() not available. ` +
      `Ensure Phase 1.5 enhancements are applied.`
    );
  }

  assertRuntimeReady(packId: string, feature: string): void {
    const handle = this.registryService.getHandle(packId);
    if (!handle) {
      throw new Error(
        `[MultiPackRuntimeFacade] Runtime not ready for ${feature}: pack ${packId} not loaded`
      );
    }
    const status = handle.getHealthSnapshot().status;
    if (status !== 'running' && status !== 'loaded') {
      throw new Error(
        `[MultiPackRuntimeFacade] Runtime not ready for ${feature}: pack ${packId} is ${status}`
      );
    }
  }
}
