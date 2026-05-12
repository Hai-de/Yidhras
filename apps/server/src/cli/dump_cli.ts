/**
 * sim dump CLI — direct DB reader, outputs JSON to stdout.
 *
 * Usage:
 *   pnpm --filter yidhras-server sim:dump <packId> --type agent|relation|memory|all
 */

import { listPackAuthorityGrants } from '../packs/storage/authority_repo.js';
import { listPackWorldEntities } from '../packs/storage/entity_repo.js';
import { listPackEntityStates } from '../packs/storage/entity_state_repo.js';
import { listPackMediatorBindings } from '../packs/storage/mediator_repo.js';
import { listPackRuleExecutionRecords } from '../packs/storage/rule_execution_repo.js';
import { SqlitePackStorageAdapter } from '../packs/storage/internal/SqlitePackStorageAdapter.js';

const VALID_TYPES = ['agent', 'relation', 'memory', 'all'] as const;

const parseArgs = (argv: string[]): { packId?: string; type?: string; help?: boolean } => {
  const parsed: { packId?: string; type?: string; help?: boolean } = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--help':
      case '-h':
        parsed.help = true;
        break;
      case '--type':
        parsed.type = argv[++i];
        break;
      default:
        if (!arg.startsWith('-') && !parsed.packId) {
          parsed.packId = arg;
        }
    }
  }

  return parsed;
};

const printHelp = (): void => {
  console.log(`sim dump — Export pack runtime state as JSON to stdout

Usage:
  pnpm --filter yidhras-server sim:dump <packId> [--type <agent|relation|memory|all>]

Options:
  --type     Data category to dump (default: all)
             agent    — world entities + entity states for actors
             relation — authority grants + mediator bindings
             memory   — rule execution records
             all      — everything above
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

const runDump = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || !args.packId) {
    printHelp();
    process.exitCode = args.help && !args.packId ? 0 : 1;
    return;
  }

  const type = args.type ?? 'all';
  if (!VALID_TYPES.includes(type as (typeof VALID_TYPES)[number])) {
    console.error(`Invalid type: ${type}. Must be one of: ${VALID_TYPES.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const adapter = new SqlitePackStorageAdapter();
  const result: Record<string, unknown> = { pack_id: args.packId, type };

  if (type === 'agent' || type === 'all') {
    Object.assign(result, await dumpAgents(adapter, args.packId));
  }
  if (type === 'relation' || type === 'all') {
    Object.assign(result, await dumpRelations(adapter, args.packId));
  }
  if (type === 'memory' || type === 'all') {
    Object.assign(result, await dumpMemory(adapter, args.packId));
  }

  console.log(JSON.stringify(result, null, 2));
};

runDump().catch((err) => {
  console.error('Dump failed:', err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
