import { Prisma,PrismaClient } from '@prisma/client';

import type { AppContext, StartupHealth } from '../app/context.js';
import {
  assertActionIntentLockOwnership,
  claimActionIntent,
  listDispatchableActionIntents,
  releaseActionIntentLock
} from '../app/services/action_dispatcher.js';
import { ChronosEngine } from '../clock/engine.js';
import type { SimulationManager } from '../core/simulation.js';
import { notifications } from '../utils/notifications.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertNotNull<T>(value: T, message: string): asserts value is NonNullable<T> {
  if (value === null || value === undefined) {
    throw new Error(message);
  }
}

const buildTestContext = (prisma: PrismaClient): AppContext => {
  let paused = false;
  let runtimeReady = true;

  const sim = {
    prisma,
    clock: new ChronosEngine([], 1000n),
    getStepTicks: () => 1n,
    step: async () => {},
    getActivePack: () => null,
    getRuntimeSpeedSnapshot: () => ({
      mode: 'fixed' as const,
      source: 'default' as const,
      configured_step_ticks: null,
      override_step_ticks: null,
      override_since: null,
      effective_step_ticks: '1'
    }),
    setRuntimeSpeedOverride: () => {},
    clearRuntimeSpeedOverride: () => {}
  } as unknown as SimulationManager;

  const startupHealth: StartupHealth = {
    level: 'ok',
    checks: {
      db: true,
      world_pack_dir: true,
      world_pack_available: true
    },
    available_world_packs: ['cyber_noir'],
    errors: []
  };

  return {
    prisma,
    sim,
    notifications,
    startupHealth,
    getRuntimeReady: () => runtimeReady,
    setRuntimeReady: ready => {
      runtimeReady = ready;
    },
    getPaused: () => paused,
    setPaused: next => {
      paused = next;
    },
    assertRuntimeReady: () => {}
  };
};

const createActionIntent = async (context: AppContext, suffix: string) => {
  const now = context.sim.clock.getTicks();
  const inferenceId = `intent-lock-source-${suffix}-${Date.now()}`;

  await context.prisma.inferenceTrace.create({
    data: {
      id: inferenceId,
      kind: 'run',
      strategy: 'mock',
      provider: 'mock',
      actor_ref: { identity_id: 'agent-001', role: 'active', agent_id: 'agent-001', atmosphere_node_id: null },
      input: { agent_id: 'agent-001', strategy: 'mock' },
      context_snapshot: {},
      prompt_bundle: {},
      trace_metadata: {},
      created_at: now,
      updated_at: now
    }
  });

  return context.prisma.actionIntent.create({
    data: {
      source_inference_id: inferenceId,
      intent_type: 'post_message',
      actor_ref: { identity_id: 'agent-001', role: 'active', agent_id: 'agent-001', atmosphere_node_id: null },
      target_ref: Prisma.JsonNull,
      payload: { content: `intent-lock-${suffix}` },
      status: 'pending',
      scheduled_after_ticks: null,
      scheduled_for_tick: null,
      transmission_delay_ticks: null,
      transmission_policy: 'reliable',
      transmission_drop_chance: 0,
      drop_reason: null,
      dispatch_error_code: null,
      dispatch_error_message: null,
      locked_by: null,
      locked_at: null,
      lock_expires_at: null,
      created_at: now,
      updated_at: now
    }
  });
};

const testSingleClaim = async (context: AppContext) => {
  const intent = await createActionIntent(context, 'single-claim');

  const claimable = await listDispatchableActionIntents(context, 10);
  assert(claimable.some(item => item.id === intent.id), 'new pending intent should be dispatchable');

  const claimed = await claimActionIntent(context, {
    intent_id: intent.id,
    worker_id: 'dispatcher-a',
    now: 2000n,
    lock_ticks: 5n
  });
  assertNotNull(claimed, 'first action intent claim should succeed');
  assert(claimed.locked_by === 'dispatcher-a', 'claimed intent should set locked_by');
  assert(claimed.status === 'dispatching', 'claimed intent should move to dispatching');

  const secondClaim = await claimActionIntent(context, {
    intent_id: intent.id,
    worker_id: 'dispatcher-b',
    now: 2001n,
    lock_ticks: 5n
  });
  assert(secondClaim === null, 'second claim while intent lock valid should fail');
};

const testExpiredLockReclaim = async (context: AppContext) => {
  const intent = await createActionIntent(context, 'expired-reclaim');

  const claimed = await claimActionIntent(context, {
    intent_id: intent.id,
    worker_id: 'dispatcher-a',
    now: 3000n,
    lock_ticks: 2n
  });
  assertNotNull(claimed, 'initial action intent claim should succeed');
  assert(claimed.lock_expires_at === 3002n, 'action intent lock_expires_at should equal now + lock_ticks');

  await context.prisma.actionIntent.update({
    where: { id: intent.id },
    data: { status: 'pending', updated_at: 3003n }
  });

  const reclaimed = await claimActionIntent(context, {
    intent_id: intent.id,
    worker_id: 'dispatcher-b',
    now: 3003n,
    lock_ticks: 4n
  });
  assertNotNull(reclaimed, 'expired action intent lock should be reclaimable');
  assert(reclaimed.locked_by === 'dispatcher-b', 'reclaimed action intent should belong to new dispatcher worker');
};

const testOwnershipAndRelease = async (context: AppContext) => {
  const intent = await createActionIntent(context, 'ownership-release');

  const claimed = await claimActionIntent(context, {
    intent_id: intent.id,
    worker_id: 'dispatcher-a',
    now: 4000n,
    lock_ticks: 5n
  });
  assertNotNull(claimed, 'claim for ownership test should succeed');

  assertActionIntentLockOwnership(claimed, 'dispatcher-a', 4001n);

  let rejected = false;
  try {
    assertActionIntentLockOwnership(claimed, 'dispatcher-b', 4001n);
  } catch {
    rejected = true;
  }
  assert(rejected, 'ownership check should reject non-owner dispatcher worker');

  const wrongRelease = await releaseActionIntentLock(context, {
    intent_id: intent.id,
    worker_id: 'dispatcher-b'
  });
  assertNotNull(wrongRelease, 'wrong release should still return existing intent');
  assert(wrongRelease.locked_by === 'dispatcher-a', 'release by wrong worker should not clear action intent lock');

  const released = await releaseActionIntentLock(context, {
    intent_id: intent.id,
    worker_id: 'dispatcher-a'
  });
  assertNotNull(released, 'release by owner should return updated intent');
  assert(released.locked_by === null, 'release by owner should clear locked_by');
  assert(released.locked_at === null, 'release by owner should clear locked_at');
  assert(released.lock_expires_at === null, 'release by owner should clear lock_expires_at');
};

const main = async () => {
  const prisma = new PrismaClient();
  const context = buildTestContext(prisma);

  try {
    await testSingleClaim(context);
    await testExpiredLockReclaim(context);
    await testOwnershipAndRelease(context);

    console.log('[action_intent_locking] PASS');
  } catch (error: unknown) {
    console.error('[action_intent_locking] FAIL');
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
};

void main();
