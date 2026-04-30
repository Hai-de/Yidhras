/**
 * 设计决策：快照恢复为何直接复制 runtime.sqlite 而非使用 adapter.importPackData()
 *
 * 见 snapshot_capture.ts 顶部完整说明。简言之：SQLite 文件级快照保留完整数据库物理状态，
 * 行数据导入无法替代；PostgreSQL 部署者应使用 pg_dump/pg_basebackup 等原生工具。
 */
import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import type { PackSnapshotPrismaData } from '@yidhras/contracts';
import { packSnapshotPrismaDataSchema } from '@yidhras/contracts';
import fs from 'fs';
import { gunzipSync } from 'zlib';

import type { RuntimeClockProjectionSnapshot } from '../../app/runtime/runtime_clock_projection.js';
import type { WorldEnginePort } from '../../app/runtime/world_engine_ports.js';
import { buildWorldPackHydrateRequest } from '../../app/runtime/world_engine_snapshot.js';
import type { ActivePackRuntimeFacade } from '../../app/services/app_context_ports.js';
import type { TimeFormatted } from '../../clock/types.js';
import type { NotificationPort } from '../../core/runtime_activation.js';
import type { WorldPack } from '../../packs/manifest/loader.js';
import { safeFs } from '../../utils/safe_fs.js';
import { clearPackRuntimeStorage } from '../runtime/teardown.js';
import { listPackEntityStates } from '../storage/entity_state_repo.js';
import { getPackRootDir, resolvePackRuntimeDatabaseLocation } from '../storage/pack_db_locator.js';
import type { PackStorageAdapter } from '../storage/PackStorageAdapter.js';
import {
  readSnapshotMetadata,
  resolveSnapshotLocation,
  resolveStoragePlanPathInChain,
  snapshotFilesExist
} from './snapshot_locator.js';

const parseBigInt = (value: string): bigint => BigInt(value);

const jsonOrNull = (value: unknown): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput => {
  if (value === null || value === undefined) {
    return Prisma.JsonNull;
  }
  return value as Prisma.InputJsonValue;
};

const jsonValue = (value: unknown): Prisma.InputJsonValue => {
  return (value ?? {}) as Prisma.InputJsonValue;
};

const readPrismaData = (location: { prismaJsonPath: string; packId: string }): PackSnapshotPrismaData => {
  const compressed = fs.readFileSync(location.prismaJsonPath);
  const raw = gunzipSync(compressed).toString('utf-8');
  const parsed = JSON.parse(raw) as unknown;
  return packSnapshotPrismaDataSchema.parse(parsed);
};

const readAppliedOpeningId = async (adapter: PackStorageAdapter, packId: string): Promise<string | null> => {
  const states = await listPackEntityStates(adapter, packId);
  const metaState = states.find(
    (s) => s.entity_id === `${packId}:entity:__world__` && s.state_namespace === 'meta'
  );
  if (!metaState || typeof metaState.state_json !== 'object' || metaState.state_json === null) {
    return null;
  }
  const stateJson = metaState.state_json;
  return typeof stateJson.applied_opening_id === 'string' ? stateJson.applied_opening_id : null;
};

const teardownPrismaPackData = async (
  prisma: PrismaClient,
  packId: string,
  agentIds: string[]
): Promise<void> => {
  await prisma.post.deleteMany({
    where: agentIds.length > 0 ? { author_id: { in: agentIds } } : { id: { startsWith: `${packId}:` } }
  });

  await prisma.relationship.deleteMany({
    where:
      agentIds.length > 0
        ? { OR: [{ from_id: { in: agentIds } }, { to_id: { in: agentIds } }] }
        : { id: { startsWith: `${packId}:` } }
  });

  await prisma.memoryBlock.deleteMany({ where: { pack_id: packId } });

  await prisma.contextOverlayEntry.deleteMany({ where: { pack_id: packId } });

  await prisma.memoryCompactionState.deleteMany({ where: { pack_id: packId } });

  await prisma.scenarioEntityState.deleteMany({ where: { pack_id: packId } });
};

