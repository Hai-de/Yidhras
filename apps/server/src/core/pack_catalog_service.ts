import type { PackCatalogService } from '../app/services/app_context_ports.js';
import { PackManifestLoader, type WorldPack } from '../packs/manifest/loader.js';

export interface PackResolution {
  pack: WorldPack;
  packFolderName: string;
}

export interface DefaultPackCatalogServiceOptions {
  packsDir: string;
  loader?: PackManifestLoader;
  getActivePack?: () => WorldPack | undefined;
}

export class DefaultPackCatalogService implements PackCatalogService {
  private readonly packsDir: string;
  private readonly loader: PackManifestLoader;
  private readonly getActivePackRef: () => WorldPack | undefined;

  constructor(options: DefaultPackCatalogServiceOptions) {
    this.packsDir = options.packsDir;
    this.loader = options.loader ?? new PackManifestLoader(this.packsDir);
    this.getActivePackRef = options.getActivePack ?? (() => undefined);
  }

  public listAvailablePacks(): string[] {
    return this.loader.listAvailablePacks();
  }

  public getPacksDir(): string {
    return this.packsDir;
  }

  public resolvePackByIdOrFolder(packRef: string): PackResolution | null {
    const normalizedPackRef = packRef.trim();
    if (normalizedPackRef.length === 0) {
      return null;
    }

    const activePack = this.getActivePackRef();
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

  public findFolderNameByPackId(packId: string): string | null {
    for (const packFolderName of this.listAvailablePacks()) {
      const pack = this.loader.loadPack(packFolderName);
      if (pack.metadata.id === packId) {
        return packFolderName;
      }
    }

    return null;
  }
}
