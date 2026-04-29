import type { PackStorageAdapter } from '../storage/PackStorageAdapter.js';

export const clearPackRuntimeStorage = async (
  adapter: PackStorageAdapter,
  packId: string
): Promise<boolean> => {
  const existed = await adapter.ping(packId);
  await adapter.destroyPackStorage(packId);
  return existed;
};