const restorePrismaData = async (
  prisma: PrismaClient,
  data: PackSnapshotPrismaData
): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    for (const agent of data.agents) {
      await tx.agent.create({
        data: {
          id: agent.id,
          name: agent.name,
          type: agent.type,
          snr: agent.snr,
          is_pinned: agent.is_pinned,
          created_at: parseBigInt(agent.created_at),
          updated_at: parseBigInt(agent.updated_at)
        }
      });
    }

    for (const identity of data.identities) {
      await tx.identity.create({
        data: {
          id: identity.id,
          type: identity.type,
          name: identity.name,
          provider: identity.provider,
          status: identity.status,
          claims: jsonOrNull(identity.claims),
          metadata: jsonOrNull(identity.metadata),
          created_at: parseBigInt(identity.created_at),
          updated_at: parseBigInt(identity.updated_at)
        }
      });
    }

    for (const binding of data.identity_node_bindings) {
      await tx.identityNodeBinding.create({
        data: {
          id: binding.id,
          identity_id: binding.identity_id,
          agent_id: binding.agent_id,
          atmosphere_node_id: binding.atmosphere_node_id,
          role: binding.role,
          status: binding.status,
          created_at: parseBigInt(binding.created_at),
          updated_at: parseBigInt(binding.updated_at)
        }
      });
    }

    for (const post of data.posts) {
      await tx.post.create({
        data: {
          id: post.id,
          author_id: post.author_id,
          source_action_intent_id: post.source_action_intent_id,
          content: post.content,
          noise_level: post.noise_level,
          is_encrypted: post.is_encrypted,
          created_at: parseBigInt(post.created_at)
        }
      });
    }

    for (const rel of data.relationships) {
      await tx.relationship.create({
        data: {
          id: rel.id,
          from_id: rel.from_id,
          to_id: rel.to_id,
          type: rel.type,
          weight: rel.weight,
          created_at: parseBigInt(rel.created_at),
          updated_at: parseBigInt(rel.updated_at)
        }
      });
    }

    for (const mem of data.memory_blocks) {
      await tx.memoryBlock.create({
        data: {
          id: mem.id,
          owner_agent_id: mem.owner_agent_id,
          pack_id: data.pack_id,
          kind: mem.kind,
          status: mem.status,
          title: mem.title,
          content_text: mem.content_text,
          content_structured: jsonOrNull(mem.content_structured),
          tags: mem.tags,
          keywords: mem.keywords,
          source_ref: jsonOrNull(mem.source_ref),
          importance: mem.importance,
          salience: mem.salience,
          confidence: mem.confidence,
          created_at_tick: parseBigInt(mem.created_at_tick),
          updated_at_tick: parseBigInt(mem.updated_at_tick)
        }
      });

      if (mem.behavior) {
        const behavior = mem.behavior as Record<string, unknown>;
        await tx.memoryBlockBehavior.create({
          data: {
            memory_block_id: mem.id,
            behavior_json: jsonValue(behavior),
            created_at_tick: parseBigInt(mem.updated_at_tick),
            updated_at_tick: parseBigInt(mem.updated_at_tick)
          }
        });
      }

      if (mem.runtime_state) {
        const rs = mem.runtime_state as Record<string, unknown>;
        await tx.memoryBlockRuntimeState.create({
          data: {
            memory_block_id: mem.id,
            trigger_count: typeof rs.trigger_count === 'number' ? rs.trigger_count : 0,
            last_triggered_tick: typeof rs.last_triggered_tick === 'string' ? parseBigInt(rs.last_triggered_tick) : null,
            last_inserted_tick: typeof rs.last_inserted_tick === 'string' ? parseBigInt(rs.last_inserted_tick) : null,
            cooldown_until_tick: typeof rs.cooldown_until_tick === 'string' ? parseBigInt(rs.cooldown_until_tick) : null,
            delayed_until_tick: typeof rs.delayed_until_tick === 'string' ? parseBigInt(rs.delayed_until_tick) : null,
            retain_until_tick: typeof rs.retain_until_tick === 'string' ? parseBigInt(rs.retain_until_tick) : null,
            currently_active: typeof rs.currently_active === 'boolean' ? rs.currently_active : false,
            last_activation_score: typeof rs.last_activation_score === 'number' ? rs.last_activation_score : null,
            recent_distance_from_latest_message: typeof rs.recent_distance_from_latest_message === 'number' ? rs.recent_distance_from_latest_message : null
          }
        });
      }
    }

    for (const entry of data.context_overlay_entries) {
      await tx.contextOverlayEntry.create({
        data: {
          id: entry.id,
          actor_id: entry.actor_id,
          pack_id: data.pack_id,
          overlay_type: entry.overlay_type,
          title: entry.title,
          content_text: entry.content_text,
          content_structured: jsonOrNull(entry.content_structured),
          tags: entry.tags,
          status: entry.status,
          persistence_mode: entry.persistence_mode,
          source_node_ids: entry.source_node_ids,
          created_by: entry.created_by,
          created_at_tick: parseBigInt(entry.created_at_tick),
          updated_at_tick: parseBigInt(entry.updated_at_tick)
        }
      });
    }

    for (const state of data.memory_compaction_states) {
      await tx.memoryCompactionState.create({
        data: {
          agent_id: state.agent_id,
          pack_id: data.pack_id,
          inference_count_since_summary: state.inference_count_since_summary,
          inference_count_since_compaction: state.inference_count_since_compaction,
          last_summary_tick: state.last_summary_tick !== null ? parseBigInt(state.last_summary_tick) : null,
          last_compaction_tick: state.last_compaction_tick !== null ? parseBigInt(state.last_compaction_tick) : null,
          updated_at_tick: parseBigInt(state.updated_at_tick)
        }
      });
    }

    for (const ses of data.scenario_entity_states) {
      await tx.scenarioEntityState.create({
        data: {
          id: ses.id,
          pack_id: data.pack_id,
          entity_type: ses.entity_type,
          entity_id: ses.entity_id,
          state_json: jsonValue(ses.state_json),
          created_at: parseBigInt(ses.created_at),
          updated_at: parseBigInt(ses.updated_at)
        }
      });
    }
  });
};

