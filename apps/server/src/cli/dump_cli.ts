/**
 * sim dump CLI — direct DB/runtime-file reader, outputs JSON to stdout or file.
 *
 * Usage:
 *   pnpm --filter yidhras-server sim:dump <packId> --type agent|relation|memory|runtime|snapshot|plugin|prisma|world|all
 */

import fs from 'node:fs';

import { createPrismaClient } from '../db/client.js';
import {
  listSnapshotDirs,
  readSnapshotMetadata,
  resolveSnapshotLocation
} from '../packs/snapshots/snapshot_locator.js';
import { listPackAuthorityGrants } from '../packs/storage/authority_repo.js';
import { listPackWorldEntities } from '../packs/storage/entity_repo.js';
import { listPackEntityStates } from '../packs/storage/entity_state_repo.js';
import { SqlitePackStorageAdapter } from '../packs/storage/internal/SqlitePackStorageAdapter.js';
import { listPackMediatorBindings } from '../packs/storage/mediator_repo.js';
import { resolvePackRuntimeDatabaseLocation } from '../packs/storage/pack_db_locator.js';
import { listPackRuleExecutionRecords } from '../packs/storage/rule_execution_repo.js';

const VALID_TYPES = ['agent', 'relation', 'memory', 'runtime', 'snapshot', 'plugin', 'prisma', 'world', 'all'] as const;

type DumpType = (typeof VALID_TYPES)[number];

const isDumpType = (value: string): value is DumpType => VALID_TYPES.some(candidate => candidate === value);

interface ParsedArgs {
  packId?: string;
  type?: string;
  out?: string;
  limit?: number;
  help?: boolean;
}

const parseArgs = (argv: string[]): ParsedArgs => {
  const parsed: ParsedArgs = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case '--help':
      case '-h':
        parsed.help = true;
        break;
      case '--type':
        parsed.type = argv[++i]!;
        break;
      case '--out':
        parsed.out = argv[++i]!;
        break;
      case '--limit':
        parsed.limit = Number.parseInt(argv[++i]!, 10);
        break;
      default:
        if (!arg.startsWith('-') && !parsed.packId) {
          parsed.packId = arg!;
        }
    }
  }

  return parsed;
};

const printHelp = (): void => {
  console.log(`sim dump — Export pack runtime state as JSON

Usage:
  pnpm --filter yidhras-server sim:dump <packId> [--type <type>] [--out <file>] [--limit <n>]

Types:
  agent     — actor world entities + entity states
  relation  — authority grants + mediator bindings
  memory    — rule execution records
  world     — agent + relation + memory
  runtime   — persisted runtime DB summary
  snapshot  — snapshot metadata summaries
  plugin    — plugin installation summaries
  prisma    — pack-scoped Prisma record counts
  all       — every category above (default)

Options:
  --out      Write JSON to file instead of stdout
  --limit    Limit snapshot rows (default: 20)
  --help, -h Show this help
`);
};

const dumpAgents = async (adapter: SqlitePackStorageAdapter, packId: string) => {
  const [entities, states] = await Promise.all([
    listPackWorldEntities(adapter, packId),
    listPackEntityStates(adapter, packId)
  ]);

  const actorEntities = entities.filter(e => {
    const kind = typeof e.entity_kind === 'string' ? e.entity_kind : '';
    return kind === 'actor' || kind.startsWith('actor:');
  });

  const actorIds = new Set(actorEntities.map(e => e.id));
  const actorStates = states.filter(s => actorIds.has(s.entity_id));

  return { actor_entities: actorEntities, actor_states: actorStates };
};

const dumpRelations = async (adapter: SqlitePackStorageAdapter, packId: string) => {
  const [authorityGrants, mediatorBindings] = await Promise.all([
    listPackAuthorityGrants(adapter, packId),
    listPackMediatorBindings(adapter, packId)
  ]);

  return { authority_grants: authorityGrants, mediator_bindings: mediatorBindings };
};

const dumpMemory = async (adapter: SqlitePackStorageAdapter, packId: string) => {
  const ruleExecutionRecords = await listPackRuleExecutionRecords(adapter, packId);
  return { rule_execution_records: ruleExecutionRecords };
};

const dumpRuntime = async (adapter: SqlitePackStorageAdapter, packId: string) => {
  const location = resolvePackRuntimeDatabaseLocation(packId);
  const storagePlanPath = `${location.runtimeDbPath}.storage-plan.json`;
  const [entities, states, ruleExecutionRecords] = await Promise.all([
    listPackWorldEntities(adapter, packId),
    listPackEntityStates(adapter, packId),
    listPackRuleExecutionRecords(adapter, packId)
  ]);
  const worldMetaState = states.find(s => s.entity_id === `${packId}:entity:__world__` && s.state_namespace === 'meta') ?? null;

  return {
    runtime: {
      runtime_db_path: location.runtimeDbPath,
      runtime_db_exists: fs.existsSync(location.runtimeDbPath),
      runtime_db_size_bytes: fs.existsSync(location.runtimeDbPath) ? fs.statSync(location.runtimeDbPath).size : 0,
      storage_plan_path: storagePlanPath,
      storage_plan_exists: fs.existsSync(storagePlanPath),
      world_entity_count: entities.length,
      entity_state_count: states.length,
      rule_execution_record_count: ruleExecutionRecords.length,
      world_meta_state: worldMetaState
    }
  };
};

