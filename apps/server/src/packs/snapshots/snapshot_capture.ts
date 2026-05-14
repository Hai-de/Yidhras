/**
 * 设计决策：快照捕获为何直接复制 runtime.sqlite 而非使用 adapter.exportPackData()
 *
 * SQLite 文件级快照保留完整数据库物理状态（WAL、索引状态、pragma 设定等），
 * 行级导出无法替代。这确保 restore 后 runtime DB 与 capture 时完全一致。
 * PostgreSQL 部署者应使用 pg_dump / pg_basebackup 等原生工具进行备份。
 */
import type { PrismaClient } from '@prisma/client';
import type { PackSnapshotMetadata, PackSnapshotPrismaData } from '@yidhras/contracts';
import crypto from 'crypto';
import fs from 'fs';
import { gzipSync } from 'zlib';

import { safeFs } from '../../utils/safe_fs.js';
import { getPackRootDir, resolvePackRuntimeDatabaseLocation } from '../storage/pack_db_locator.js';
import type { PackStorageAdapter } from '../storage/PackStorageAdapter.js';
import {
  getPackSnapshotsDir,
  resolveSnapshotLocation,
  type SnapshotLocation,
  writeSnapshotMetadata
} from './snapshot_locator.js';

export interface CapturePackSnapshotInput {
  packId: string;
  label?: string;
  prisma: PrismaClient;
  packStorageAdapter: PackStorageAdapter;
  packRuntime?: {
    getCurrentTick(): bigint;
    getCurrentRevision(): bigint;
  };
  getExperimentalTick: (packId: string) => string | null;
  getExperimentalRevision: (packId: string) => string | null;
}

export interface CapturePackSnapshotResult {
  metadata: PackSnapshotMetadata;
  location: SnapshotLocation;
}

const generateSnapshotId = (): string => {
  const now = new Date();
  const pad = (n: number, len = 2): string => String(n).padStart(len, '0');
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const suffix = crypto.randomBytes(3).toString('hex');
  return `${timestamp}-${suffix}`;
};

const bigintToString = (value: bigint | null): string | null => {
  return value !== null ? value.toString() : null;
};

const queryPackPrismaData = async (prisma: PrismaClient, packId: string): Promise<PackSnapshotPrismaData> => {
  const idPrefix = `${packId}:`;

  const [agents, identities, identityNodeBindings, posts, relationships, memoryBlocks, overlayEntries, compactionStates, scenarioStates] = await Promise.all([
    prisma.agent.findMany({ where: { OR: [{ pack_id: packId }, { id: { startsWith: idPrefix } }] } }),
    prisma.identity.findMany({ where: { OR: [{ pack_id: packId }, { id: { startsWith: idPrefix } }] } }),
    prisma.identityNodeBinding.findMany({ where: { OR: [{ pack_id: packId }, { id: { startsWith: idPrefix } }] } }),
    prisma.post.findMany({ where: { OR: [{ pack_id: packId }, { author_id: { startsWith: idPrefix } }] } }),
    prisma.relationship.findMany({ where: { OR: [{ pack_id: packId }, { from_id: { startsWith: idPrefix } }] } }),
    prisma.memoryBlock.findMany({
      where: { pack_id: packId },
      include: { behavior: true, runtime_state: true }
    }),
    prisma.contextOverlayEntry.findMany({ where: { pack_id: packId } }),
    prisma.memoryCompactionState.findMany({ where: { pack_id: packId } }),
    prisma.scenarioEntityState.findMany({ where: { pack_id: packId } })
  ]);

  return {
    schema_version: 1,
    pack_id: packId,
    agents: agents.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      snr: a.snr,
      is_pinned: a.is_pinned,
      created_at: a.created_at.toString(),
      updated_at: a.updated_at.toString()
    })),
    identities: identities.map((i) => ({
      id: i.id,
      type: i.type,
      name: i.name,
      provider: i.provider,
      status: i.status,
      claims: i.claims ?? null,
      metadata: i.metadata ?? null,
      created_at: i.created_at.toString(),
      updated_at: i.updated_at.toString()
    })),
    identity_node_bindings: identityNodeBindings.map((b) => ({
      id: b.id,
      identity_id: b.identity_id,
      agent_id: b.agent_id,
      atmosphere_node_id: b.atmosphere_node_id,
      role: b.role,
      status: b.status,
      created_at: b.created_at.toString(),
      updated_at: b.updated_at.toString()
    })),
    posts: posts.map((p) => ({
      id: p.id,
      author_id: p.author_id,
      source_action_intent_id: p.source_action_intent_id,
      content: p.content,
      noise_level: p.noise_level,
      is_encrypted: p.is_encrypted,
      created_at: p.created_at.toString()
    })),
    relationships: relationships.map((r) => ({
      id: r.id,
      from_id: r.from_id,
      to_id: r.to_id,
      type: r.type,
      weight: r.weight,
      created_at: r.created_at.toString(),
      updated_at: r.updated_at.toString()
    })),
    memory_blocks: memoryBlocks.map((m) => ({
      id: m.id,
      owner_agent_id: m.owner_agent_id,
      kind: m.kind,
      status: m.status,
      title: m.title,
      content_text: m.content_text,
      content_structured: m.content_structured ?? null,
      tags: m.tags,
      keywords: m.keywords,
      source_ref: m.source_ref ?? null,
      importance: m.importance,
      salience: m.salience,
      confidence: m.confidence,
      created_at_tick: m.created_at_tick.toString(),
      updated_at_tick: m.updated_at_tick.toString(),
      behavior: m.behavior ? {
        behavior_json: m.behavior.behavior_json,
        created_at_tick: m.behavior.created_at_tick.toString(),
        updated_at_tick: m.behavior.updated_at_tick.toString()
      } : null,
      runtime_state: m.runtime_state ? {
        trigger_count: m.runtime_state.trigger_count,
        last_triggered_tick: bigintToString(m.runtime_state.last_triggered_tick),
        last_inserted_tick: bigintToString(m.runtime_state.last_inserted_tick),
        cooldown_until_tick: bigintToString(m.runtime_state.cooldown_until_tick),
        delayed_until_tick: bigintToString(m.runtime_state.delayed_until_tick),
        retain_until_tick: bigintToString(m.runtime_state.retain_until_tick),
        currently_active: m.runtime_state.currently_active,
        last_activation_score: m.runtime_state.last_activation_score,
        recent_distance_from_latest_message: m.runtime_state.recent_distance_from_latest_message
      } : null
    })),
    context_overlay_entries: overlayEntries.map((e) => ({
      id: e.id,
      actor_id: e.actor_id,
      overlay_type: e.overlay_type,
      title: e.title,
      content_text: e.content_text,
      content_structured: e.content_structured ?? null,
      tags: e.tags,
      status: e.status,
      persistence_mode: e.persistence_mode,
      source_node_ids: e.source_node_ids,
      created_by: e.created_by,
      created_at_tick: e.created_at_tick.toString(),
      updated_at_tick: e.updated_at_tick.toString()
    })),
    memory_compaction_states: compactionStates.map((s) => ({
      agent_id: s.agent_id,
      inference_count_since_summary: s.inference_count_since_summary,
      inference_count_since_compaction: s.inference_count_since_compaction,
      last_summary_tick: bigintToString(s.last_summary_tick),
      last_compaction_tick: bigintToString(s.last_compaction_tick),
      updated_at_tick: s.updated_at_tick.toString()
    })),
    scenario_entity_states: scenarioStates.map((s) => ({
      id: s.id,
      entity_type: s.entity_type,
      entity_id: s.entity_id,
      state_json: s.state_json,
      created_at: s.created_at.toString(),
      updated_at: s.updated_at.toString()
    }))
  };
};

