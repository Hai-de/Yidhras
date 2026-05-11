import type { MultiPackLoopHost } from '../app/runtime/MultiPackLoopHost.js';
import type { WorldEnginePort } from '../app/runtime/world_engine_ports.js';
import type { PackRuntimeHandle } from './pack_runtime_handle.js';
import type { DefaultPackRuntimeRegistryService } from '../packs/orchestration/pack_runtime_registry_service.js';

/**
 * Multi-pack lifecycle coordinator — extracted from SimulationManager.
 * Handles loading, unloading, and reinitializing pack runtimes.
 */
export class PackRuntimeCoordinator {
  constructor(
    private readonly registryService: DefaultPackRuntimeRegistryService
  ) {}

  setMultiPackLoopHost(host: MultiPackLoopHost): void {
    this.registryService.setMultiPackLoopHost(host);
  }

  setWorldEngine(worldEngine: WorldEnginePort): void {
    this.registryService.setWorldEngine(worldEngine);
  }

  async load(packRef: string): Promise<{
    handle: PackRuntimeHandle;
    loaded: boolean;
    already_loaded: boolean;
  }> {
    return this.registryService.load(packRef);
  }

  async unload(packId: string): Promise<boolean> {
    return this.registryService.unload(packId);
  }

  listLoadedPackIds(): string[] {
    return this.registryService.listLoadedPackIds();
  }
}
