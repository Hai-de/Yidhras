import {
  type PreparedWorldStep,
  WORLD_ENGINE_PROTOCOL_VERSION,
  type WorldDomainEvent,
  type WorldEngineCommitResult,
  type WorldEngineObservationRecord
} from '@yidhras/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@prisma/client';

import type { AppContext } from '../../../src/app/context.js';
import {
  createDefaultWorldEnginePersistencePort,
  createWorldEngineStepCoordinator,
  executeWorldEnginePreparedStep
} from '../../../src/app/runtime/world_engine_persistence.js';
import type { WorldEnginePort } from '../../../src/app/runtime/world_engine_ports.js';
import type { PackStorageAdapter } from '../../../src/packs/storage/PackStorageAdapter.js';
import { wrapPrismaAsRepositories } from '../../helpers/mock_repos.js';

const TEST_PACK_ID = 'world-test-pack';

const createMockPackStorageAdapter = (): PackStorageAdapter => ({
  backend: 'sqlite',
  ping: async () => true,
  destroyPackStorage: async () => {},
  ensureEngineOwnedSchema: async () => {},
  listEngineOwnedRecords: async () => [],
  upsertEngineOwnedRecord: async (_packId, _table, record) => record as never,
  ensureCollection: async () => {},
  upsertCollectionRecord: async () => null,
  listCollectionRecords: async () => [],
  exportPackData: async () => ({}),
  importPackData: async () => {}
});

const createMinimalContext = (): AppContext => {
  const prisma = {} as never;
  return {
    repos: wrapPrismaAsRepositories(prisma as unknown as PrismaClient),
    prisma,
    packStorageAdapter: createMockPackStorageAdapter(),
  sim: {} as never,
  notifications: {
    push: vi.fn() as never,
    getMessages: vi.fn(() => []),
    clear: vi.fn()
  },
  startupHealth: {
    level: 'ok',
    checks: { db: true, world_pack_dir: true, world_pack_available: true },
    available_world_packs: [TEST_PACK_ID],
    errors: []
  },
  getRuntimeReady: () => true,
  setRuntimeReady: vi.fn(),
  getPaused: () => false,
  setPaused: vi.fn(),
  worldEngineStepCoordinator: createWorldEngineStepCoordinator(),
  assertRuntimeReady: vi.fn()
  };
};

const createPreparedEvent = (packId: string, token: string, tick: string): WorldDomainEvent => ({
  event_id: `world-step-prepared:${token}`,
  pack_id: packId,
  event_type: 'world.step.prepared',
  emitted_at_tick: tick,
  entity_id: '__world__',
  refs: { prepared_token: token },
  payload: { transition_kind: 'clock_advance' }
});

const createPreparedObservability = (token: string): WorldEngineObservationRecord[] => [
  {
    kind: 'diagnostic',
    code: 'WORLD_STEP_PREPARED',
    attributes: { prepared_token: token }
  },
  {
    kind: 'diagnostic',
    code: 'WORLD_CORE_DELTA_BUILT',
    attributes: {
      prepared_token: token,
      delta_operation_count: 2,
      mutated_entity_ids: ['__world__'],
      mutated_namespace_refs: ['__world__/world']
    }
  }
];

const createPreparedStep = (input: {
  packId: string;
  token: string;
  nextRevision: string;
  nextTick: string;
}): PreparedWorldStep => ({
  prepared_token: input.token,
  pack_id: input.packId,
  base_revision: '0',
  next_revision: input.nextRevision,
  next_tick: input.nextTick,
  state_delta: {
    operations: [
      {
        op: 'upsert_entity_state',
        target_ref: '__world__',
        namespace: 'world',
        payload: {
          next: { runtime_step: { prepared_token: input.token, transition_kind: 'clock_advance' } },
          previous: {},
          reason: 'runtime_loop'
        }
      },
      {
        op: 'append_rule_execution',
        target_ref: '__world__',
        namespace: 'rule_execution_records',
        payload: {
          next: { id: `world-step:${input.token}`, payload_json: { prepared_token: input.token, transition_kind: 'clock_advance' } },
          reason: 'runtime_loop'
        }
      },
      {
        op: 'set_clock',
        payload: { next: { previous_tick: '0', next_tick: input.nextTick, previous_revision: '0', next_revision: input.nextRevision }, reason: 'runtime_loop' }
      }
    ],
    metadata: {
      source: 'test',
      pack_id: input.packId,
      reason: 'runtime_loop',
      base_tick: '0',
      next_tick: input.nextTick,
      base_revision: '0',
      next_revision: input.nextRevision,
      mutated_entity_ids: ['__world__'],
      mutated_namespace_refs: ['__world__/world', 'rule_execution_records'],
      delta_operation_count: 3
    }
  },
  emitted_events: [createPreparedEvent(input.packId, input.token, input.nextTick)],
  observability: createPreparedObservability(input.token),
  summary: { applied_rule_count: 0, event_count: 1, mutated_entity_count: 2 }
});

