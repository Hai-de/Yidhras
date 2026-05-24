import type { PrismaClient } from '@prisma/client';

import type {
  EngineOwnedStateSnapshot,
  PrismaStateSnapshot,
  StateDigestResult
} from '../../src/determinism/state_digest.js';
import { computeStateDigest } from '../../src/determinism/state_digest.js';
import type { PackStorageAdapter } from '../../src/packs/storage/PackStorageAdapter.js';

export const queryPrismaStateForDigest = async (
  prisma: PrismaClient,
  packId: string
): Promise<PrismaStateSnapshot> => {
  const idPrefix = `${packId}:`;

  const [
    agents,
    identities,
    identityNodeBindings,
    posts,
    relationships,
    memoryBlocks,
    overlayEntries,
    compactionStates,
    scenarioStates
  ] = await Promise.all([
    prisma.agent.findMany({ where: { OR: [{ pack_id: packId }, { id: { startsWith: idPrefix } }] } }),
    prisma.identity.findMany({ where: { OR: [{ pack_id: packId }, { id: { startsWith: idPrefix } }] } }),
    prisma.identityNodeBinding.findMany({ where: { OR: [{ pack_id: packId }, { id: { startsWith: idPrefix } }] } }),
    prisma.post.findMany({ where: { OR: [{ pack_id: packId }, { author_id: { startsWith: idPrefix } }] } }),
    prisma.relationship.findMany({ where: { OR: [{ pack_id: packId }, { from_id: { startsWith: idPrefix } }] } }),
    prisma.memoryBlock.findMany({ where: { pack_id: packId } }),
    prisma.contextOverlayEntry.findMany({ where: { pack_id: packId } }),
    prisma.memoryCompactionState.findMany({ where: { pack_id: packId } }),
    prisma.scenarioEntityState.findMany({ where: { pack_id: packId } })
  ]);

  return {
    agents: agents.map((a) => ({ ...a, created_at: String(a.created_at), updated_at: String(a.updated_at) })),
    identities: identities.map((i) => ({ ...i, created_at: String(i.created_at), updated_at: String(i.updated_at) })),
    identity_node_bindings: identityNodeBindings.map((b) => ({ ...b, created_at: String(b.created_at), updated_at: String(b.updated_at) })),
    posts: posts.map((p) => ({ ...p, created_at: String(p.created_at) })),
    relationships: relationships.map((r) => ({ ...r, created_at: String(r.created_at), updated_at: String(r.updated_at) })),
    memory_blocks: memoryBlocks.map((m) => ({
      ...m,
      created_at_tick: String(m.created_at_tick),
      updated_at_tick: String(m.updated_at_tick)
    })),
    context_overlay_entries: overlayEntries.map((e) => ({
      ...e,
      created_at_tick: String(e.created_at_tick),
      updated_at_tick: String(e.updated_at_tick)
    })),
    memory_compaction_states: compactionStates.map((s) => ({
      ...s,
      updated_at_tick: String(s.updated_at_tick)
    })),
    scenario_entity_states: scenarioStates.map((s) => ({
      ...s,
      created_at: String(s.created_at),
      updated_at: String(s.updated_at)
    }))
  };
};

const ENGINE_TABLES = [
  'world_entities',
  'entity_states',
  'authority_grants',
  'mediator_bindings',
  'rule_execution_records'
] as const;

export const queryEngineOwnedStateForDigest = async (
  packStorageAdapter: PackStorageAdapter,
  packId: string
): Promise<EngineOwnedStateSnapshot> => {
  const [worldEntities, entityStates, authorityGrants, mediatorBindings, ruleExecutions] = await Promise.all(
    ENGINE_TABLES.map((table) => packStorageAdapter.listEngineOwnedRecords(packId, table))
  );

  return {
    world_entities: worldEntities as Array<{ entity_id: string; [key: string]: unknown }>,
    entity_states: entityStates as Array<{ entity_id: string; [key: string]: unknown }>,
    authority_grants: authorityGrants as Array<{ grant_id: string; [key: string]: unknown }>,
    mediator_bindings: mediatorBindings as Array<{ binding_id: string; [key: string]: unknown }>,
    rule_execution_records: ruleExecutions as Array<{ execution_id: string; [key: string]: unknown }>
  };
};

export const computePackStateDigest = async (
  packId: string,
  tick: string,
  revision: string,
  prisma: PrismaClient,
  packStorageAdapter?: PackStorageAdapter
): Promise<StateDigestResult> => {
  const prismaData = await queryPrismaStateForDigest(prisma, packId);
  const engineData = packStorageAdapter
    ? await queryEngineOwnedStateForDigest(packStorageAdapter, packId)
    : undefined;

  return computeStateDigest(packId, tick, revision, prismaData, engineData);
};

export const compareDigests = (
  a: StateDigestResult,
  b: StateDigestResult
): { match: boolean; diffDetail: string | null } => {
  if (a.sha256 === b.sha256) {
    return { match: true, diffDetail: null };
  }

  if (a.packId !== b.packId) {
    return { match: false, diffDetail: `packId differs: ${a.packId} vs ${b.packId}` };
  }
  if (a.tick !== b.tick) {
    return { match: false, diffDetail: `tick differs: ${a.tick} vs ${b.tick}` };
  }
  if (a.revision !== b.revision) {
    return { match: false, diffDetail: `revision differs: ${a.revision} vs ${b.revision}` };
  }

  return { match: false, diffDetail: 'canonical JSON differs (digest mismatch)' };
};
