import type { PrismaClient } from '@prisma/client';
import type { PackSnapshotMetadata, PackSnapshotPrismaData } from '@yidhras/contracts';
import crypto from 'crypto';
import fs from 'fs';

import type { ActivePackRuntimeFacade } from '../../app/services/app_context_ports.js';
import { resolvePackRuntimeDatabaseLocation } from '../storage/pack_db_locator.js';
import {
  deleteSnapshotDir,
  listSnapshotDirs,
  resolveSnapshotLocation,
  writeSnapshotMetadata
} from './snapshot_locator.js';

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
  activePackRuntime?: ActivePackRuntimeFacade;
  getExperimentalTick: (packId: string) => string | null;
  getExperimentalRevision: (packId: string) => string | null;
}

export interface CaptureSnapshotResult {
  metadata: PackSnapshotMetadata;
  location: ReturnType<typeof resolveSnapshotLocation>;
}

export const capturePackSnapshot = async (input: CaptureSnapshotInput): Promise<CaptureSnapshotResult> => {
  const { packId, label, prisma, activePackRuntime, getExperimentalTick, getExperimentalRevision } = input;
  const snapshotId = crypto.randomUUID();
  const location = resolveSnapshotLocation(packId, snapshotId);

  enforceMaxSnapshots(packId);

  const memoryState = captureInMemoryState(activePackRuntime, packId, getExperimentalTick, getExperimentalRevision);
  const prismaData = await capturePrismaData(prisma, packId);

  fs.mkdirSync(location.snapshotDir, { recursive: true });

  const runtimeDbLocation = resolvePackRuntimeDatabaseLocation(packId);

  if (fs.existsSync(runtimeDbLocation.runtimeDbPath)) {
    fs.copyFileSync(runtimeDbLocation.runtimeDbPath, location.runtimeDbPath);
  }

  const storagePlanPath = `${runtimeDbLocation.runtimeDbPath}.storage-plan.json`;
  if (fs.existsSync(storagePlanPath)) {
    fs.copyFileSync(storagePlanPath, location.storagePlanPath);
  } else {
    fs.writeFileSync(location.storagePlanPath, JSON.stringify({}), 'utf-8');
  }

  fs.writeFileSync(location.prismaJsonPath, JSON.stringify(prismaData, null, 2), 'utf-8');

  const runtimeDbSizeBytes = fs.existsSync(location.runtimeDbPath)
    ? fs.statSync(location.runtimeDbPath).size
    : 0;

  const metadata: PackSnapshotMetadata = {
    schema_version: 1,
    snapshot_id: snapshotId,
    pack_id: packId,
    label: label?.trim() || null,
    captured_at_tick: memoryState.current_tick,
    captured_at_revision: memoryState.current_revision,
    captured_at_timestamp: new Date().toISOString(),
    runtime_db_size_bytes: runtimeDbSizeBytes,
    prisma_record_count: computePrismaRecordCount(prismaData)
  };

  writeSnapshotMetadata(location, metadata);

  return { metadata, location };
};
