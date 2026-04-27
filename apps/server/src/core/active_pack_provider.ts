import type { WorldPack } from '../packs/manifest/loader.js';

export interface ActivePackProvider {
  getActivePack(): WorldPack | undefined;
  getCurrentRevision(): bigint;
}