const createCommitResult = (packId: string, token: string, revision: string): WorldEngineCommitResult => ({
  protocol_version: WORLD_ENGINE_PROTOCOL_VERSION,
  pack_id: packId,
  prepared_token: token,
  committed_revision: revision,
  committed_tick: revision,
  summary: { applied_rule_count: 0, event_count: 1, mutated_entity_count: 2 }
});

describe('world engine persistence orchestration', () => {
  it('commits prepared step after host persistence succeeds', async () => {
    const worldEngine: WorldEnginePort = {
      loadPack: vi.fn() as never,
      unloadPack: vi.fn() as never,
      queryState: vi.fn() as never,
      getStatus: vi.fn() as never,
      getHealth: vi.fn() as never,
      prepareStep: vi.fn(async input => createPreparedStep({ packId: input.pack_id, token: 'prepared-1', nextRevision: '1', nextTick: '1' })),
      commitPreparedStep: vi.fn(async input =>
        createCommitResult(input.pack_id, input.prepared_token, input.persisted_revision)
      ),
      abortPreparedStep: vi.fn(async () => undefined),
      executeObjectiveRule: vi.fn() as never
    };

    const result = await executeWorldEnginePreparedStep({
      context: createMinimalContext(),
      worldEngine,
      persistence: createDefaultWorldEnginePersistencePort(),
      prepareInput: {
        protocol_version: WORLD_ENGINE_PROTOCOL_VERSION,
        pack_id: TEST_PACK_ID,
        step_ticks: '1',
        reason: 'runtime_loop'
      }
    });

    expect(result.committed_tick).toBe('1');
    expect(worldEngine.commitPreparedStep).toHaveBeenCalledTimes(1);
    expect(worldEngine.commitPreparedStep).toHaveBeenCalledWith(expect.objectContaining({
      persisted_revision: '1',
      prepared_token: 'prepared-1'
    }));
    const persistenceCall = (worldEngine.commitPreparedStep as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(persistenceCall).toMatchObject({
      persisted_revision: '1'
    });
    expect(worldEngine.abortPreparedStep).not.toHaveBeenCalled();
  });

  it('aborts prepared step when host persistence fails', async () => {
    const worldEngine: WorldEnginePort = {
      loadPack: vi.fn() as never,
      unloadPack: vi.fn() as never,
      queryState: vi.fn() as never,
      getStatus: vi.fn() as never,
      getHealth: vi.fn() as never,
      prepareStep: vi.fn(async input => createPreparedStep({ packId: input.pack_id, token: 'prepared-2', nextRevision: '2', nextTick: '2' })),
      commitPreparedStep: vi.fn() as never,
      abortPreparedStep: vi.fn(async () => undefined),
      executeObjectiveRule: vi.fn() as never
    };

    await expect(executeWorldEnginePreparedStep({
      context: createMinimalContext(),
      worldEngine,
      persistence: {
        persistPreparedStep: vi.fn(async () => {
          throw new Error('persist failed');
        })
      },
      prepareInput: {
        protocol_version: WORLD_ENGINE_PROTOCOL_VERSION,
        pack_id: TEST_PACK_ID,
        step_ticks: '1',
        reason: 'runtime_loop'
      }
    })).rejects.toThrow('persist failed');

    expect(worldEngine.abortPreparedStep).toHaveBeenCalledTimes(1);
    expect(worldEngine.abortPreparedStep).toHaveBeenCalledWith(expect.objectContaining({
      prepared_token: 'prepared-2'
    }));
  });

  it('marks pack as tainted when abort also fails', async () => {
    const worldEngine: WorldEnginePort = {
      loadPack: vi.fn() as never,
      unloadPack: vi.fn() as never,
      queryState: vi.fn() as never,
      getStatus: vi.fn() as never,
      getHealth: vi.fn() as never,
      prepareStep: vi.fn(async input => createPreparedStep({ packId: input.pack_id, token: 'prepared-3', nextRevision: '3', nextTick: '3' })),
      commitPreparedStep: vi.fn() as never,
      abortPreparedStep: vi.fn(async () => {
        throw new Error('abort failed');
      }),
      executeObjectiveRule: vi.fn() as never
    };

    const context = createMinimalContext();
    await expect(executeWorldEnginePreparedStep({
      context,
      worldEngine,
      persistence: {
        persistPreparedStep: vi.fn(async () => {
          throw new Error('persist failed');
        })
      },
      prepareInput: {
        protocol_version: WORLD_ENGINE_PROTOCOL_VERSION,
        pack_id: TEST_PACK_ID,
        step_ticks: '1',
        reason: 'runtime_loop'
      }
    })).rejects.toThrow('persist failed');

    expect(context.worldEngineStepCoordinator?.listTaintedPackIds()).toContain(TEST_PACK_ID);
    expect((worldEngine.abortPreparedStep as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  it('uses the coordinator injected on AppContext when explicit coordinator is absent', async () => {
    const context = createMinimalContext();
    const coordinator = context.worldEngineStepCoordinator;
    const worldEngine: WorldEnginePort = {
      loadPack: vi.fn() as never,
      unloadPack: vi.fn() as never,
      queryState: vi.fn() as never,
      getStatus: vi.fn() as never,
      getHealth: vi.fn() as never,
      prepareStep: vi.fn(async input => createPreparedStep({ packId: input.pack_id, token: 'prepared-context', nextRevision: '6', nextTick: '6' })),
      commitPreparedStep: vi.fn(async input => createCommitResult(input.pack_id, input.prepared_token, input.persisted_revision)),
      abortPreparedStep: vi.fn(async () => undefined),
      executeObjectiveRule: vi.fn() as never
    };

    const result = await executeWorldEnginePreparedStep({
      context,
      worldEngine,
      persistence: {
        persistPreparedStep: vi.fn(async ({ prepared }) => ({
          persisted_revision: prepared.next_revision,
          applied_operations: prepared.state_delta.operations.map((item: { op: string }) => item.op),
          persisted_entity_states: [],
          persisted_rule_execution_records: [],
          clock_delta: null,
          observability: []
        }))
      },
      prepareInput: {
        protocol_version: WORLD_ENGINE_PROTOCOL_VERSION,
        pack_id: TEST_PACK_ID,
        step_ticks: '1',
        reason: 'runtime_loop'
      }
    });

    expect(result.committed_tick).toBe('6');
    expect(coordinator?.listTaintedPackIds()).toEqual([]);
  });

  it('throws when AppContext does not provide a world engine step coordinator', async () => {
    const contextWithoutCoordinator = {
      ...createMinimalContext(),
      worldEngineStepCoordinator: undefined
    } as AppContext;
    const worldEngine: WorldEnginePort = {
      loadPack: vi.fn() as never,
      unloadPack: vi.fn() as never,
      queryState: vi.fn() as never,
      getStatus: vi.fn() as never,
      getHealth: vi.fn() as never,
      prepareStep: vi.fn() as never,
      commitPreparedStep: vi.fn() as never,
      abortPreparedStep: vi.fn() as never,
      executeObjectiveRule: vi.fn() as never
    };

    await expect(executeWorldEnginePreparedStep({
      context: contextWithoutCoordinator,
      worldEngine,
      persistence: {
        persistPreparedStep: vi.fn() as never
      },
      prepareInput: {
        protocol_version: WORLD_ENGINE_PROTOCOL_VERSION,
        pack_id: TEST_PACK_ID,
        step_ticks: '1',
        reason: 'runtime_loop'
      }
    })).rejects.toThrow('World engine step coordinator is not configured on AppContext');
  });

  it('applies Pack Runtime Core delta ops through the default persistence layer', async () => {
    const existingStates = new Map<string, { id: string; entity_id: string; state_namespace: string; state_json: Record<string, unknown> }>();
    const recordedExecutions: Array<{ id: string; rule_id: string; execution_status: string }> = [];

    const context = createMinimalContext();

    const persistence = createDefaultWorldEnginePersistencePort();

    const entityStateRepo = await import('../../../src/packs/storage/entity_state_repo.js');
    const ruleExecutionRepo = await import('../../../src/packs/storage/rule_execution_repo.js');

    const listSpy = vi.spyOn(entityStateRepo, 'listPackEntityStates').mockImplementation(async () => {
      return Array.from(existingStates.values()).map(item => ({
        ...item,
        pack_id: TEST_PACK_ID,
        created_at: 0n,
        updated_at: 0n
      }));
    });
    const upsertSpy = vi.spyOn(entityStateRepo, 'upsertPackEntityState').mockImplementation(async input => {
      existingStates.set(`${input.entity_id}:${input.state_namespace}`, {
        id: input.id,
        entity_id: input.entity_id,
        state_namespace: input.state_namespace,
        state_json: input.state_json
      });
      return {
        id: input.id,
        pack_id: input.pack_id,
        entity_id: input.entity_id,
        state_namespace: input.state_namespace,
        state_json: input.state_json,
        created_at: input.now,
        updated_at: input.now
      };
    });
    const recordSpy = vi.spyOn(ruleExecutionRepo, 'recordPackRuleExecution').mockImplementation(async (_adapter, input) => {
      recordedExecutions.push({ id: input.id, rule_id: input.rule_id, execution_status: input.execution_status });
      return {
        id: input.id,
        pack_id: input.pack_id,
        rule_id: input.rule_id,
        capability_key: input.capability_key ?? null,
        mediator_id: input.mediator_id ?? null,
        subject_entity_id: input.subject_entity_id ?? null,
        target_entity_id: input.target_entity_id ?? null,
        execution_status: input.execution_status,
        payload_json: input.payload_json ?? null,
        emitted_events_json: input.emitted_events_json ?? [],
        created_at: input.now,
        updated_at: input.now
      };
    });

    const result = await persistence.persistPreparedStep({
      context,
      prepared: createPreparedStep({ packId: TEST_PACK_ID, token: 'prepared-4', nextRevision: '4', nextTick: '4' })
    });

    expect(result.applied_operations).toContain('upsert_entity_state');
    expect(result.applied_operations).toContain('append_rule_execution');
    expect(result.applied_operations).toContain('set_clock');
    expect(result.persisted_entity_states).toHaveLength(1);
    expect(result.persisted_rule_execution_records).toHaveLength(1);
    expect(result.clock_delta?.next_tick).toBe('4');
    expect(result.observability).toEqual([
      expect.objectContaining({
        code: 'WORLD_CORE_DELTA_APPLIED',
        attributes: expect.objectContaining({
          applied_operations: ['upsert_entity_state', 'append_rule_execution', 'set_clock']
        })
      })
    ]);
    expect(listSpy).toHaveBeenCalled();
    expect(upsertSpy).toHaveBeenCalled();
    expect(recordSpy).toHaveBeenCalled();
    expect(recordedExecutions).toEqual([{ id: 'world-step:prepared-4', rule_id: 'world_step.advance_clock', execution_status: 'applied' }]);

    listSpy.mockRestore();
    upsertSpy.mockRestore();
    recordSpy.mockRestore();
  });

  it('annotates apply failures with WORLD_CORE_DELTA_ABORTED observability', async () => {
    const persistence = createDefaultWorldEnginePersistencePort();
    const entityStateRepo = await import('../../../src/packs/storage/entity_state_repo.js');
    const listSpy = vi.spyOn(entityStateRepo, 'listPackEntityStates').mockRejectedValueOnce(new Error('sqlite unavailable'));

    const persistFailure = persistence.persistPreparedStep({
      context: createMinimalContext(),
      prepared: createPreparedStep({ packId: TEST_PACK_ID, token: 'prepared-5', nextRevision: '5', nextTick: '5' })
    });
    await expect(persistFailure).rejects.toBeInstanceOf(Error);
    await expect(persistFailure).rejects.toHaveProperty('details.observability.0.code', 'WORLD_CORE_DELTA_ABORTED');

    listSpy.mockRestore();
  });
});
