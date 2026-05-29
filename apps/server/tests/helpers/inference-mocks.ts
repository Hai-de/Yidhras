import type { PrismaClient } from '@prisma/client';
import { vi } from 'vitest';
import type { DeepMockProxy } from 'vitest-mock-extended';

import type { AppInfrastructure } from '../../src/app/context.js';
import type { Repositories } from '../../src/app/services/repositories/index.js';
import { createPrismaRepositories } from '../../src/app/services/repositories/index.js';
import type {
  InferenceContextConfig,
  PolicyEvaluationConfig
} from '../../src/inference/context/config_loader.js';
import type { PackStorageAdapter } from '../../src/packs/storage/PackStorageAdapter.js';
import { createMockPrisma } from './prisma_mock.js';

// ── A.1.1 makeMockPrisma ──────────────────────────────────────

/**
 * Creates a deep mock of PrismaClient with pre-configured
 * event.findMany and event.findFirst stubs.
 *
 * Re-exports createMockPrisma for discoverability under the
 * inference-mocks naming convention.
 */
export const makeMockPrisma = (): DeepMockProxy<PrismaClient> => {
  return createMockPrisma();
};

// ── A.1.2 makeMockPackStorageAdapter ──────────────────────────

export interface MockPackStorageAdapterOptions {
  /** Rows returned by listEngineOwnedRecords for entity_states table. */
  entityStateRows?: Array<{
    entity_id: string;
    state_namespace: string;
    state_json: Record<string, unknown>;
  }>;
  /**
   * Per-table rows returned by listEngineOwnedRecords.
   * Keys are table names (e.g. 'entity_states', 'authority_grants', 'world_entities', 'mediator_bindings').
   * Falls back to entityStateRows for 'entity_states' when not specified here.
   */
  tableRows?: Record<string, Array<Record<string, unknown>>>;
  /** If true, listEngineOwnedRecords throws for error-path testing. */
  throwOnList?: boolean;
}

/**
 * Creates a minimal mock of PackStorageAdapter.
 *
 * listEngineOwnedRecords returns rows keyed by table name.
 * The `entityStateRows` shorthand populates the 'entity_states' table.
 * All other methods are vi.fn() no-ops.
 */
export const makeMockPackStorageAdapter = (
  options: MockPackStorageAdapterOptions = {}
): PackStorageAdapter => {
  const { entityStateRows = [], tableRows = {}, throwOnList = false } = options;

  const mergedTableRows: Record<string, Array<Record<string, unknown>>> = {
    entity_states: entityStateRows.map((row) => ({
      id: `es-${row.entity_id}-${row.state_namespace}`,
      pack_id: '',
      ...row,
      created_at: 0n,
      updated_at: 0n
    })),
    ...tableRows
  };

  return {
    backend: 'sqlite',
    ping: vi.fn(async () => true),
    destroyPackStorage: vi.fn(async () => {}),
    ensureEngineOwnedSchema: vi.fn(async () => {}),
    ensureCollection: vi.fn(async () => {}),
    listEngineOwnedRecords: vi.fn(async (_packId: string, tableName: string) => {
      if (throwOnList) throw new Error('mock adapter error');
      // eslint-disable-next-line security/detect-object-injection -- test helper: tableName is a test author controlled literal
      return mergedTableRows[tableName] ?? [];
    }),
    upsertEngineOwnedRecord: vi.fn(async (_packId, _table, record) => record as never),
    upsertCollectionRecord: vi.fn(async () => null),
    listCollectionRecords: vi.fn(async () => []),
    exportPackData: vi.fn(async () => ({})),
    importPackData: vi.fn(async () => {})
  };
};

// ── A.1.3 makeMockRepos ────────────────────────────────────────

/**
 * Wraps a PrismaClient (real or deep-mock) into Repositories.
 *
 * Thin wrapper around createPrismaRepositories for the
 * inference-mocks naming convention.
 */
export const makeMockRepos = (prisma: DeepMockProxy<PrismaClient>): Repositories => {
  return createPrismaRepositories(prisma as PrismaClient);
};

// ── A.1.4 makeMockPackRuntimeHost ─────────────────────────────

