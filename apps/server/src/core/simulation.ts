import 'dotenv/config';

import { PrismaClient } from '@prisma/client';

import type { RuntimeDatabaseBootstrap } from '../app/runtime/runtime_bootstrap.js';
import type { RuntimeClockProjectionSnapshot } from '../app/runtime/runtime_clock_projection.js';
import type {
  HostRuntimeKernelFacade,
  PackCatalogService
} from '../app/services/app_context_ports.js';
import { ChronosEngine } from '../clock/engine.js';
import {
  getRuntimeConfig,
  getWorldPacksDir,
  isExperimentalMultiPackRuntimeEnabled
} from '../config/runtime_config.js';
import type { SqliteRuntimePragmaSnapshot } from '../db/sqlite_runtime.js';
import { PackManifestLoader, type WorldPack } from '../packs/manifest/loader.js';
import type { ActivePackProvider } from './active_pack_provider.js';
import { DefaultActivePackRuntimeFacade, type DefaultActivePackRuntimeFacadeOptions } from './active_pack_runtime_facade.js';
import type { ClockProvider } from './clock_provider.js';
import { getGraphData } from './graph_data.js';
import { DefaultPackCatalogService } from './pack_catalog_service.js';
import type { PackRuntimeHandle } from './pack_runtime_handle.js';
import type { ExperimentalPackRuntimeStatusRecord, PackRuntimeStatusSnapshot } from './pack_runtime_health.js';
import type { PackRuntimeHost } from './pack_runtime_host.js';
import { InMemoryPackRuntimeRegistry, type PackRuntimeRegistry } from './pack_runtime_registry.js';
import { DefaultPackRuntimeRegistryService } from './pack_runtime_registry_service.js';
import { PrismaRuntimeDatabaseBootstrap } from './runtime_database_bootstrap.js';
import { RuntimeSpeedPolicy, type RuntimeSpeedSnapshot } from './runtime_speed.js';

export class SimulationManager implements RuntimeDatabaseBootstrap, HostRuntimeKernelFacade, PackCatalogService, ClockProvider, ActivePackProvider {
  private prisma: PrismaClient;
  public clock!: ChronosEngine;

  private readonly loader: PackManifestLoader;
  private readonly runtimeSpeed: RuntimeSpeedPolicy;
  private readonly packsDir: string;
  private readonly packRuntimeRegistry: PackRuntimeRegistry;
  private readonly experimentalPackRuntimeEnabled: boolean;
  private readonly runtimeBootstrap: RuntimeDatabaseBootstrap;
  private readonly packCatalogService: DefaultPackCatalogService;
  private readonly activePackRuntimeFacade: DefaultActivePackRuntimeFacade;
  private readonly packRuntimeRegistryService: DefaultPackRuntimeRegistryService;

  constructor(options: { prisma: PrismaClient; notifications: DefaultActivePackRuntimeFacadeOptions['notifications'] }) {
    this.packsDir = getWorldPacksDir();

    this.prisma = options.prisma;
    this.loader = new PackManifestLoader(this.packsDir);
    this.clock = new ChronosEngine({
      calendarConfigs: [],
      initialTicks: 0n,
      monotonic: getRuntimeConfig().clock.monotonic_enabled,
      maxStepTicks: BigInt(getRuntimeConfig().clock.max_step_ticks)
    });
    this.runtimeSpeed = new RuntimeSpeedPolicy(1n);
    this.packRuntimeRegistry = new InMemoryPackRuntimeRegistry();
    this.experimentalPackRuntimeEnabled = isExperimentalMultiPackRuntimeEnabled();
    this.runtimeBootstrap = new PrismaRuntimeDatabaseBootstrap({
      prisma: this.prisma
    });
    this.activePackRuntimeFacade = new DefaultActivePackRuntimeFacade({
      loader: this.loader,
      prisma: this.prisma,
      packsDir: this.packsDir,
      runtimeSpeed: this.runtimeSpeed,
      runtimeBootstrap: this.runtimeBootstrap,
      runtimeRegistry: this.packRuntimeRegistry,
      notifications: options.notifications
    });
    this.packCatalogService = new DefaultPackCatalogService({
      packsDir: this.packsDir,
      loader: this.loader,
      getActivePack: () => this.activePackRuntimeFacade.getActivePack()
    });
    this.packRuntimeRegistryService = new DefaultPackRuntimeRegistryService({
      registry: this.packRuntimeRegistry,
      packCatalog: this.packCatalogService,
      prisma: this.prisma,
      getActivePack: () => this.activePackRuntimeFacade.getActivePack(),
      getStartupLevel: () => this.startupHealthLevel()
    });
  }

  public async prepareDatabase(): Promise<SqliteRuntimePragmaSnapshot> {
    return this.runtimeBootstrap.prepareDatabase();
  }

  public getSqliteRuntimePragmaSnapshot(): SqliteRuntimePragmaSnapshot | null {
    return this.runtimeBootstrap.getSqliteRuntimePragmaSnapshot();
  }

  public async init(packFolderName: string, openingId?: string): Promise<void> {
    await this.activePackRuntimeFacade.init(packFolderName, openingId);
    this.syncClockFromActiveRuntime();
  }

  public getActivePack(): WorldPack | undefined {
    return this.activePackRuntimeFacade.getActivePack();
  }

  public resolvePackVariables(template: string, permission?: import('../permission/types.js').PermissionContext, actorState?: Record<string, unknown> | null): string {
    return this.activePackRuntimeFacade.resolvePackVariables(template, permission, actorState);
  }

  public getStepTicks(): bigint {
    return this.activePackRuntimeFacade.getStepTicks();
  }

  public getRuntimeSpeedSnapshot(): RuntimeSpeedSnapshot {
    return this.activePackRuntimeFacade.getRuntimeSpeedSnapshot();
  }

  public setRuntimeSpeedOverride(stepTicks: bigint): void {
    this.activePackRuntimeFacade.setRuntimeSpeedOverride(stepTicks);
  }

  public clearRuntimeSpeedOverride(): void {
    this.activePackRuntimeFacade.clearRuntimeSpeedOverride();
  }

  public getCurrentTick(): bigint {
    return this.activePackRuntimeFacade.getCurrentTick();
  }

  public getCurrentRevision(): bigint {
    return this.activePackRuntimeFacade.getCurrentRevision();
  }

  public getAllTimes() {
    return this.activePackRuntimeFacade.getAllTimes();
  }

  public async step(amount: bigint = 1n): Promise<void> {
    await this.activePackRuntimeFacade.step(amount);
    this.syncClockFromActiveRuntime();
  }

  public applyClockProjection(snapshot: RuntimeClockProjectionSnapshot): void {
    this.activePackRuntimeFacade.applyClockProjection(snapshot);
    this.syncClockFromActiveRuntime();
  }

  public async getGraphData(): ReturnType<typeof getGraphData> {
    return getGraphData(this.prisma);
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

  public isExperimentalMultiPackRuntimeEnabled(): boolean {
    return this.experimentalPackRuntimeEnabled;
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
      pack_id: status.pack_id,
      status: status.health_status,
      current_tick: status.current_tick,
      message: status.message ?? null
    }));
  }

  public getPackRuntimeStatusSnapshot(packId: string): PackRuntimeStatusSnapshot | null {
    return this.packRuntimeRegistryService.getStatus(packId);
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

  private startupHealthLevel(): 'ok' | 'degraded' | 'fail' {
    return this.getActivePack() ? 'ok' : 'degraded';
  }

  private syncClockFromActiveRuntime(): void {
    this.clock = this.activePackRuntimeFacade.getClock();
  }
}
