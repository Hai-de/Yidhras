import type { PrismaClient } from '@prisma/client';

import type { InstalledPackRuntimeSummary } from '../../kernel/install/install_pack.js';
import { installPackRuntime } from '../../kernel/install/install_pack.js';
import type { WorldPack } from '../manifest/constitution_loader.js';
import type { PackRuntimeMaterializeSummary } from '../runtime/core_models.js';
import { type ActorBridgeSummary,materializeActorBridges, materializePackRuntimeCoreModels } from '../runtime/materializer.js';
import type { PackStorageAdapter } from '../storage/PackStorageAdapter.js';

export interface MaterializePackRuntimeInput {
  instanceId: string;
  pack: WorldPack;
  prisma: PrismaClient;
  packStorageAdapter: PackStorageAdapter;
  initialTick: bigint;
  appliedOpeningId?: string;
}

export interface MaterializePackRuntimeOutput {
  install: InstalledPackRuntimeSummary;
  coreModels: PackRuntimeMaterializeSummary;
  actorBridges: ActorBridgeSummary;
}

/**
 * 对任意 pack 执行完整的 runtime materialization：
 *   1. installPackRuntime   — 创建/确认 per-pack SQLite 数据库与表结构
 *   2. materializePackRuntimeCoreModels — 写入 entities / states / authorities / mediators
 *   3. materializeActorBridges — 在 kernel-side Prisma 创建 Agent / Identity / Binding
 *
 * installPackRuntime 是幂等的（CREATE TABLE IF NOT EXISTS）。
 * materialization repos 使用 upsert，重复调用不会重复创建。
 *
 * 如果 runtime.sqlite 尚未创建，materialization repos 会抛出异常；
 * 因此必须先调用 installPackRuntime。
 */
export async function materializePackRuntime(
  input: MaterializePackRuntimeInput
): Promise<MaterializePackRuntimeOutput> {
  const { instanceId, pack, prisma, packStorageAdapter, initialTick, appliedOpeningId } = input;

  const install = await installPackRuntime(instanceId, pack, packStorageAdapter);
  const coreModels = await materializePackRuntimeCoreModels(instanceId, pack, initialTick, packStorageAdapter, appliedOpeningId, prisma);
  const actorBridges = await materializeActorBridges(instanceId, pack, prisma, initialTick);

  return { install, coreModels, actorBridges };
}