export interface MockPackOverrides {
  metadata?: Partial<{ id: string; name: string; version: string }>;
  variables?: Record<string, unknown>;
  prompts?: Record<string, string>;
  ai?: Record<string, unknown> | null;
  rules?: {
    invocation?: Array<{ id: string; when: Record<string, unknown>; then: Record<string, unknown> }>;
    perception?: Array<{ id: string; when: Record<string, unknown>; then: Record<string, unknown> }>;
  };
  entities?: {
    actors?: Array<{
      id: string;
      kind?: string;
      inference?: { provider?: string; model?: string; behavior_tree?: string };
    }>;
  };
  behavior_trees?: Record<string, unknown>;
}

export interface MockPackRuntimeHostOptions {
  packOverrides?: MockPackOverrides;
  currentTick?: bigint;
}

/**
 * Creates a mock PackRuntimeHost with a configurable pack shape.
 *
 * @example
 * const host = makeMockPackRuntimeHost({
 *   packOverrides: { metadata: { name: 'Test Pack' } }
 * });
 * host.getPackRuntimeHost('any').getPack().metadata.name // 'Test Pack'
 */
export const makeMockPackRuntimeHost = (options: MockPackRuntimeHostOptions = {}) => {
  const { packOverrides = {}, currentTick = 1000n } = options;

  const pack = {
    metadata: {
      id: packOverrides.metadata?.id ?? 'test-pack',
      name: packOverrides.metadata?.name ?? 'Test Pack',
      version: packOverrides.metadata?.version ?? '0.1.0'
    },
    variables: packOverrides.variables ?? {},
    prompts: packOverrides.prompts ?? {},
    ai: (packOverrides.ai ?? null) as never,
    rules: (packOverrides.rules ?? {}) as never,
    entities: packOverrides.entities as never,
    behavior_trees: packOverrides.behavior_trees as never
  };

  const getPackRuntimeHost = vi.fn((_packId: string) => ({
    getPack: () => pack,
    getCurrentTick: () => currentTick,
    getCurrentRevision: () => currentTick,
    getRuntimeSpeedSnapshot: () => ({
      mode: 'variable' as const,
      source: 'default' as const,
      strategy: { kind: 'variable' as const, range: { min: 1n, max: 1n }, loopIntervalMs: 1000 },
      effective_step_ticks: '1',
      override_since: null
    }),
    getAllTimes: () => ({}),
    getPackId: () => 'test-pack',
    getStepTicks: () => 1n,
    step: vi.fn(async () => {}),
    applyClockProjection: vi.fn()
  }));

  return { getPackRuntimeHost, pack };
};

// ── A.1.5 makeMockAppInfrastructure ───────────────────────────

export interface MockAppInfrastructureOptions {
  prisma?: DeepMockProxy<PrismaClient>;
  packStorageAdapter?: PackStorageAdapter;
  getPackRuntimeHost?: ReturnType<typeof makeMockPackRuntimeHost>['getPackRuntimeHost'];
  assertRuntimeReady?: () => void;
  startupHealth?: AppInfrastructure['startupHealth'];
  transactionPassthrough?: boolean;
}

/**
 * Creates a mock AppInfrastructure suitable for inference context
 * pipeline testing.
 *
 * Composes prisma + packStorageAdapter + getPackRuntimeHost +
 * repos + startupHealth + assertRuntimeReady into a single
 * object matching the Ctx type expected by ContextAssemblyPipeline.
 */
export const makeMockAppInfrastructure = (
  options: MockAppInfrastructureOptions = {}
) => {
  const prisma = options.prisma ?? makeMockPrisma();
  const packRuntimeHost = options.getPackRuntimeHost ?? makeMockPackRuntimeHost().getPackRuntimeHost;

  if (options.transactionPassthrough && !options.prisma) {
    prisma.$transaction.mockImplementation(
      async (arg: unknown): Promise<unknown> => {
        if (typeof arg === 'function') {
          return (arg as (tx: PrismaClient) => unknown)(prisma as unknown as PrismaClient);
        }
        return [];
      }
    );
  }

  const repos = makeMockRepos(prisma);

  const base = {
    prisma: prisma as never,
    repos,
    packStorageAdapter: options.packStorageAdapter ?? makeMockPackStorageAdapter(),
    getPackRuntimeHost: packRuntimeHost,
    startupHealth: options.startupHealth ?? {
      level: 'ok' as const,
      checks: { db: true, world_pack_dir: true, world_pack_available: true },
      available_world_packs: ['test-pack'],
      errors: []
    },
    assertRuntimeReady: options.assertRuntimeReady ?? vi.fn()
  };

  return base;
};

