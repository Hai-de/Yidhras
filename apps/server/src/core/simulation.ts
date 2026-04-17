import 'dotenv/config';

import { PrismaClient } from '@prisma/client';

import { ChronosEngine } from '../clock/engine.js';
import { getWorldPacksDir } from '../config/runtime_config.js';
import { applySqliteRuntimePragmas, type SqliteRuntimePragmaSnapshot } from '../db/sqlite_runtime.js';
import { NarrativeResolver } from '../narrative/resolver.js';
import { PackManifestLoader, type WorldPack } from '../packs/manifest/loader.js';
import type { PermissionContext } from '../permission/types.js';
import { getGraphData } from './graph_data.js';
import { activateWorldPackRuntime } from './runtime_activation.js';
import { RuntimeSpeedPolicy, type RuntimeSpeedSnapshot } from './runtime_speed.js';

export class SimulationManager {
  public prisma: PrismaClient;
  public clock!: ChronosEngine;

  private readonly loader: PackManifestLoader;
  private activePack?: WorldPack;
  private runtimeResolver: NarrativeResolver;
  private runtimeSpeed: RuntimeSpeedPolicy;
  private readonly packsDir: string;
  private sqliteRuntimePragmas: SqliteRuntimePragmaSnapshot | null;

  constructor() {
    this.packsDir = getWorldPacksDir();

    this.prisma = new PrismaClient();
    this.loader = new PackManifestLoader(this.packsDir);
    this.clock = new ChronosEngine([], 0n);
    this.runtimeResolver = new NarrativeResolver({});
    this.runtimeSpeed = new RuntimeSpeedPolicy(1n);
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
    this.runtimeResolver = new NarrativeResolver(activated.pack.variables || {});

    console.log(`[SimulationManager] Initialized with pack: ${activated.pack.metadata.name}`);
  }

  public getActivePack(): WorldPack | undefined {
    return this.activePack;
  }

  public resolvePackVariables(template: string, permission?: PermissionContext): string {
    const pack = this.activePack;
    return this.runtimeResolver.resolve(template, pack?.variables || {}, permission);
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
}

export const sim = new SimulationManager();
