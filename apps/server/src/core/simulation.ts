import 'dotenv/config';

import { PrismaClient } from '@prisma/client';
import path from 'path';

import { ChronosEngine } from '../clock/engine.js';
import { ValueDynamicsManager } from '../dynamics/manager.js';
import { NarrativeResolver } from '../narrative/resolver.js';
import { WorldPack, WorldPackLoader } from '../world/loader.js';

export class SimulationManager {
  public prisma: PrismaClient;
  public loader: WorldPackLoader;
  public clock!: ChronosEngine;
  public resolver!: NarrativeResolver;
  public dynamics!: ValueDynamicsManager;
  
  private activePack?: WorldPack;

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

    this.clock = new ChronosEngine(pack.time_systems || []);
    this.resolver = new NarrativeResolver(pack.variables || {});
    this.dynamics = new ValueDynamicsManager();

    // 尝试恢复最后的时间状态
    const lastEvent = await this.prisma.event.findFirst({
      orderBy: { tick: 'desc' }
    });
    if (lastEvent) {
      this.clock = new ChronosEngine(pack.time_systems || [], lastEvent.tick);
    }

    console.log(`[SimulationManager] Initialized with pack: ${pack.metadata.name}`);
  }

  public getActivePack() {
    return this.activePack;
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
