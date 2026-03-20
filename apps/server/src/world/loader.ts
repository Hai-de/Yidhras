import fs from 'fs';
import path from 'path';
import yaml from 'yaml';

import { CalendarConfig } from '../clock/types.js';
import { VariablePool } from '../narrative/types.js';

type WorldPackExtra = Record<string, unknown>;

export interface WorldPack {
  metadata: {
    id: string;
    name: string;
    version: string;
    [key: string]: unknown;
  };
  variables?: VariablePool;
  prompts?: Record<string, string>;
  time_systems?: CalendarConfig[];
  // 允许任意扩展字段 (如: dynamics_config, item_definitions)
  [key: string]: unknown;
}

export class WorldPackLoader {
  private packs: Map<string, WorldPack> = new Map();

  constructor(private packsDir: string) {}

  /**
   * 按需加载一个世界包 (由文件夹名决定加载路径，不再全量扫描)
   * @param folderName 文件夹名称 (如: 'cyber_noir')
   */
  public loadPack(folderName: string): WorldPack {
    if (this.packs.has(folderName)) {
      return this.packs.get(folderName)!;
    }

    const potentialFiles = ['config.yaml', 'config.yml', 'pack.yaml', 'pack.yml'];
    let packPath: string | null = null;

    for (const file of potentialFiles) {
      const filePath = path.join(this.packsDir, folderName, file);
      if (fs.existsSync(filePath)) {
        packPath = filePath;
        break;
      }
    }

    if (!packPath) {
      throw new Error(`[WorldPackLoader] World Pack not found in directory: ${folderName}`);
    }

    try {
      const content = fs.readFileSync(packPath, 'utf-8');
      const parsed = yaml.parse(content) as WorldPack;
      
      if (!parsed.metadata || !parsed.metadata.id) {
        throw new Error(`[WorldPackLoader] Skipping invalid pack (missing metadata.id): ${packPath}`);
      }

      // 同时用 folderName 和 ID 索引
      this.packs.set(folderName, parsed);
      this.packs.set(parsed.metadata.id, parsed);
      
      console.log(`[WorldPackLoader] Loaded pack: ${parsed.metadata.name} (${parsed.metadata.id})`);
      return parsed;
    } catch (err) {
      console.error(`[WorldPackLoader] Error parsing ${packPath}:`, err);
      throw err;
    }
  }

  /**
   * 获取已加载的世界包 (支持通过 ID 或 folderName 获取)
   */
  public getPack(idOrFolderName: string): WorldPack | undefined {
    return this.packs.get(idOrFolderName);
  }

  /**
   * 获取所有已加载的包
   */
  public getAllPacks(): WorldPack[] {
    // 使用 Set 去重，避免 ID 和 folderName 重复计数
    return Array.from(new Set(this.packs.values()));
  }

  /**
   * 列表显示目录下所有可用的包名 (文件夹名)
   */
  public listAvailablePacks(): string[] {
    if (!fs.existsSync(this.packsDir)) return [];
    return fs.readdirSync(this.packsDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);
  }

  /**
   * 聚合所有已加载包的变量池
   */
  public getMergedVariables(): VariablePool {
    let merged: VariablePool = {};
    for (const pack of this.getAllPacks()) {
      if (pack.variables) {
        merged = { ...merged, ...(pack.variables as WorldPackExtra) } as VariablePool;
      }
    }
    return merged;
  }
}
