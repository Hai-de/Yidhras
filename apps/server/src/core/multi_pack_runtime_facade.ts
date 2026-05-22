import type { AggregatedClockSnapshot, MultiPackRuntimePort, PackRuntimePort } from '../app/services/pack/pack_runtime_ports.js';
import { DefaultPackRuntimePort } from '../packs/orchestration/default_pack_runtime_port.js';
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
          revision: 0n
        };
      }
    }
    return {
      packs,
      primaryPackId: ids[0] ?? ''
    };
  }

  getPackRuntime(packId: string): PackRuntimePort {
    const host = this.registryService.getHost(packId);
    if (!host) {
      throw new Error(`[MultiPackRuntimeFacade] Cannot construct PackRuntimePort for ${packId}: pack host not available`);
    }
    return new DefaultPackRuntimePort(host);
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