export const capturePackSnapshot = async (input: CapturePackSnapshotInput): Promise<CapturePackSnapshotResult> => {
  const { packId, label, prisma, packStorageAdapter, packRuntime, getExperimentalTick, getExperimentalRevision } = input;

  if (packStorageAdapter.backend !== 'sqlite') {
    throw new Error(
      `[snapshot_capture] 快照功能仅支持 SQLite 后端，当前后端为 ${packStorageAdapter.backend}。请使用数据库原生工具进行备份。`
    );
  }

  const capturedAtTick = packRuntime
    ? packRuntime.getCurrentTick().toString()
    : (getExperimentalTick(packId) ?? '0');

  const capturedAtRevision = packRuntime
    ? packRuntime.getCurrentRevision().toString()
    : (getExperimentalRevision(packId) ?? capturedAtTick);

  const snapshotId = generateSnapshotId();
  const snapshotsDir = getPackSnapshotsDir(packId);
  const location = resolveSnapshotLocation(packId, snapshotId);

  safeFs.mkdirSync(snapshotsDir, location.snapshotDir, { recursive: true });

  const runtimeDbLocation = resolvePackRuntimeDatabaseLocation(packId);
  const packRoot = getPackRootDir(packId);
  let runtimeDbSizeBytes = 0;

  if (fs.existsSync(runtimeDbLocation.runtimeDbPath)) {
    const runtimeDbBuffer = fs.readFileSync(runtimeDbLocation.runtimeDbPath);
    runtimeDbSizeBytes = runtimeDbBuffer.length;
    const compressed = gzipSync(runtimeDbBuffer);
    safeFs.writeFileSync(snapshotsDir, location.runtimeDbPath, compressed);
  }

  const storagePlanPath = `${runtimeDbLocation.runtimeDbPath}.storage-plan.json`;
  if (fs.existsSync(storagePlanPath)) {
    safeFs.copyFileSync(packRoot, storagePlanPath, location.storagePlanPath);
  }

  const prismaData = await queryPackPrismaData(prisma, packId);
  const prismaJson = JSON.stringify(prismaData);
  const prismaCompressed = gzipSync(Buffer.from(prismaJson, 'utf-8'));
  safeFs.writeFileSync(snapshotsDir, location.prismaJsonPath, prismaCompressed);

  const prismaRecordCount =
    prismaData.agents.length +
    prismaData.identities.length +
    prismaData.identity_node_bindings.length +
    prismaData.posts.length +
    prismaData.relationships.length +
    prismaData.memory_blocks.length +
    prismaData.context_overlay_entries.length +
    prismaData.memory_compaction_states.length +
    prismaData.scenario_entity_states.length;

  const metadata: PackSnapshotMetadata = {
    schema_version: 1,
    snapshot_id: snapshotId,
    pack_id: packId,
    label: label ?? null,
    captured_at_tick: capturedAtTick,
    captured_at_revision: capturedAtRevision,
    captured_at_timestamp: new Date().toISOString(),
    runtime_db_size_bytes: runtimeDbSizeBytes,
    prisma_record_count: prismaRecordCount,
    compression: 'gzip',
    storage_plan_sha256: null,
    storage_plan_inherits_from: null
  };

  writeSnapshotMetadata(location, metadata);

  return { metadata, location };
};
