import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import {
  assertActionIntentLockOwnership,
  claimActionIntent,
  listDispatchableActionIntents,
  releaseActionIntentLock
} from '../../src/app/services/action_dispatcher.js';
import { createIsolatedAppContextFixture } from '../fixtures/isolated-db.js';

const INTENT_SOURCE_PREFIX = 'intent-lock-source-';

describe('action intent locking integration', () => {
  let cleanup: (() => Promise<void>) | null = null;
  let context: AppContext;

  beforeAll(async () => {
    const fixture = await createIsolatedAppContextFixture();
    cleanup = fixture.cleanup;
    context = fixture.context;
  });

  beforeEach(async () => {
    await context.prisma.actionIntent.deleteMany({
      where: {
        source_inference_id: {
          startsWith: INTENT_SOURCE_PREFIX
        }
      }
    });
    await context.prisma.inferenceTrace.deleteMany({
      where: {
        id: {
          startsWith: INTENT_SOURCE_PREFIX
        }
      }
    });
  });

  afterAll(async () => {
    await cleanup?.();
  });

  const createActionIntent = async (suffix: string) => {
    const now = context.sim.clock.getTicks();
    const inferenceId = `${INTENT_SOURCE_PREFIX}${suffix}-${Date.now()}`;

    await context.prisma.inferenceTrace.create({
      data: {
        id: inferenceId,
        kind: 'run',
        strategy: 'mock',
        provider: 'mock',
        actor_ref: {
          identity_id: 'agent-001',
          role: 'active',
          agent_id: 'agent-001',
          atmosphere_node_id: null
        },
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
        actor_ref: {
          identity_id: 'agent-001',
          role: 'active',
          agent_id: 'agent-001',
          atmosphere_node_id: null
        },
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

  it('lists and claims a pending action intent only once', async () => {
    const intent = await createActionIntent('single-claim');

    const claimable = await listDispatchableActionIntents(context, 10);
    expect(claimable.some(item => item.id === intent.id)).toBe(true);

    const claimed = await claimActionIntent(context, {
      intent_id: intent.id,
      worker_id: 'dispatcher-a',
      now: 2000n,
      lock_ticks: 5n
    });
    expect(claimed).not.toBeNull();
    expect(claimed?.locked_by).toBe('dispatcher-a');
    expect(claimed?.status).toBe('dispatching');

    const secondClaim = await claimActionIntent(context, {
      intent_id: intent.id,
      worker_id: 'dispatcher-b',
      now: 2001n,
      lock_ticks: 5n
    });
    expect(secondClaim).toBeNull();
  });

  it('reclaims expired locks after the intent becomes pending again', async () => {
    const intent = await createActionIntent('expired-reclaim');

    const claimed = await claimActionIntent(context, {
      intent_id: intent.id,
      worker_id: 'dispatcher-a',
      now: 3000n,
      lock_ticks: 2n
    });
    expect(claimed).not.toBeNull();
    expect(claimed?.lock_expires_at).toBe(3002n);

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
    expect(reclaimed).not.toBeNull();
    expect(reclaimed?.locked_by).toBe('dispatcher-b');
  });

  it('enforces ownership checks when releasing locks', async () => {
    const intent = await createActionIntent('ownership-release');

    const claimed = await claimActionIntent(context, {
      intent_id: intent.id,
      worker_id: 'dispatcher-a',
      now: 4000n,
      lock_ticks: 5n
    });
    expect(claimed).not.toBeNull();
    if (!claimed) {
      return;
    }

    expect(() => assertActionIntentLockOwnership(claimed, 'dispatcher-a', 4001n)).not.toThrow();
    expect(() => assertActionIntentLockOwnership(claimed, 'dispatcher-b', 4001n)).toThrow();

    const wrongRelease = await releaseActionIntentLock(context, {
      intent_id: intent.id,
      worker_id: 'dispatcher-b'
    });
    expect(wrongRelease).not.toBeNull();
    expect(wrongRelease?.locked_by).toBe('dispatcher-a');

    const released = await releaseActionIntentLock(context, {
      intent_id: intent.id,
      worker_id: 'dispatcher-a'
    });
    expect(released).not.toBeNull();
    expect(released?.locked_by).toBeNull();
    expect(released?.locked_at).toBeNull();
    expect(released?.lock_expires_at).toBeNull();
  });
});
