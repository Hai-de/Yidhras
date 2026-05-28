import type { PackCatalogService } from '../../app/services/app_context_ports.js';
import { PackManifestLoader, type WorldPack } from '../manifest/loader.js';

export interface PackResolution {
  pack: WorldPack;
  packFolderName: string;
}

export interface PackInstanceInfo {
  instanceId: string;
  metadataId: string;
  folderName: string;
  name: string;
  version: string;
}

export interface DefaultPackCatalogServiceOptions {
  packsDir: string;
  loader?: PackManifestLoader;
}

export class DefaultPackCatalogService implements PackCatalogService {
  private readonly packsDir: string;
  private readonly loader: PackManifestLoader;

  constructor(options: DefaultPackCatalogServiceOptions) {
    this.packsDir = options.packsDir;
    this.loader = options.loader ?? new PackManifestLoader(this.packsDir);
  }

  public getLoader(): PackManifestLoader {
    return this.loader;
  }

  public listAvailablePacks(): string[] {
    return this.loader.listAvailablePacks();
  }

  public getPacksDir(): string {
    return this.packsDir;
  }

  public resolveByInstanceId(instanceId: string): PackResolution | null {
    const folderName = this.loader.getFolderNameByInstanceId(instanceId);
    if (!folderName) return null;
    try {
      const pack = this.loader.loadPack(folderName);
      return { pack, packFolderName: folderName };
    } catch {
      return null;
    }
  }

  public resolvePackByIdOrFolder(packRef: string): PackResolution | null {
    const normalizedPackRef = packRef.trim();
    if (normalizedPackRef.length === 0) {
      return null;
    }

    // 1. instance_id exact match
    const byInstance = this.resolveByInstanceId(normalizedPackRef);
    if (byInstance) return byInstance;

    // 2. folder_name exact match
    for (const packFolderName of this.listAvailablePacks()) {
      if (packFolderName === normalizedPackRef) {
        const pack = this.loader.loadPack(packFolderName);
        return { pack, packFolderName };
      }
    }

    return null;
  }

  public listAllInstances(): PackInstanceInfo[] {
    return this.listAvailablePacks().map(folderName => {
      const pack = this.loader.loadPack(folderName);
      return {
        instanceId: this.loader.deriveInstanceId(pack, folderName),
        metadataId: pack.metadata.id,
        folderName,
        name: pack.metadata.name,
        version: pack.metadata.version
      };
    });
  }

  public findFolderNameByPackId(instanceId: string): string | null {
    return this.loader.getFolderNameByInstanceId(instanceId) ?? null;
  }
}
