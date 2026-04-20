import {
  type PreparedWorldStep,
  WORLD_ENGINE_PROTOCOL_VERSION,
  type WorldDomainEvent,
  type WorldEngineCommitResult,
  type WorldEngineObservationRecord
} from '@yidhras/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../../src/app/context.js';
import {
  clearTaintedWorldEnginePackId,
  createDefaultWorldEnginePersistencePort,
  executeWorldEnginePreparedStep,
  listTaintedWorldEnginePackIds
} from '../../../src/app/runtime/world_engine_persistence.js';
import type { WorldEnginePort } from '../../../src/app/runtime/world_engine_ports.js';

const createMinimalContext = (): AppContext => ({
  prisma: {} as never,
  sim: {} as never,
  notifications: {
    push: vi.fn() as never,
    getMessages: vi.fn(() => []),
    clear: vi.fn()
  },
  startupHealth: {
    level: 'ok',
    checks: { db: true, world_pack_dir: true, world_pack_available: true },
    available_world_packs: ['world-death-note'],
    errors: []
  },
  getRuntimeReady: () => true,
  setRuntimeReady: vi.fn(),
  getPaused: () => false,
  setPaused: vi.fn(),
  assertRuntimeReady: vi.fn()
}) as unknown as AppContext;

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
          state_json: { runtime_step: { prepared_token: input.token, transition_kind: 'clock_advance' } },
          previous_state: {}
        }
      },
      {
        op: 'set_clock',
        payload: { previous_tick: '0', next_tick: input.nextTick, previous_revision: '0', next_revision: input.nextRevision }
      }
    ],
    metadata: { source: 'test', mutated_entity_ids: ['__world__'] }
  },
  emitted_events: [createPreparedEvent(input.packId, input.token, input.nextTick)],
  observability: createPreparedObservability(input.token),
  summary: { applied_rule_count: 0, event_count: 1, mutated_entity_count: 1 }
});

const createCommitResult = (packId: string, token: string, revision: string): WorldEngineCommitResult => ({
  protocol_version: WORLD_ENGINE_PROTOCOL_VERSION,
  pack_id: packId,
  prepared_token: token,
  committed_revision: revision,
  committed_tick: revision,
  summary: { applied_rule_count: 0, event_count: 1, mutated_entity_count: 1 }
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
      abortPreparedStep: vi.fn(async () => undefined)
    };

    const result = await executeWorldEnginePreparedStep({
      context: createMinimalContext(),
      worldEngine,
      persistence: createDefaultWorldEnginePersistencePort(),
      prepareInput: {
        protocol_version: WORLD_ENGINE_PROTOCOL_VERSION,
        pack_id: 'world-death-note',
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
      abortPreparedStep: vi.fn(async () => undefined)
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
        pack_id: 'world-death-note',
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
    clearTaintedWorldEnginePackId('world-death-note');

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
      })
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
        pack_id: 'world-death-note',
        step_ticks: '1',
        reason: 'runtime_loop'
      }
    })).rejects.toThrow('persist failed');

    expect(listTaintedWorldEnginePackIds()).toContain('world-death-note');
    clearTaintedWorldEnginePackId('world-death-note');
  });
});
