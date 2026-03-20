import 'dotenv/config';

import { PrismaClient } from '@prisma/client';
import path from 'path';

import { ChronosEngine } from '../clock/engine.js';
import { ValueDynamicsManager } from '../dynamics/manager.js';
import { NarrativeResolver } from '../narrative/resolver.js';
import { notifications } from '../utils/notifications.js';
import { WorldPack, WorldPackLoader } from '../world/loader.js';

const parseTickToBigInt = (
  value: string | number | undefined,
  fieldName: string
): bigint | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  try {
    return BigInt(value);
  } catch {
    notifications.push('warning', `世界包字段 ${fieldName} 无法解析为 BigInt，已忽略该配置`, 'PACK_TIME_PARSE_WARN');
    return undefined;
  }
};

export class SimulationManager {
  public prisma: PrismaClient;
  public loader: WorldPackLoader;
  public clock!: ChronosEngine;
  public resolver!: NarrativeResolver;
  public dynamics!: ValueDynamicsManager;
  
  private activePack?: WorldPack;
  private stepTicks: bigint = 1n;

  constructor() {
    // 降级到 v6.2.1 后，使用标准初始化
    this.prisma = new PrismaClient();
    this.loader = new WorldPackLoader(path.resolve('../../data/world_packs'));
  }

  /**
   * 初始化模拟环境
   * @param packFolderName 世界包文件夹名 (如: 'cyber_noir')
   */
  public async init(packFolderName: string) {
    const pack = this.loader.loadPack(packFolderName);
    this.activePack = pack;

    const configuredInitialTick = parseTickToBigInt(pack.simulation_time?.initial_tick, 'simulation_time.initial_tick');
    const initialTick = configuredInitialTick ?? 0n;
    const minTick = parseTickToBigInt(pack.simulation_time?.min_tick, 'simulation_time.min_tick');
    const maxTick = parseTickToBigInt(pack.simulation_time?.max_tick, 'simulation_time.max_tick');
    const configuredStepTicks = parseTickToBigInt(pack.simulation_time?.step_ticks, 'simulation_time.step_ticks');

    if (configuredStepTicks !== undefined && configuredStepTicks > 0n) {
      this.stepTicks = configuredStepTicks;
    } else {
      this.stepTicks = 1n;
      if (configuredStepTicks !== undefined) {
        notifications.push('warning', '世界包字段 simulation_time.step_ticks 必须大于 0，已回退为 1', 'PACK_STEP_TICK_INVALID');
      }
    }

    this.clock = new ChronosEngine(pack.time_systems || [], initialTick);
    this.resolver = new NarrativeResolver(pack.variables || {});
    this.dynamics = new ValueDynamicsManager();

    // 尝试恢复最后的时间状态
    const lastEvent = await this.prisma.event.findFirst({
      orderBy: { tick: 'desc' }
    });
    if (lastEvent) {
      this.clock = new ChronosEngine(pack.time_systems || [], lastEvent.tick);
    }

    const currentTick = this.clock.getTicks();
    if (minTick !== undefined && currentTick < minTick) {
      notifications.push(
        'warning',
        `当前模拟时间 ${currentTick.toString()} 低于世界包最小时间 ${minTick.toString()}`,
        'SIM_TICK_BELOW_MIN'
      );
    }
    if (maxTick !== undefined && currentTick > maxTick) {
      notifications.push(
        'warning',
        `当前模拟时间 ${currentTick.toString()} 超出世界包最大时间 ${maxTick.toString()}`,
        'SIM_TICK_ABOVE_MAX'
      );
    }

    console.log(`[SimulationManager] Initialized with pack: ${pack.metadata.name}`);
  }

  public getActivePack() {
    return this.activePack;
  }

  public getStepTicks() {
    return this.stepTicks;
  }

  /**
   * 模拟步进
   */
  public async step(amount: bigint = 1n) {
    this.clock.tick(amount);
    // TODO: 触发 Agent 决策逻辑
  }

  /**
   * 获取 Cytoscape 格式的关系图数据
   */
  public async getGraphData() {
    const agents = await this.prisma.agent.findMany();
    const relations = await this.prisma.relationship.findMany();

    const nodes = agents.map(a => ({
      data: { 
        id: a.id, 
        label: a.name, 
        snr: a.snr, 
        type: a.type,
        is_pinned: a.is_pinned 
      }
    }));

    const edges = relations.map(r => ({
      data: { 
        id: r.id, 
        source: r.from_id, 
        target: r.to_id, 
        type: r.type, 
        weight: r.weight 
      }
    }));

    return { nodes, edges };
  }
}

export const sim = new SimulationManager();
