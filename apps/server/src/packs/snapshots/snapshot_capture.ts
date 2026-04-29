import type { PrismaClient } from '@prisma/client';
import type { PackSnapshotMetadata, PackSnapshotPrismaData } from '@yidhras/contracts';
import crypto from 'crypto';
import fs from 'fs';
import { gzipSync } from 'zlib';

import type { ActivePackRuntimeFacade } from '../../app/services/app_context_ports.js';
import { safeFs } from '../../utils/safe_fs.js';
import { getPackRootDir, resolvePackRuntimeDatabaseLocation } from '../storage/pack_db_locator.js';
import type { PackStorageAdapter } from '../storage/PackStorageAdapter.js';
import {
  computeSha256,
  deleteSnapshotDir,
  listSnapshotDirs,
  readSnapshotMetadata,
  resolveSnapshotLocation,
  writeSnapshotMetadata
} from './snapshot_locator.js';

/**
 * 设计决策：快照系统为何直接复制 runtime.sqlite 而非使用 adapter.exportPackData()
 *
 * 当前快照系统绕过 PackStorageAdapter 抽象层，直接通过 copyFileSync 复制原始 SQLite
 * 数据库文件。这是有意为之，原因如下：
 *
 * 1. SQLite 的文件级快照保留了完整的数据库状态，包括 WAL、索引结构、页面缓存等，
 *    这是 adapter.exportPackData() 逐行导出 JSON 无法替代的。行数据导出丢失了数据库
 *    物理结构，恢复时需要通过 upsert 逐行重新写入，既不高效也不忠实于原始状态。
 *
 * 2. 对于 PostgreSQL 等分布式数据库，部署者应使用数据库原生工具进行备份：
 *    - pg_dump / pg_basebackup / WAL archiving
 *    - 这些工具远比应用层自建的"通用快照"成熟可靠
 *    - 数据库备份属于基础设施层职责，不应由应用层强行抽象
 *
 * 3. 如果在应用层通过 adapter.exportPackData() 强行统一快照接口，结果将是一个既不匹配
 *    SQLite 优势（文件级快照的简单性和完整性）、也不匹配 PostgreSQL 优势（原生工具链）
 *    的半吊子方案。
 *
 * 因此，快照功能仅支持 SQLite 后端。API 路由层会检查 packStorageAdapter.backend，
 * 对非 SQLite 后端返回 501 Not Implemented，并引导部署者使用数据库原生工具。
 */

const MAX_SNAPSHOTS_PER_PACK = 20;

const toBigIntString = (value: bigint): string => value.toString();

interface CaptureInMemoryStateResult {
  current_tick: string;
  current_revision: string;
  runtime_speed: {
    mode: string;
    source: string;
    configured_step_ticks: string | null;
    override_step_ticks: string | null;
    override_since: number | null;
    effective_step_ticks: string;
  } | null;
}

const captureInMemoryState = (
  activePackRuntime: ActivePackRuntimeFacade | undefined,
  packId: string,
  getExperimentalTick: (packId: string) => string | null,
  getExperimentalRevision: (packId: string) => string | null
): CaptureInMemoryStateResult => {
  if (activePackRuntime) {
    const activePackId = activePackRuntime.getActivePack()?.metadata.id ?? null;
    if (activePackId === packId) {
      return {
        current_tick: activePackRuntime.getCurrentTick().toString(),
        current_revision: activePackRuntime.getCurrentRevision().toString(),
        runtime_speed: activePackRuntime.getRuntimeSpeedSnapshot()
      };
    }
  }

  const experimentalTick = getExperimentalTick(packId);
  const experimentalRevision = getExperimentalRevision(packId);

  return {
    current_tick: experimentalTick ?? '0',
    current_revision: experimentalRevision ?? '0',
    runtime_speed: null
  };
};

