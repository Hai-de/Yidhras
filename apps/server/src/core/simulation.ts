import 'dotenv/config';

import { PrismaClient } from '@prisma/client';

import type { MultiPackLoopHost } from '../app/runtime/MultiPackLoopHost.js';
import type { RuntimeDatabaseBootstrap } from '../app/runtime/runtime_bootstrap.js';
import type { WorldEnginePort } from '../app/runtime/world_engine_ports.js';
import type { PackCatalogService } from '../app/services/app_context_ports.js';
import {
  getWorldPacksDir
} from '../config/runtime_config.js';
import type { DatabaseHealthSnapshot } from '../db/sqlite_runtime.js';
import { PackManifestLoader } from '../packs/manifest/loader.js';
import { DefaultPackCatalogService } from '../packs/orchestration/pack_catalog_service.js';
import { DefaultPackRuntimeRegistryService } from '../packs/orchestration/pack_runtime_registry_service.js';
import type { PackStorageAdapter } from '../packs/storage/PackStorageAdapter.js';
import { getGraphData } from './graph_data.js';
import type { PackRuntimeHandle } from './pack_runtime_handle.js';
import type { ExperimentalPackRuntimeStatusRecord, PackRuntimeStatusSnapshot } from './pack_runtime_health.js';
import type { PackRuntimeHost } from './pack_runtime_host.js';
import { InMemoryPackRuntimeRegistry, type PackRuntimeRegistry } from './pack_runtime_registry.js';
import { PrismaRuntimeDatabaseBootstrap } from './runtime_database_bootstrap.js';

export class SimulationManager implements RuntimeDatabaseBootstrap, PackCatalogService {
  private prisma: PrismaClient;
  private readonly loader: PackManifestLoader;
  private readonly packsDir: string;
  private readonly packRuntimeRegistry: PackRuntimeRegistry;
  private readonly runtimeBootstrap: RuntimeDatabaseBootstrap;
  private readonly packCatalogService: DefaultPackCatalogService;
  private readonly packRuntimeRegistryService: DefaultPackRuntimeRegistryService;

  constructor(options: { prisma: PrismaClient; packStorageAdapter: PackStorageAdapter; multiPackLoopHost?: MultiPackLoopHost }) {
    this.packsDir = getWorldPacksDir();
    this.prisma = options.prisma;
    this.loader = new PackManifestLoader(this.packsDir);
    this.packRuntimeRegistry = new InMemoryPackRuntimeRegistry();
    this.runtimeBootstrap = new PrismaRuntimeDatabaseBootstrap({ prisma: this.prisma });

    this.packCatalogService = new DefaultPackCatalogService({
      packsDir: this.packsDir,
      loader: this.loader
    });

    this.packRuntimeRegistryService = new DefaultPackRuntimeRegistryService({
      registry: this.packRuntimeRegistry,
      packCatalog: this.packCatalogService,
      prisma: this.prisma,
      packStorageAdapter: options.packStorageAdapter,
      packsDir: this.packsDir,
      getStartupLevel: () => 'ok',
      onBeforeUnload: async () => {},
      multiPackLoopHost: options.multiPackLoopHost
    });
  }

  public setMultiPackLoopHost(host: MultiPackLoopHost): void {
    this.packRuntimeRegistryService.setMultiPackLoopHost(host);
  }

  public setWorldEngine(worldEngine: WorldEnginePort): void {
    this.packRuntimeRegistryService.setWorldEngine(worldEngine);
  }

  public async prepareDatabase(): Promise<DatabaseHealthSnapshot> {
    return this.runtimeBootstrap.prepareDatabase();
  }

  public getDatabaseHealth(): DatabaseHealthSnapshot | null {
    return this.runtimeBootstrap.getDatabaseHealth();
  }

  public async getGraphData(): ReturnType<typeof getGraphData> {
    return getGraphData({
      listAgents: () => this.prisma.agent.findMany(),
      listRelationships: () => this.prisma.relationship.findMany()
    });
  }

  public listAvailablePacks(): string[] {
    return this.packCatalogService.listAvailablePacks();
  }

  public getPacksDir(): string {
    return this.packCatalogService.getPacksDir();
  }

  public getPackRuntimeRegistry(): PackRuntimeRegistry {
    return this.packRuntimeRegistryService.getRegistry();
  }

  public listLoadedPackRuntimeIds(): string[] {
    return this.packRuntimeRegistryService.listLoadedPackIds();
  }

  public getPackRuntimeHandle(packId: string): PackRuntimeHandle | null {
    return this.packRuntimeRegistryService.getHandle(packId);
  }

  public registerPackRuntimeHost(packId: string, host: PackRuntimeHost): void {
    this.packRuntimeRegistryService.registerHost(packId, host);
  }

  public unregisterPackRuntimeHost(packId: string): boolean {
    return this.packRuntimeRegistryService.unregisterHost(packId);
  }

  public getExperimentalPackRuntimeStatusRecords(): Array<ExperimentalPackRuntimeStatusRecord> {
    return this.packRuntimeRegistryService.listStatuses().map(status => ({
      instance_id: status.instance_id,
      metadata_id: status.metadata_id,
      pack_id: status.instance_id,
      status: status.health_status,
      current_tick: status.current_tick,
      message: status.message ?? null
    }));
  }

  public getPackRuntimeStatusSnapshot(packId: string): PackRuntimeStatusSnapshot | null {
    return this.packRuntimeRegistryService.getStatus(packId);
  }

  public listRuntimeStatuses(): PackRuntimeStatusSnapshot[] {
    return this.packRuntimeRegistryService.listStatuses();
  }

  public async loadExperimentalPackRuntime(packRef: string): Promise<{
    handle: PackRuntimeHandle;
    loaded: boolean;
    already_loaded: boolean;
  }> {
    return this.packRuntimeRegistryService.load(packRef);
  }

  public async unloadExperimentalPackRuntime(packId: string): Promise<boolean> {
    return this.packRuntimeRegistryService.unload(packId);
  }
}