const dumpSnapshots = (packId: string, limit: number) => {
  const snapshots = listSnapshotDirs(packId)
    .slice(-limit)
    .map(snapshotId => readSnapshotMetadata(resolveSnapshotLocation(packId, snapshotId)));
  return { snapshots };
};

const dumpPlugins = async (packId: string) => {
  const prisma = createPrismaClient();
  try {
    const installations = await prisma.pluginInstallation.findMany({
      where: {
        OR: [
          { scope_type: 'global' },
          { scope_type: 'pack_local', scope_ref: packId }
        ]
      },
      orderBy: [{ plugin_id: 'asc' }, { installation_id: 'asc' }]
    });
    return {
      plugins: installations.map(row => ({
        installation_id: row.installation_id,
        plugin_id: row.plugin_id,
        version: row.version,
        lifecycle_state: row.lifecycle_state,
        scope_type: row.scope_type,
        scope_ref: row.scope_ref,
        last_error: row.last_error
      }))
    };
  } finally {
    await prisma.$disconnect();
  }
};

const dumpPrismaCounts = async (packId: string) => {
  const prisma = createPrismaClient();
  const idPrefix = `${packId}:`;
  try {
    const [agents, identities, identityNodeBindings, posts, relationships, memoryBlocks, overlayEntries, compactionStates, scenarioStates] = await Promise.all([
      prisma.agent.count({ where: { OR: [{ pack_id: packId }, { id: { startsWith: idPrefix } }] } }),
      prisma.identity.count({ where: { OR: [{ pack_id: packId }, { id: { startsWith: idPrefix } }] } }),
      prisma.identityNodeBinding.count({ where: { OR: [{ pack_id: packId }, { id: { startsWith: idPrefix } }] } }),
      prisma.post.count({ where: { OR: [{ pack_id: packId }, { author_id: { startsWith: idPrefix } }] } }),
      prisma.relationship.count({ where: { OR: [{ pack_id: packId }, { from_id: { startsWith: idPrefix } }] } }),
      prisma.memoryBlock.count({ where: { pack_id: packId } }),
      prisma.contextOverlayEntry.count({ where: { pack_id: packId } }),
      prisma.memoryCompactionState.count({ where: { pack_id: packId } }),
      prisma.scenarioEntityState.count({ where: { pack_id: packId } })
    ]);

    return {
      prisma_counts: {
        agents,
        identities,
        identity_node_bindings: identityNodeBindings,
        posts,
        relationships,
        memory_blocks: memoryBlocks,
        context_overlay_entries: overlayEntries,
        memory_compaction_states: compactionStates,
        scenario_entity_states: scenarioStates
      }
    };
  } finally {
    await prisma.$disconnect();
  }
};

const writeResult = (result: Record<string, unknown>, out?: string): void => {
  const json = JSON.stringify(result, null, 2);
  if (out) {
    fs.writeFileSync(out, `${json}\n`, 'utf-8');
    return;
  }
  console.log(json);
};

const runDump = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || !args.packId) {
    printHelp();
    process.exitCode = args.help ? 0 : 1;
    return;
  }

  const type = args.type ?? 'all';
  if (!isDumpType(type)) {
    console.error(`Invalid type: ${type}. Must be one of: ${VALID_TYPES.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const adapter = new SqlitePackStorageAdapter();
  const result: Record<string, unknown> = { pack_id: args.packId, type };
  const dumpType = type;
  const includeWorld = dumpType === 'world' || dumpType === 'all';
  const limit = Number.isInteger(args.limit) && args.limit && args.limit > 0 ? args.limit : 20;

  if (dumpType === 'agent' || includeWorld) Object.assign(result, await dumpAgents(adapter, args.packId));
  if (dumpType === 'relation' || includeWorld) Object.assign(result, await dumpRelations(adapter, args.packId));
  if (dumpType === 'memory' || includeWorld) Object.assign(result, await dumpMemory(adapter, args.packId));
  if (dumpType === 'runtime' || dumpType === 'all') Object.assign(result, await dumpRuntime(adapter, args.packId));
  if (dumpType === 'snapshot' || dumpType === 'all') Object.assign(result, dumpSnapshots(args.packId, limit));
  if (dumpType === 'plugin' || dumpType === 'all') Object.assign(result, await dumpPlugins(args.packId));
  if (dumpType === 'prisma' || dumpType === 'all') Object.assign(result, await dumpPrismaCounts(args.packId));

  writeResult(result, args.out);
};

runDump().catch((err: unknown) => {
  console.error('Dump failed:', err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