const capturePrismaData = async (
  prisma: PrismaClient,
  packId: string
): Promise<PackSnapshotPrismaData> => {
  const agents = await prisma.agent.findMany({
    where: { id: { startsWith: `${packId}:` } }
  });

  const agentIds = agents.map((a) => a.id);

  const identities = await prisma.identity.findMany({
    where: { id: { startsWith: `${packId}:identity:` } }
  });

  const identityNodeBindings = await prisma.identityNodeBinding.findMany({
    where: { id: { startsWith: `${packId}:binding:` } }
  });

  const [posts, relationships, memoryBlocks, contextOverlayEntries, memoryCompactionStates, scenarioEntityStates] =
    await Promise.all([
      prisma.post.findMany({
        where: agentIds.length > 0 ? { author_id: { in: agentIds } } : { id: { startsWith: `${packId}:` } }
      }),
      prisma.relationship.findMany({
        where:
          agentIds.length > 0
            ? { OR: [{ from_id: { in: agentIds } }, { to_id: { in: agentIds } }] }
            : { id: { startsWith: `${packId}:` } }
      }),
      prisma.memoryBlock.findMany({
        where: { pack_id: packId },
        include: { behavior: true, runtime_state: true }
      }),
      prisma.contextOverlayEntry.findMany({
        where: { pack_id: packId }
      }),
      prisma.memoryCompactionState.findMany({
        where: { pack_id: packId }
      }),
      prisma.scenarioEntityState.findMany({
        where: { pack_id: packId }
      })
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
      created_at: toBigIntString(a.created_at),
      updated_at: toBigIntString(a.updated_at)
    })),
    identities: identities.map((i) => ({
      id: i.id,
      type: i.type,
      name: i.name,
      provider: i.provider,
      status: i.status,
      claims: (i.claims as unknown) ?? null,
      metadata: (i.metadata as unknown) ?? null,
      created_at: toBigIntString(i.created_at),
      updated_at: toBigIntString(i.updated_at)
    })),
    identity_node_bindings: identityNodeBindings.map((b) => ({
      id: b.id,
      identity_id: b.identity_id,
      agent_id: b.agent_id,
      atmosphere_node_id: b.atmosphere_node_id,
      role: b.role,
      status: b.status,
      created_at: toBigIntString(b.created_at),
      updated_at: toBigIntString(b.updated_at)
    })),
    posts: posts.map((p) => ({
      id: p.id,
      author_id: p.author_id,
      source_action_intent_id: p.source_action_intent_id,
      content: p.content,
      noise_level: p.noise_level,
      is_encrypted: p.is_encrypted,
      created_at: toBigIntString(p.created_at)
    })),
    relationships: relationships.map((r) => ({
      id: r.id,
      from_id: r.from_id,
      to_id: r.to_id,
      type: r.type,
      weight: r.weight,
      created_at: toBigIntString(r.created_at),
      updated_at: toBigIntString(r.updated_at)
    })),
    memory_blocks: memoryBlocks.map((m) => ({
      id: m.id,
      owner_agent_id: m.owner_agent_id,
      kind: m.kind,
      status: m.status,
      title: m.title,
      content_text: m.content_text,
      content_structured: (m.content_structured as unknown) ?? null,
      tags: m.tags,
      keywords: m.keywords,
      source_ref: (m.source_ref as unknown) ?? null,
      importance: m.importance,
      salience: m.salience,
      confidence: m.confidence,
      created_at_tick: toBigIntString(m.created_at_tick),
      updated_at_tick: toBigIntString(m.updated_at_tick),
      behavior: (m.behavior as unknown) ?? null,
      runtime_state: (m.runtime_state as unknown) ?? null
    })),
    context_overlay_entries: contextOverlayEntries.map((e) => ({
      id: e.id,
      actor_id: e.actor_id,
      overlay_type: e.overlay_type,
      title: e.title,
      content_text: e.content_text,
      content_structured: (e.content_structured as unknown) ?? null,
      tags: e.tags,
      status: e.status,
      persistence_mode: e.persistence_mode,
      source_node_ids: e.source_node_ids,
      created_by: e.created_by,
      created_at_tick: toBigIntString(e.created_at_tick),
      updated_at_tick: toBigIntString(e.updated_at_tick)
    })),
    memory_compaction_states: memoryCompactionStates.map((m) => ({
      agent_id: m.agent_id,
      inference_count_since_summary: m.inference_count_since_summary,
      inference_count_since_compaction: m.inference_count_since_compaction,
      last_summary_tick: m.last_summary_tick !== null ? toBigIntString(m.last_summary_tick) : null,
      last_compaction_tick: m.last_compaction_tick !== null ? toBigIntString(m.last_compaction_tick) : null,
      updated_at_tick: toBigIntString(m.updated_at_tick)
    })),
    scenario_entity_states: scenarioEntityStates.map((s) => ({
      id: s.id,
      entity_type: s.entity_type,
      entity_id: s.entity_id,
      state_json: (s.state_json as unknown) ?? {},
      created_at: toBigIntString(s.created_at),
      updated_at: toBigIntString(s.updated_at)
    }))
  };
};

const computePrismaRecordCount = (data: PackSnapshotPrismaData): number => {
  return (
    data.agents.length +
    data.identities.length +
    data.identity_node_bindings.length +
    data.posts.length +
    data.relationships.length +
    data.memory_blocks.length +
    data.context_overlay_entries.length +
    data.memory_compaction_states.length +
    data.scenario_entity_states.length
  );
};

