import crypto from 'node:crypto';

import { type StableJsonOptions,stableJsonStringify } from './stable_json.js';

export interface StateDigestResult {
  packId: string;
  tick: string;
  revision: string;
  canonicalJson: string;
  sha256: string;
}

const DIGEST_IGNORED_KEYS: readonly string[] = [
  'updated_at_ms',
  'captured_at_timestamp',
  'snapshot_id',
  'runtime_db_size_bytes',
  'compression',
  'storage_plan_sha256',
  'storage_plan_inherits_from',
  'last_started_at',
  'last_finished_at',
  'last_duration_ms',
  'generation'
];

const stableJsonOptions: StableJsonOptions = { ignoredKeys: DIGEST_IGNORED_KEYS };

const sortBy = <T>(items: T[], keyFn: (item: T) => string): T[] => {
  return [...items].sort((a, b) => {
    const ka = keyFn(a);
    const kb = keyFn(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
};

export interface PrismaStateSnapshot {
  agents: Array<{ id: string; [key: string]: unknown }>;
  identities: Array<{ id: string; [key: string]: unknown }>;
  identity_node_bindings: Array<{ id: string; [key: string]: unknown }>;
  posts: Array<{ id: string; [key: string]: unknown }>;
  relationships: Array<{ id: string; [key: string]: unknown }>;
  memory_blocks: Array<{ id: string; [key: string]: unknown }>;
  context_overlay_entries: Array<{ id: string; [key: string]: unknown }>;
  memory_compaction_states: Array<{ agent_id: string; [key: string]: unknown }>;
  scenario_entity_states: Array<{ id: string; [key: string]: unknown }>;
}

export interface EngineOwnedStateSnapshot {
  world_entities: Array<{ entity_id: string; [key: string]: unknown }>;
  entity_states: Array<{ entity_id: string; [key: string]: unknown }>;
  authority_grants: Array<{ grant_id: string; [key: string]: unknown }>;
  mediator_bindings: Array<{ binding_id: string; [key: string]: unknown }>;
  rule_execution_records: Array<{ execution_id: string; [key: string]: unknown }>;
}

export interface DeterministicStateSnapshot {
  pack_id: string;
  tick: string;
  revision: string;
  prisma: Record<string, unknown[]>;
  engine_owned: Record<string, unknown[]>;
}

const buildSnapshot = (
  packId: string,
  tick: string,
  revision: string,
  prismaData: PrismaStateSnapshot,
  engineOwnedData?: EngineOwnedStateSnapshot
): DeterministicStateSnapshot => {
  const prisma: Record<string, unknown[]> = {
    agents: sortBy(prismaData.agents, (r) => r.id),
    identities: sortBy(prismaData.identities, (r) => r.id),
    identity_node_bindings: sortBy(prismaData.identity_node_bindings, (r) => r.id),
    posts: sortBy(prismaData.posts, (r) => r.id),
    relationships: sortBy(prismaData.relationships, (r) => r.id),
    memory_blocks: sortBy(prismaData.memory_blocks, (r) => r.id),
    context_overlay_entries: sortBy(prismaData.context_overlay_entries, (r) => r.id),
    memory_compaction_states: sortBy(prismaData.memory_compaction_states, (r) => r.agent_id),
    scenario_entity_states: sortBy(prismaData.scenario_entity_states, (r) => r.id)
  };

  const engineOwned: Record<string, unknown[]> = {};
  if (engineOwnedData) {
    engineOwned.world_entities = sortBy(engineOwnedData.world_entities, (r) => r.entity_id);
    engineOwned.entity_states = sortBy(engineOwnedData.entity_states, (r) => r.entity_id);
    engineOwned.authority_grants = sortBy(engineOwnedData.authority_grants, (r) => r.grant_id);
    engineOwned.mediator_bindings = sortBy(engineOwnedData.mediator_bindings, (r) => r.binding_id);
    engineOwned.rule_execution_records = sortBy(engineOwnedData.rule_execution_records, (r) => r.execution_id);
  }

  return {
    pack_id: packId,
    tick,
    revision,
    prisma,
    engine_owned: engineOwned
  };
};

export const computeStateDigest = (
  packId: string,
  tick: string,
  revision: string,
  prismaData: PrismaStateSnapshot,
  engineOwnedData?: EngineOwnedStateSnapshot
): StateDigestResult => {
  const snapshot = buildSnapshot(packId, tick, revision, prismaData, engineOwnedData);
  const canonicalJson = stableJsonStringify(snapshot, stableJsonOptions);
  const sha256 = crypto.createHash('sha256').update(canonicalJson).digest('hex');

  return {
    packId,
    tick,
    revision,
    canonicalJson,
    sha256
  };
};