export interface RestorePackSnapshotInput {
  packId: string;
  snapshotId: string;
  prisma: PrismaClient;
  packStorageAdapter: PackStorageAdapter;
  pack: WorldPack;
  activePackRuntime?: ActivePackRuntimeFacade;
  applyClockProjection: (snapshot: RuntimeClockProjectionSnapshot) => void;
  worldEngine?: WorldEnginePort;
  notifications: NotificationPort;
}

export interface RestorePackSnapshotResult {
  pack_id: string;
  snapshot_id: string;
  restored_at_tick: string;
}

export const restorePackSnapshot = async (input: RestorePackSnapshotInput): Promise<RestorePackSnapshotResult> => {
  const { packId, snapshotId, prisma, packStorageAdapter, pack, activePackRuntime, applyClockProjection, worldEngine, notifications } = input;

  if (packStorageAdapter.backend !== 'sqlite') {
    throw new Error(
      `[snapshot_restore] 快照功能仅支持 SQLite 后端，当前后端为 ${packStorageAdapter.backend}。请使用数据库原生工具进行恢复。`
    );
  }

  const location = resolveSnapshotLocation(packId, snapshotId);
  const packRoot = getPackRootDir(packId);

  if (!snapshotFilesExist(location)) {
    throw new Error(`Snapshot "${snapshotId}" is incomplete or missing files`);
  }

  const metadata = readSnapshotMetadata(location);
  const prismaData = readPrismaData(location);
  const agentIds = prismaData.agents.map((a) => a.id);

  notifications.push('info', `正在从快照 "${snapshotId}" 恢复包 "${packId}"...`, 'SNAPSHOT_RESTORE_START');

  // 1. Unload sidecar
  if (worldEngine) {
    try {
      await worldEngine.unloadPack({ pack_id: packId });
    } catch {
      // sidecar may not have the pack loaded; ignore
    }
  }

  // 2. Clear runtime storage
  await clearPackRuntimeStorage(packStorageAdapter, packId);

  // 3. Teardown kernel bridges
  const { teardownActorBridges } = await import('../runtime/materializer.js');
  await teardownActorBridges(packId, prisma);

  // 4. Teardown pack-scoped Prisma data
  await teardownPrismaPackData(prisma, packId, agentIds);

  // 5. Restore SQLite (gunzip compressed snapshot)
  const runtimeDbLocation = resolvePackRuntimeDatabaseLocation(packId);
  safeFs.mkdirSync(packRoot, runtimeDbLocation.packRootDir, { recursive: true });
  const compressedDb = fs.readFileSync(location.runtimeDbPath);
  const decompressedDb = gunzipSync(compressedDb);
  safeFs.writeFileSync(packRoot, runtimeDbLocation.runtimeDbPath, decompressedDb);

  const storagePlanPath = `${runtimeDbLocation.runtimeDbPath}.storage-plan.json`;
  const resolvedStoragePlanPath = resolveStoragePlanPathInChain(packId, snapshotId);
  if (resolvedStoragePlanPath) {
    safeFs.copyFileSync(packRoot, resolvedStoragePlanPath, storagePlanPath);
  }

  // 6. Read applied_opening_id from restored SQLite
  const appliedOpeningId = await readAppliedOpeningId(packStorageAdapter, packId);

  // 7. Restore Prisma data
  await restorePrismaData(prisma, prismaData);

  notifications.push(
    'info',
    `已恢复 ${prismaData.agents.length} agents, ${prismaData.posts.length} posts, ${prismaData.memory_blocks.length} memory blocks`,
    'SNAPSHOT_RESTORE_PRISMA'
  );

  // 8. Materialize (idempotent)
  const { materializePackRuntime } = await import('../../core/pack_materializer.js');
  const tick = parseBigInt(metadata.captured_at_tick);
  await materializePackRuntime({ pack, prisma, packStorageAdapter, initialTick: tick, appliedOpeningId: appliedOpeningId ?? undefined });

  // 9. Restore in-memory clock
  const clockSnapshot: RuntimeClockProjectionSnapshot = {
    pack_id: packId,
    current_tick: metadata.captured_at_tick,
    current_revision: metadata.captured_at_revision,
    calendars: (pack.time_systems ?? []) as unknown as TimeFormatted[],
    source: 'host_projection',
    updated_at_ms: Date.now(),
    generation: 1
  };
  applyClockProjection(clockSnapshot);

  // 10. Reload sidecar with restored state
  if (worldEngine) {
    const hydrateRequest = await buildWorldPackHydrateRequest(
      { activePackRuntime } as import('../../app/context.js').AppContext,
      packId
    );
    await worldEngine.loadPack({
      pack_id: packId,
      hydrate: hydrateRequest
    });
  }

  notifications.push('info', `包 "${packId}" 已从快照 "${snapshotId}" 恢复完成`, 'SNAPSHOT_RESTORE_OK');

  return {
    pack_id: packId,
    snapshot_id: snapshotId,
    restored_at_tick: metadata.captured_at_tick
  };
};
