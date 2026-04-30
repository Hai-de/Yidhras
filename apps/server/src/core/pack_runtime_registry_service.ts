import type { PrismaClient } from '@prisma/client';
import path from 'path';

import { ChronosEngine } from '../clock/engine.js';
import type { CalendarConfig } from '../clock/types.js';
import { getRuntimeMultiPackConfig } from '../config/runtime_config.js';
import type { WorldPack } from '../packs/manifest/loader.js';
import { teardownActorBridges } from '../packs/runtime/materializer.js';
import { resolvePackRuntimeDatabaseLocation } from '../packs/storage/pack_db_locator.js';
import type { PackStorageAdapter } from '../packs/storage/PackStorageAdapter.js';
import { discoverPackLocalPlugins } from '../plugins/discovery.js';
import { pluginRuntimeRegistry } from '../plugins/runtime.js';
import { ApiError } from '../utils/api_error.js';
import { createLogger } from '../utils/logger.js';
import { safeFs } from '../utils/safe_fs.js';

const logger = createLogger('pack-runtime-registry');
import type { MultiPackLoopHost } from '../app/runtime/MultiPackLoopHost.js';
import type { DefaultPackCatalogService } from './pack_catalog_service.js';
import { materializePackRuntime } from './pack_materializer.js';
import type { PackRuntimeHandle } from './pack_runtime_handle.js';
import type { PackRuntimeStatusSnapshot } from './pack_runtime_health.js';
import type { PackRuntimeHost } from './pack_runtime_host.js';
import { PackRuntimeInstance } from './pack_runtime_instance.js';
import type { PackRuntimeControl, PackRuntimeLocator, PackRuntimeObservation } from './pack_runtime_ports.js';
import type { PackRuntimeRegistry } from './pack_runtime_registry.js';
import { RuntimeSpeedPolicy } from './runtime_speed.js';
import { getWorldPackRuntimeConfig } from './world_pack_runtime.js';

export interface DefaultPackRuntimeRegistryServiceOptions {
  registry: PackRuntimeRegistry;
  packCatalog: Pick<DefaultPackCatalogService, 'resolvePackByIdOrFolder'>;
  prisma: PrismaClient;
  packStorageAdapter: PackStorageAdapter;
  packsDir: string;
  getActivePack: () => WorldPack | undefined;
  getStartupLevel: () => 'ok' | 'degraded' | 'fail';
  onBeforeUnload?: (packId: string) => Promise<void>;
  multiPackLoopHost?: MultiPackLoopHost;
}

export class DefaultPackRuntimeRegistryService implements PackRuntimeLocator, PackRuntimeObservation, PackRuntimeControl {
  private readonly registry: PackRuntimeRegistry;
  private readonly packCatalog: Pick<DefaultPackCatalogService, 'resolvePackByIdOrFolder'>;
  private readonly prisma: PrismaClient;
  private readonly packStorageAdapter: PackStorageAdapter;
  private readonly packsDir: string;
  private readonly getActivePackRef: () => WorldPack | undefined;
  private readonly getStartupLevelRef: () => 'ok' | 'degraded' | 'fail';
  private readonly onBeforeUnload?: (packId: string) => Promise<void>;
  private multiPackLoopHost?: MultiPackLoopHost;

  constructor(options: DefaultPackRuntimeRegistryServiceOptions) {
    this.registry = options.registry;
    this.packCatalog = options.packCatalog;
    this.prisma = options.prisma;
    this.packStorageAdapter = options.packStorageAdapter;
    this.packsDir = options.packsDir;
    this.getActivePackRef = options.getActivePack;
    this.getStartupLevelRef = options.getStartupLevel;
    this.onBeforeUnload = options.onBeforeUnload;
    this.multiPackLoopHost = options.multiPackLoopHost;
  }

  public setMultiPackLoopHost(host: MultiPackLoopHost): void {
    this.multiPackLoopHost = host;
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

    const packId = resolved.pack.metadata.id;

    const existing = this.registry.getHandle(packId);
    if (existing) {
      return {
        handle: existing,
        loaded: false,
        already_loaded: true
      };
    }

    this.registry.transitionTo(packId, 'loading');

    const { max_loaded_packs: maxLoadedPacks } = getRuntimeMultiPackConfig();
    if (this.registry.listLoadedPackIds().length >= maxLoadedPacks) {
      throw new Error(`experimental runtime max loaded packs exceeded: ${String(maxLoadedPacks)}`);
    }

    const runtimeConfig = getWorldPackRuntimeConfig(resolved.pack);
    await materializePackRuntime({
      pack: resolved.pack,
      prisma: this.prisma,
      packStorageAdapter: this.packStorageAdapter,
      initialTick: runtimeConfig.initialTick
    });

    const calendars = (resolved.pack.time_systems ?? []) as unknown as CalendarConfig[];
    const clock = new ChronosEngine({ calendarConfigs: calendars, initialTicks: runtimeConfig.initialTick });
    const runtimeSpeed = new RuntimeSpeedPolicy(runtimeConfig.configuredStepTicks ?? 1n);

    const host = new PackRuntimeInstance({
      pack: resolved.pack,
      packFolderName: resolved.packFolderName,
      clock,
      runtimeSpeed,
      initialStatus: 'loaded',
      initialMessage: 'experimental operator-loaded runtime'
    });
    await host.load();
    this.registry.register(resolved.pack.metadata.id, host);

    const verifyHandle = this.registry.getHandle(resolved.pack.metadata.id);
    if (!verifyHandle) {
      logger.error(
        `Experimental pack registration verification failed: ` +
        `pack_id=${resolved.pack.metadata.id} was registered but getHandle returned null. ` +
        `This indicates a registry inconsistency.`
      );
    }

    const packRootDir = path.join(this.packsDir, resolved.packFolderName);
    await discoverPackLocalPlugins({
      prismaContext: { prisma: this.prisma },
      pack: resolved.pack,
      packRootDir
    });

    // Start per-pack simulation loop
    if (this.multiPackLoopHost) {
      this.multiPackLoopHost.startLoop(resolved.pack.metadata.id, clock);
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

    this.registry.transitionTo(packId, 'unloading');

    // Stop per-pack simulation loop before disposal
    if (this.multiPackLoopHost) {
      this.multiPackLoopHost.stopLoop(packId);
    }

    if (this.onBeforeUnload) {
      await this.onBeforeUnload(packId);
    }

    await host.dispose();
    const deletedCount = await teardownActorBridges(packId, this.prisma);
    if (deletedCount > 0) {
      logger.info(`Cleaned up ${String(deletedCount)} actor bridge records for unloaded pack ${packId}`);
    }

    const location = resolvePackRuntimeDatabaseLocation(packId);
    const { packRootDir, runtimeDbPath } = location;
    const storagePlanPath = `${runtimeDbPath}.storage-plan.json`;

    if (safeFs.existsSync(packRootDir, runtimeDbPath)) {
      safeFs.rmSync(packRootDir, runtimeDbPath, { force: true });
      logger.info(`Removed runtime database for unloaded pack ${packId}: ${runtimeDbPath}`);
    }
    if (safeFs.existsSync(packRootDir, storagePlanPath)) {
      safeFs.rmSync(packRootDir, storagePlanPath, { force: true });
    }

    pluginRuntimeRegistry.clearRuntimes(packId);

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
