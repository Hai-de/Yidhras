import path from 'path';
import * as YAML from 'yaml';

import { createLogger } from '../../utils/logger.js';
import { safeFs } from '../../utils/safe_fs.js';
import type { SimulationTimeConfig, WorldPack } from './constitution_loader.js';
import { parseWorldPackConstitution } from './constitution_loader.js';
import { resolveIncludes } from './include_resolver.js';

const logger = createLogger('pack-manifest-loader');

export class PackManifestLoader {
  private packs: Map<string, WorldPack> = new Map();
  private instanceIndex: Map<string, string> = new Map();

  constructor(private packsDir: string) {}

  public deriveInstanceId(pack: WorldPack, folderName: string): string {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- pack manifest parsing
    const explicit = (pack.metadata as Record<string, unknown>).instance_id as string | undefined;
    return explicit?.trim() || folderName;
  }

  public loadPack(folderName: string): WorldPack {
    if (this.packs.has(folderName)) {
      return this.packs.get(folderName)!;
    }

    const potentialFiles = ['pack.yaml', 'pack.yml'];
    let packPath: string | null = null;

    for (const file of potentialFiles) {
      const filePath = path.join(this.packsDir, folderName, file);
      if (safeFs.existsSync(this.packsDir, filePath)) {
        packPath = filePath;
        break;
      }
    }

    if (!packPath) {
      throw new Error(`[PackManifestLoader] World pack not found in directory: ${folderName}`);
    }

    try {
      const content = safeFs.readFileSync(this.packsDir, packPath, 'utf-8');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- pack manifest parsing
      const entryYaml = YAML.parse(content) as Record<string, unknown>;

      if (!entryYaml || typeof entryYaml !== 'object') {
        throw new Error(`[PackManifestLoader] ${folderName}: entry YAML resolved to non-object`);
      }

      const packDirAbs = path.resolve(this.packsDir, folderName);
      const { merged, diagnostics } = resolveIncludes(entryYaml, packDirAbs);

      const errors = diagnostics.filter((d) => d.severity === 'ERROR');
      if (errors.length > 0) {
        throw new Error(
          `[PackManifestLoader] ${folderName}: include resolution failed:\n` +
            errors.map((e) => `  - ${e.section ? `[${e.section}] ` : ''}${e.message}`).join('\n')
        );
      }

      const parsed = parseWorldPackConstitution(merged, packPath);

      const instanceId = this.deriveInstanceId(parsed, folderName);
      const existingFolder = this.instanceIndex.get(instanceId);
      if (existingFolder && existingFolder !== folderName) {
        throw new Error(
          `instance_id conflict: "${instanceId}" claimed by both "${existingFolder}" and "${folderName}"`
        );
      }

      this.packs.set(folderName, parsed);
      this.instanceIndex.set(instanceId, folderName);

      logger.info(`Loaded pack: ${parsed.metadata.name} (${parsed.metadata.id}) [instance: ${instanceId}]`);
      return parsed;
    } catch (err) {
      logger.error(`Error parsing ${packPath}`, { error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  public getPack(folderName: string): WorldPack | undefined {
    return this.packs.get(folderName);
  }

  public getPackByFolderName(folderName: string): WorldPack | undefined {
    return this.packs.get(folderName);
  }

  public getPackByInstanceId(instanceId: string): WorldPack | undefined {
    const folderName = this.instanceIndex.get(instanceId);
    return folderName ? this.packs.get(folderName) : undefined;
  }

  public getFolderNameByInstanceId(instanceId: string): string | undefined {
    return this.instanceIndex.get(instanceId);
  }

  public getAllPacks(): WorldPack[] {
    return Array.from(this.packs.values());
  }

  public listAvailablePacks(): string[] {
    if (!safeFs.existsSync(this.packsDir, this.packsDir)) {
      return [];
    }

    const configFiles = ['pack.yaml', 'pack.yml'];

    return safeFs
      .readdirSync(this.packsDir, this.packsDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .filter(entry => configFiles.some(file => safeFs.existsSync(this.packsDir, path.join(this.packsDir, entry.name, file))))
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
