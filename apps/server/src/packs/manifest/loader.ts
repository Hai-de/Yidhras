import fs from 'fs';
import path from 'path';
import * as YAML from 'yaml';

import { createLogger } from '../../utils/logger.js';
import type { SimulationTimeConfig, WorldPack } from './constitution_loader.js';
import { parseWorldPackConstitution } from './constitution_loader.js';

const logger = createLogger('pack-manifest-loader');

export class PackManifestLoader {
  private packs: Map<string, WorldPack> = new Map();

  constructor(private packsDir: string) {}

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
      throw new Error(`[PackManifestLoader] World pack not found in directory: ${folderName}`);
    }

    try {
      const content = fs.readFileSync(packPath, 'utf-8');
      const parsedYaml = YAML.parse(content) as unknown;
      const parsed = parseWorldPackConstitution(parsedYaml, packPath);

      this.packs.set(folderName, parsed);
      this.packs.set(parsed.metadata.id, parsed);

      logger.info(`Loaded pack: ${parsed.metadata.name} (${parsed.metadata.id})`);
      return parsed;
    } catch (err) {
      logger.error(`Error parsing ${packPath}`, { error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  public getPack(idOrFolderName: string): WorldPack | undefined {
    return this.packs.get(idOrFolderName);
  }

  public getAllPacks(): WorldPack[] {
    return Array.from(new Set(this.packs.values()));
  }

  public listAvailablePacks(): string[] {
    if (!fs.existsSync(this.packsDir)) {
      return [];
    }

    return fs
      .readdirSync(this.packsDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);
  }

  public getMergedVariables(): Record<string, unknown> {
    let merged: Record<string, unknown> = {};
    for (const pack of this.getAllPacks()) {
      if (pack.variables) {
        merged = { ...merged, ...pack.variables };
      }
    }
    return merged;
  }
}

export type { SimulationTimeConfig, WorldPack };
