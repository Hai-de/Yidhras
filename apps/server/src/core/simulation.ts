import 'dotenv/config';

import { PrismaClient } from '@prisma/client';

import { ChronosEngine } from '../clock/engine.js';
import type { CalendarConfig } from '../clock/types.js';
import { getWorldPacksDir } from '../config/runtime_config.js';
import { applySqliteRuntimePragmas, type SqliteRuntimePragmaSnapshot } from '../db/sqlite_runtime.js';
import { ValueDynamicsManager } from '../dynamics/manager.js';
import { NarrativeResolver } from '../narrative/resolver.js';
import { notifications } from '../utils/notifications.js';
import { WorldPack, WorldPackLoader } from '../world/loader.js';
import { materializeWorldPackScenario } from '../world/materializer.js';
import { getGraphData } from './graph_data.js';
import { RuntimeSpeedPolicy, RuntimeSpeedSnapshot } from './runtime_speed.js';
import { getWorldPackRuntimeConfig } from './world_pack_runtime.js';

export class SimulationManager {
  public prisma: PrismaClient;
  public loader: WorldPackLoader;
  public clock!: ChronosEngine;
  public resolver!: NarrativeResolver;
  public dynamics!: ValueDynamicsManager;

  private activePack?: WorldPack;
  private runtimeSpeed: RuntimeSpeedPolicy;
  private readonly packsDir: string;
  private sqliteRuntimePragmas: SqliteRuntimePragmaSnapshot | null;

  constructor() {
    this.packsDir = getWorldPacksDir();

    this.prisma = new PrismaClient();
    this.loader = new WorldPackLoader(this.packsDir);
    this.clock = new ChronosEngine([], 0n);
    this.resolver = new NarrativeResolver({});
    this.dynamics = new ValueDynamicsManager();
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

  public async init(packFolderName: string) {
    await this.prepareDatabase();

    const pack = this.loader.loadPack(packFolderName);
    this.activePack = pack;

    const runtimeConfig = getWorldPackRuntimeConfig(pack);
    const calendars = (pack.time_systems ?? []) as unknown as CalendarConfig[];

    if (runtimeConfig.configuredStepTicks !== undefined && runtimeConfig.configuredStepTicks > 0n) {
      this.runtimeSpeed.setConfiguredStepTicks(runtimeConfig.configuredStepTicks);
    } else {
      this.runtimeSpeed.setConfiguredStepTicks(null);
      if (runtimeConfig.configuredStepTicks !== undefined) {
        notifications.push('warning', '世界包字段 simulation_time.step_ticks 必须大于 0，已回退为 1', 'PACK_STEP_TICK_INVALID');
      }
    }

    this.clock = new ChronosEngine(calendars, runtimeConfig.initialTick);
    this.resolver = new NarrativeResolver(pack.variables || {});
    this.dynamics = new ValueDynamicsManager();

    await materializeWorldPackScenario(this.prisma, pack, runtimeConfig.initialTick ?? 0n);

    const lastEvent = await this.prisma.event.findFirst({
      orderBy: { tick: 'desc' }
    });
    if (lastEvent) {
      this.clock = new ChronosEngine(calendars, lastEvent.tick);
    }

    const currentTick = this.clock.getTicks();
    if (runtimeConfig.minTick !== undefined && currentTick < runtimeConfig.minTick) {
      notifications.push(
        'warning',
        `当前模拟时间 ${currentTick.toString()} 低于世界包最小时间 ${runtimeConfig.minTick.toString()}`,
        'SIM_TICK_BELOW_MIN'
      );
    }
    if (runtimeConfig.maxTick !== undefined && currentTick > runtimeConfig.maxTick) {
      notifications.push(
        'warning',
        `当前模拟时间 ${currentTick.toString()} 超出世界包最大时间 ${runtimeConfig.maxTick.toString()}`,
        'SIM_TICK_ABOVE_MAX'
      );
    }

    console.log(`[SimulationManager] Initialized with pack: ${pack.metadata.name}`);
  }

  public getActivePack() {
    return this.activePack;
  }

  public getStepTicks() {
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

  public async step(amount: bigint = 1n) {
    this.clock.tick(amount);
  }

  public async getGraphData() {
    return getGraphData(this.prisma);
  }
}

export const sim = new SimulationManager();
