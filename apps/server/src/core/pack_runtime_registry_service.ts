import type { PrismaClient } from '@prisma/client';

import { getRuntimeMultiPackConfig } from '../config/runtime_config.js';
import type { WorldPack } from '../packs/manifest/loader.js';
import { teardownActorBridges } from '../packs/runtime/materializer.js';
import { ApiError } from '../utils/api_error.js';
import type { DefaultPackCatalogService } from './pack_catalog_service.js';
import type { PackRuntimeHandle } from './pack_runtime_handle.js';
import type { PackRuntimeStatusSnapshot } from './pack_runtime_health.js';
import type { PackRuntimeHost } from './pack_runtime_host.js';
import { PackRuntimeInstance } from './pack_runtime_instance.js';
import type { PackRuntimeControl, PackRuntimeLocator, PackRuntimeObservation } from './pack_runtime_ports.js';
import type { PackRuntimeRegistry } from './pack_runtime_registry.js';

export interface DefaultPackRuntimeRegistryServiceOptions {
  registry: PackRuntimeRegistry;
  packCatalog: Pick<DefaultPackCatalogService, 'resolvePackByIdOrFolder'>;
  prisma: PrismaClient;
  getActivePack(): WorldPack | undefined;
  getStartupLevel(): 'ok' | 'degraded' | 'fail';
}

export class DefaultPackRuntimeRegistryService implements PackRuntimeLocator, PackRuntimeObservation, PackRuntimeControl {
  private readonly registry: PackRuntimeRegistry;
  private readonly packCatalog: Pick<DefaultPackCatalogService, 'resolvePackByIdOrFolder'>;
  private readonly prisma: PrismaClient;
  private readonly getActivePackRef: () => WorldPack | undefined;
  private readonly getStartupLevelRef: () => 'ok' | 'degraded' | 'fail';

  constructor(options: DefaultPackRuntimeRegistryServiceOptions) {
    this.registry = options.registry;
    this.packCatalog = options.packCatalog;
    this.prisma = options.prisma;
    this.getActivePackRef = options.getActivePack;
    this.getStartupLevelRef = options.getStartupLevel;
  }

  public listLoadedPackIds(): string[] {
    return this.registry.listLoadedPackIds();
  }

  public getActivePackId(): string | null {
    return this.getActivePackRef()?.metadata.id ?? null;
  }

  public getHandle(packId: string): PackRuntimeHandle | null {
    return this.registry.getHandle(packId);
  }

  public hasPackRuntime(packId: string): boolean {
    return this.getHandle(packId) !== null;
  }

  public resolveStablePackScope(packId: string): string {
    return packId.trim();
  }

  public resolveExperimentalPackScope(packId: string): string {
    return packId.trim();
  }

  public getStatus(packId: string): PackRuntimeStatusSnapshot | null {
    const handle = this.getHandle(packId);
    if (!handle) {
      return null;
    }

    return {
      pack_id: handle.pack_id,
      pack_folder_name: handle.pack_folder_name,
      health_status: handle.getHealthSnapshot().status,
      current_tick: handle.getClockSnapshot().current_tick,
      runtime_speed: handle.getRuntimeSpeedSnapshot(),
      startup_level: this.getStartupLevelRef(),
      runtime_ready: this.getActivePackId() === packId,
      message: handle.getHealthSnapshot().message ?? null
    };
  }

  public listStatuses(): PackRuntimeStatusSnapshot[] {
    return this.registry.listHandles()
      .map(handle => this.getStatus(handle.pack_id))
      .filter((status): status is PackRuntimeStatusSnapshot => status !== null);
  }

  public getClockSnapshot(packId: string) {
    return this.getHandle(packId)?.getClockSnapshot() ?? null;
  }

  public getRuntimeSpeedSnapshot(packId: string) {
    return this.getHandle(packId)?.getRuntimeSpeedSnapshot() ?? null;
  }

  public async load(packRef: string): Promise<{
    handle: PackRuntimeHandle;
    loaded: boolean;
    already_loaded: boolean;
  }> {
    const resolved = this.packCatalog.resolvePackByIdOrFolder(packRef);
    if (!resolved) {
      throw new ApiError(404, 'EXPERIMENTAL_PACK_RUNTIME_NOT_FOUND', 'Experimental runtime pack not found', {
        pack_id: packRef,
        source: 'pack_runtime_registry_service.load'
      });
    }

    const existing = this.registry.getHandle(resolved.pack.metadata.id);
    if (existing) {
      return {
        handle: existing,
        loaded: false,
        already_loaded: true
      };
    }

    const { max_loaded_packs: maxLoadedPacks } = getRuntimeMultiPackConfig();
    if (this.registry.listLoadedPackIds().length >= maxLoadedPacks) {
      throw new Error(`experimental runtime max loaded packs exceeded: ${String(maxLoadedPacks)}`);
    }

    const host = new PackRuntimeInstance({
      pack: resolved.pack,
      packFolderName: resolved.packFolderName,
      initialStatus: 'loaded',
      initialMessage: 'experimental operator-loaded runtime'
    });
    await host.load();
    this.registry.register(resolved.pack.metadata.id, host);

    const verifyHandle = this.registry.getHandle(resolved.pack.metadata.id);
    if (!verifyHandle) {
      console.error(
        `[PackRuntimeRegistryService] Experimental pack registration verification failed: ` +
        `pack_id=${resolved.pack.metadata.id} was registered but getHandle returned null. ` +
        `This indicates a registry inconsistency.`
      );
    }

    return {
      handle: host.getHandle(),
      loaded: true,
      already_loaded: false
    };
  }

  public async unload(packId: string): Promise<boolean> {
    const host = this.registry.getHost(packId);
    if (!host) {
      return false;
    }

    if (this.getActivePackId() === packId) {
      throw new Error('cannot unload active pack runtime from stable runtime host');
    }

    await host.dispose();
    const deletedCount = await teardownActorBridges(packId, this.prisma);
    if (deletedCount > 0) {
      console.log(`[PackRuntimeRegistryService] Cleaned up ${String(deletedCount)} actor bridge records for unloaded pack ${packId}`);
    }
    return this.registry.unregister(packId);
  }

  public registerHost(packId: string, host: PackRuntimeHost): void {
    this.registry.register(packId, host);
  }

  public unregisterHost(packId: string): boolean {
    return this.registry.unregister(packId);
  }

  public getRegistry(): PackRuntimeRegistry {
    return this.registry;
  }
}
