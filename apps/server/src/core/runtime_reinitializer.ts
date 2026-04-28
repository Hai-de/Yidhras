import type { PrismaClient } from '@prisma/client';

import { teardownActorBridges } from '../packs/runtime/materializer.js';
import { clearPackRuntimeStorage } from '../packs/runtime/teardown.js';
import type { NotificationPort } from './runtime_activation.js';
import type { SimulationManager } from './simulation.js';

export interface ReinitializePackRuntimeInput {
  sim: SimulationManager;
  packFolderName: string;
  packId: string;
  openingId: string;
  prisma: PrismaClient;
  notifications: NotificationPort;
}

export const reinitializePackRuntime = async (input: ReinitializePackRuntimeInput): Promise<void> => {
  const { sim, packFolderName, packId, openingId, prisma, notifications } = input;

  notifications.push('info', `正在为包 "${packId}" 重新初始化，应用开局 "${openingId}"...`, 'PACK_REINIT_START');

  clearPackRuntimeStorage(packId);

  const deletedCount = await teardownActorBridges(packId, prisma);
  if (deletedCount > 0) {
    notifications.push('info', `已清理 ${deletedCount} 条 kernel 桥接记录`, 'PACK_REINIT_CLEANED');
  }

  await sim.init(packFolderName, openingId);

  notifications.push('info', `包 "${packId}" 重新初始化完成，已应用开局 "${openingId}"`, 'PACK_REINIT_OK');
};
