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

  constructor(private packsDir: string) {}

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