// ── A.1.6 makeMockConfig ───────────────────────────────────────

export interface MockConfigOverrides {
  configVersion?: number;
  variableLayers?: InferenceContextConfig['variable_context'];
  transmissionProfile?: InferenceContextConfig['transmission_profile'];
  policyEvaluations?: PolicyEvaluationConfig[];
}

/**
 * Creates a minimal InferenceContextConfig for testing without
 * touching the filesystem.
 *
 * Defaults match BUILTIN_DEFAULTS structure with all 6 layers
 * enabled.
 */
export const makeMockConfig = (
  overrides: MockConfigOverrides = {}
): InferenceContextConfig => {
  return {
    config_version: overrides.configVersion ?? 1,
    variable_context: overrides.variableLayers ?? {
      layers: {
        system: {
          enabled: true,
          values: { name: 'Yidhras', timezone: 'Asia/Shanghai' },
          alias_values: { system_name: '{{name}}', timezone: '{{timezone}}' }
        },
        app: {
          enabled: true,
          values: { startup_health: '{{app.startup_health}}' },
          alias_values: { startup_level: '{{app.startup_health.level}}' }
        },
        pack: {
          enabled: true,
          values: {
            metadata: '{{pack.metadata}}',
            variables: '{{pack.variables}}',
            prompts: '{{pack.prompts}}',
            ai: '{{pack.ai}}'
          },
          alias_values: {
            world_name: '{{pack.metadata.name}}',
            pack_id: '{{pack.metadata.id}}',
            pack_name: '{{pack.metadata.name}}'
          }
        },
        runtime: {
          enabled: true,
          values: {
            current_tick: '{{runtime.current_tick}}',
            pack_state: '{{runtime.pack_state}}',
            pack_runtime: '{{runtime.pack_runtime}}',
            world_state: '{{runtime.pack_state.world_state}}',
            owned_artifacts: '{{runtime.pack_state.owned_artifacts}}',
            latest_event: '{{runtime.pack_state.latest_event}}'
          },
          alias_values: {
            current_tick: '{{runtime.current_tick}}',
            world_state: '{{runtime.pack_state.world_state}}',
            latest_event: '{{runtime.pack_state.latest_event}}',
            owned_artifacts: '{{runtime.pack_state.owned_artifacts}}'
          }
        },
        actor: {
          enabled: true,
          values: {
            identity_id: '{{actor.identity.id}}',
            identity_type: '{{actor.identity.type}}',
            display_name: '{{actor.display_name}}',
            role: '{{actor.role}}',
            binding_ref: '{{actor.binding_ref}}',
            agent_id: '{{actor.agent_id}}',
            agent_snapshot: '{{actor.agent_snapshot}}'
          },
          alias_values: {
            actor_name: '{{actor.display_name}}',
            actor_role: '{{actor.role}}',
            actor_id: '{{actor.agent_id ?? actor.identity.id}}',
            identity_id: '{{actor.identity.id}}'
          }
        },
        request: {
          enabled: true,
          values: {
            task_type: 'agent_decision',
            strategy: '{{request.strategy}}',
            attributes: '{{request.attributes}}',
            agent_id: '{{request.agent_id}}',
            identity_id: '{{request.identity_id}}',
            idempotency_key: '{{request.idempotency_key}}'
          },
          alias_values: {
            strategy: '{{request.strategy}}',
            task_type: 'agent_decision',
            request_agent_id: '{{request.agent_id}}',
            request_identity_id: '{{request.identity_id}}'
          }
        }
      }
    },
    transmission_profile: overrides.transmissionProfile ?? {
      defaults: { snr_fallback: 0.5, delay_ticks_fallback: '1' },
      thresholds: { fragile_snr: 0.3 },
      drop_chances: { fragile: 0.35, best_effort: 0.15, reliable: 0.0 },
      policies: {
        read_restricted_base: 'best_effort',
        low_snr_base: 'fragile',
        default_base: 'reliable'
      }
    },
    policy_summary: {
      evaluations: overrides.policyEvaluations ?? [
        {
          resource: 'social_post',
          action: 'read',
          fields: ['id', 'author_id', 'content', 'created_at', 'content.private.preview', 'content.private.raw']
        },
        {
          resource: 'social_post',
          action: 'write',
          fields: ['content']
        }
      ]
    }
  };
};
