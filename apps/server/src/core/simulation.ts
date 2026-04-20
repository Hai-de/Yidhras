import 'dotenv/config';

import { PrismaClient } from '@prisma/client';

import { ChronosEngine } from '../clock/engine.js';
import { getRuntimeMultiPackConfig, getWorldPacksDir, isExperimentalMultiPackRuntimeEnabled } from '../config/runtime_config.js';
import { applySqliteRuntimePragmas, type SqliteRuntimePragmaSnapshot } from '../db/sqlite_runtime.js';
import { renderNarrativeTemplate } from '../narrative/resolver.js';
import {
  createPromptVariableContext,
  createPromptVariableLayer,
  normalizePromptVariableRecord
} from '../narrative/variable_context.js';
import { PackManifestLoader, type WorldPack } from '../packs/manifest/loader.js';
import type { PermissionContext } from '../permission/types.js';
import { getGraphData } from './graph_data.js';
import type { PackRuntimeHandle } from './pack_runtime_handle.js';
import type { ExperimentalPackRuntimeStatusRecord, PackRuntimeStatusSnapshot } from './pack_runtime_health.js';
import type { PackRuntimeHost } from './pack_runtime_host.js';
import { PackRuntimeInstance } from './pack_runtime_instance.js';
import { InMemoryPackRuntimeRegistry, type PackRuntimeRegistry } from './pack_runtime_registry.js';
import { activateWorldPackRuntime } from './runtime_activation.js';
import { RuntimeSpeedPolicy, type RuntimeSpeedSnapshot } from './runtime_speed.js';

export class SimulationManager {
  public prisma: PrismaClient;
  public clock!: ChronosEngine;

  private readonly loader: PackManifestLoader;
  private activePack?: WorldPack;
  private runtimeSpeed: RuntimeSpeedPolicy;
  private readonly packsDir: string;
  private readonly packRuntimeRegistry: PackRuntimeRegistry;
  private readonly experimentalPackRuntimeEnabled: boolean;
  private sqliteRuntimePragmas: SqliteRuntimePragmaSnapshot | null;

  constructor() {
    this.packsDir = getWorldPacksDir();

    this.prisma = new PrismaClient();
    this.loader = new PackManifestLoader(this.packsDir);
    this.clock = new ChronosEngine([], 0n);
    this.runtimeSpeed = new RuntimeSpeedPolicy(1n);
    this.packRuntimeRegistry = new InMemoryPackRuntimeRegistry();
    this.experimentalPackRuntimeEnabled = isExperimentalMultiPackRuntimeEnabled();
    this.sqliteRuntimePragmas = null;
  }

  public async prepareDatabase(): Promise<SqliteRuntimePragmaSnapshot> {
    if (this.sqliteRuntimePragmas !== null) {
      return this.sqliteRuntimePragmas;
    }

    this.sqliteRuntimePragmas = await applySqliteRuntimePragmas(this.prisma);
    console.log(
      `[SimulationManager] SQLite pragmas journal_mode=${this.sqliteRuntimePragmas.journal_mode} busy_timeout=${String(
        this.sqliteRuntimePragmas.busy_timeout
      )} synchronous=${this.sqliteRuntimePragmas.synchronous} foreign_keys=${String(
        this.sqliteRuntimePragmas.foreign_keys
      )} wal_autocheckpoint=${String(this.sqliteRuntimePragmas.wal_autocheckpoint)}`
    );

    return this.sqliteRuntimePragmas;
  }

  public async init(packFolderName: string): Promise<void> {
    await this.prepareDatabase();

    const activated = await activateWorldPackRuntime({
      packFolderName,
      loader: this.loader,
      prisma: this.prisma,
      packsDir: this.packsDir,
      runtimeSpeed: this.runtimeSpeed
    });

    this.activePack = activated.pack;
    this.clock = activated.clock;

    this.packRuntimeRegistry.register(
      activated.pack.metadata.id,
      new PackRuntimeInstance({
        pack: activated.pack,
        packFolderName,
        clock: activated.clock,
        runtimeSpeed: this.runtimeSpeed,
        initialStatus: 'running'
      })
    );

    console.log(`[SimulationManager] Initialized with pack: ${activated.pack.metadata.name}`);
  }