const enforceMaxSnapshots = (packId: string): void => {
  const dirs = listSnapshotDirs(packId);

  while (dirs.length >= MAX_SNAPSHOTS_PER_PACK) {
    const oldest = dirs.shift();
    if (oldest) {
      const location = resolveSnapshotLocation(packId, oldest);
      deleteSnapshotDir(location);
    }
  }
};

export interface CaptureSnapshotInput {
  packId: string;
  label?: string;
  prisma: PrismaClient;
  packStorageAdapter: PackStorageAdapter;
  activePackRuntime?: ActivePackRuntimeFacade;
  getExperimentalTick: (packId: string) => string | null;
  getExperimentalRevision: (packId: string) => string | null;
}

export interface CaptureSnapshotResult {
  metadata: PackSnapshotMetadata;
  location: ReturnType<typeof resolveSnapshotLocation>;
}

const getLatestSnapshotMetadata = (
  packId: string
): PackSnapshotMetadata | null => {
  const dirs = listSnapshotDirs(packId);
  if (dirs.length === 0) return null;

  let latest: PackSnapshotMetadata | null = null;
  for (const dir of dirs) {
    const loc = resolveSnapshotLocation(packId, dir);
    try {
      const meta = readSnapshotMetadata(loc);
      if (!latest || meta.captured_at_timestamp > latest.captured_at_timestamp) {
        latest = meta;
      }
    } catch {
      // corrupted/incomplete snapshot — skip
    }
  }
  return latest;
};

export const capturePackSnapshot = async (input: CaptureSnapshotInput): Promise<CaptureSnapshotResult> => {
  const { packId, label, prisma, packStorageAdapter, activePackRuntime, getExperimentalTick, getExperimentalRevision } = input;

  if (packStorageAdapter.backend !== 'sqlite') {
    throw new Error(
      `[snapshot_capture] 快照功能仅支持 SQLite 后端，当前后端为 ${packStorageAdapter.backend}。请使用数据库原生工具进行备份。`
    );
  }

  const snapshotId = crypto.randomUUID();
  const location = resolveSnapshotLocation(packId, snapshotId);

  enforceMaxSnapshots(packId);

  const memoryState = captureInMemoryState(activePackRuntime, packId, getExperimentalTick, getExperimentalRevision);
  const prismaData = await capturePrismaData(prisma, packId);
  const packRoot = getPackRootDir(packId);

  safeFs.mkdirSync(packRoot, location.snapshotDir, { recursive: true });

  const runtimeDbLocation = resolvePackRuntimeDatabaseLocation(packId);

  // 2.1: gzip runtime.sqlite
  let runtimeDbSizeBytes = 0;
  if (safeFs.existsSync(packRoot, runtimeDbLocation.runtimeDbPath)) {
    const dbContent = fs.readFileSync(runtimeDbLocation.runtimeDbPath);
    const compressed = gzipSync(dbContent);
    safeFs.writeFileSync(packRoot, location.runtimeDbPath, compressed);
    runtimeDbSizeBytes = compressed.length;
  }

  // 2.3: storage-plan dedup via SHA256
  const storagePlanPath = `${runtimeDbLocation.runtimeDbPath}.storage-plan.json`;
  let storagePlanSha256: string | null = null;
  let storagePlanInheritsFrom: string | null = null;

  if (safeFs.existsSync(packRoot, storagePlanPath)) {
    const currentSha = computeSha256(storagePlanPath);
    storagePlanSha256 = currentSha;

    const prevMetadata = getLatestSnapshotMetadata(packId);
    if (prevMetadata?.storage_plan_sha256 === currentSha) {
      storagePlanInheritsFrom = prevMetadata.snapshot_id;
    } else {
      safeFs.copyFileSync(packRoot, storagePlanPath, location.storagePlanPath);
    }
  } else {
    safeFs.writeFileSync(packRoot, location.storagePlanPath, JSON.stringify({}));
  }

  // 2.2: gzip prisma.json
  const prismaJson = JSON.stringify(prismaData);
  const compressedPrisma = gzipSync(Buffer.from(prismaJson, 'utf-8'));
  safeFs.writeFileSync(packRoot, location.prismaJsonPath, compressedPrisma);

  const metadata: PackSnapshotMetadata = {
    schema_version: 1,
    snapshot_id: snapshotId,
    pack_id: packId,
    label: label?.trim() || null,
    captured_at_tick: memoryState.current_tick,
    captured_at_revision: memoryState.current_revision,
    captured_at_timestamp: new Date().toISOString(),
    runtime_db_size_bytes: runtimeDbSizeBytes,
    prisma_record_count: computePrismaRecordCount(prismaData),
    compression: 'gzip',
    storage_plan_sha256: storagePlanSha256,
    storage_plan_inherits_from: storagePlanInheritsFrom
  };

  writeSnapshotMetadata(location, metadata);

  return { metadata, location };
};