  public getActivePack(): WorldPack | undefined {
    return this.activePack;
  }

  public resolvePackVariables(template: string, permission?: PermissionContext): string {
    const pack = this.activePack;
    const variableContext = createPromptVariableContext({
      layers: [
        createPromptVariableLayer({
          namespace: 'pack',
          values: normalizePromptVariableRecord({
            metadata: pack?.metadata ?? null,
            variables: pack?.variables ?? {}
          }),
          alias_values: normalizePromptVariableRecord({
            ...(pack?.variables ?? {}),
            world_name: pack?.metadata.name ?? '',
            pack_name: pack?.metadata.name ?? '',
            pack_id: pack?.metadata.id ?? ''
          }),
          metadata: {
            source_label: 'simulation-active-pack',
            trusted: true
          }
        }),
        createPromptVariableLayer({
          namespace: 'runtime',
          values: normalizePromptVariableRecord({
            current_tick: this.getCurrentTick().toString()
          }),
          alias_values: normalizePromptVariableRecord({
            current_tick: this.getCurrentTick().toString()
          }),
          metadata: {
            source_label: 'simulation-runtime',
            trusted: true
          }
        })
      ]
    });

    return renderNarrativeTemplate({
      template,
      variableContext,
      permission,
      templateSource: 'simulation.resolvePackVariables'
    }).text;
  }

  public getStepTicks(): bigint {
    return this.runtimeSpeed.getEffectiveStepTicks();
  }

  public getRuntimeSpeedSnapshot(): RuntimeSpeedSnapshot {
    return this.runtimeSpeed.getSnapshot();
  }

  public getSqliteRuntimePragmaSnapshot(): SqliteRuntimePragmaSnapshot | null {
    return this.sqliteRuntimePragmas;
  }

  public setRuntimeSpeedOverride(stepTicks: bigint): void {
    this.runtimeSpeed.setOverrideStepTicks(stepTicks);
  }

  public clearRuntimeSpeedOverride(): void {
    this.runtimeSpeed.clearOverride();
  }

  public getCurrentTick(): bigint {
    return this.clock.getTicks();
  }

  public getAllTimes() {
    return this.clock.getAllTimes();
  }

  public async step(amount: bigint = 1n): Promise<void> {
    this.clock.tick(amount);
  }

  public async getGraphData(): ReturnType<typeof getGraphData> {
    return getGraphData(this.prisma);
  }

  public listAvailablePacks(): string[] {
    return this.loader.listAvailablePacks();
  }

  public getPacksDir(): string {
    return this.packsDir;
  }

  public getPackRuntimeRegistry(): PackRuntimeRegistry {
    return this.packRuntimeRegistry;
  }

  public isExperimentalMultiPackRuntimeEnabled(): boolean {
    return this.experimentalPackRuntimeEnabled;
  }

  public listLoadedPackRuntimeIds(): string[] {
    return this.packRuntimeRegistry.listLoadedPackIds();
  }

  public getPackRuntimeHandle(packId: string): PackRuntimeHandle | null {
    return this.packRuntimeRegistry.getHandle(packId);
  }

  public registerPackRuntimeHost(packId: string, host: PackRuntimeHost): void {
    this.packRuntimeRegistry.register(packId, host);
  }

  public unregisterPackRuntimeHost(packId: string): boolean {
    return this.packRuntimeRegistry.unregister(packId);
  }

  public getExperimentalPackRuntimeStatusRecords(): Array<ExperimentalPackRuntimeStatusRecord> {
    return this.packRuntimeRegistry.listHandles().map(handle => ({
      pack_id: handle.pack_id,
      status: handle.getHealthSnapshot().status,
      current_tick: handle.getClockSnapshot().current_tick,
      message: handle.getHealthSnapshot().message ?? null
    }));
  }

  public getPackRuntimeStatusSnapshot(packId: string): PackRuntimeStatusSnapshot | null {
    const handle = this.getPackRuntimeHandle(packId);
    if (!handle) {
      return null;
    }

    return {
      pack_id: handle.pack_id,
      pack_folder_name: handle.pack_folder_name,
      health_status: handle.getHealthSnapshot().status,
      current_tick: handle.getClockSnapshot().current_tick,
      runtime_speed: handle.getRuntimeSpeedSnapshot(),
      startup_level: this.startupHealthLevel(),
      runtime_ready: this.activePack?.metadata.id === packId,
      message: handle.getHealthSnapshot().message ?? null
    };
  }

  public async loadExperimentalPackRuntime(packRef: string): Promise<{
    handle: PackRuntimeHandle;
    loaded: boolean;
    already_loaded: boolean;
  }> {
    await this.prepareDatabase();

    const resolved = this.resolvePackByIdOrFolder(packRef);
    if (!resolved) {
      throw new Error(`experimental runtime pack not found: ${packRef}`);
    }

    const existing = this.packRuntimeRegistry.getHandle(resolved.pack.metadata.id);
    if (existing) {
      return {
        handle: existing,
        loaded: false,
        already_loaded: true
      };
    }

    const { max_loaded_packs: maxLoadedPacks } = getRuntimeMultiPackConfig();
    if (this.packRuntimeRegistry.listLoadedPackIds().length >= maxLoadedPacks) {
      throw new Error(`experimental runtime max loaded packs exceeded: ${String(maxLoadedPacks)}`);
    }

    const host = new PackRuntimeInstance({
      pack: resolved.pack,
      packFolderName: resolved.packFolderName,
      initialStatus: 'loaded',
      initialMessage: 'experimental operator-loaded runtime'
    });
    await host.load();
    this.packRuntimeRegistry.register(resolved.pack.metadata.id, host);
    return {
      handle: host.getHandle(),
      loaded: true,
      already_loaded: false
    };
  }

  public async unloadExperimentalPackRuntime(packId: string): Promise<boolean> {
    const host = this.packRuntimeRegistry.getHost(packId);
    if (!host) {
      return false;
    }

    if (this.activePack?.metadata.id === packId) {
      throw new Error('cannot unload active pack runtime from stable runtime host');
    }

    await host.dispose();
    return this.packRuntimeRegistry.unregister(packId);
  }

  private resolvePackByIdOrFolder(packRef: string): { pack: WorldPack; packFolderName: string } | null {
    const normalizedPackRef = packRef.trim();
    if (normalizedPackRef.length === 0) {
      return null;
    }

    const activePack = this.activePack;
    if (activePack && (activePack.metadata.id === normalizedPackRef || activePack.metadata.name === normalizedPackRef)) {
      return {
        pack: activePack,
        packFolderName: normalizedPackRef === activePack.metadata.id
          ? this.findFolderNameByPackId(activePack.metadata.id) ?? normalizedPackRef
          : normalizedPackRef
      };
    }

    for (const packFolderName of this.listAvailablePacks()) {
      const pack = this.loader.loadPack(packFolderName);
      if (packFolderName === normalizedPackRef || pack.metadata.id === normalizedPackRef) {
        return {
          pack,
          packFolderName
        };
      }
    }

    return null;
  }

  private findFolderNameByPackId(packId: string): string | null {
    for (const packFolderName of this.listAvailablePacks()) {
      const pack = this.loader.loadPack(packFolderName);
      if (pack.metadata.id === packId) {
        return packFolderName;
      }
    }

    return null;
  }

  private startupHealthLevel(): 'ok' | 'degraded' | 'fail' {
    return this.activePack ? 'ok' : 'degraded';
  }
}

export const sim = new SimulationManager();
