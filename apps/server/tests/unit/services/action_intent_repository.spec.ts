import { describe, expect, it, vi, beforeEach } from 'vitest';

import { createMockAppContext } from '../../helpers/mock_context.js';
import type { AppContext } from '../../../src/app/context.js';
import {
  getActionIntentForDispatchReflection,
  listDispatchableActionIntents,
  claimActionIntent,
  releaseActionIntentLock,
  assertActionIntentLockOwnership,
  markActionIntentDispatching,
  markActionIntentCompleted,
  markActionIntentFailed,
  markActionIntentDropped
} from '../../../src/app/services/action/action_intent_repository.js';

vi.mock('../../../src/app/services/pack/pack_runtime_resolution.js', () => ({
  resolvePackTick: vi.fn(() => 1000n)
}));

const makeIntent = (overrides: Record<string, unknown> = {}) => ({
  id: 'intent-1',
  source_inference_id: 'inf-1',
  intent_type: 'post_message',
  actor_ref: { agent_id: 'agent-1', identity_id: 'id-1' },
  target_ref: { agent_id: 'agent-2' },
  payload: { content: 'Hello' },
  scheduled_after_ticks: null,
  scheduled_for_tick: null,
  status: 'pending',
  locked_by: null,
  locked_at: null,
  lock_expires_at: null,
  dispatch_started_at: null,
  dispatched_at: null,
  transmission_delay_ticks: 0n,
  transmission_policy: null,
  transmission_drop_chance: null,
  drop_reason: null,
  dispatch_error_code: null,
  dispatch_error_message: null,
  source_workflow_run_id: null,
  source_workflow_step_id: null,
  source_step_attempt: null,
  created_at: 1000n,
  updated_at: 1000n,
  ...overrides
});

describe('action_intent_repository', () => {
  let ctx: AppContext;

  beforeEach(() => {
    ctx = createMockAppContext();
  });

  describe('listDispatchableActionIntents', () => {
    it('returns empty when no intents exist', async () => {
      ctx.prisma.actionIntent.findMany = vi.fn().mockResolvedValue([]);

      const result = await listDispatchableActionIntents(ctx, 10);
      expect(result).toEqual([]);
    });

    it('returns dispatchable intents', async () => {
      ctx.prisma.actionIntent.findMany = vi.fn().mockResolvedValue([makeIntent(), makeIntent({ id: 'intent-2' })]);

      const result = await listDispatchableActionIntents(ctx, 10);
      expect(result).toHaveLength(2);
    });
  });

  describe('claimActionIntent', () => {
    it('returns null when intent not found', async () => {
      ctx.prisma.actionIntent.findUnique = vi.fn().mockResolvedValue(null);

      const result = await claimActionIntent(ctx, {
        intent_id: 'nonexistent',
        worker_id: 'w-1',
        now: 1000n,
        lock_ticks: 1000n
      });

      expect(result).toBeNull();
    });

    it('returns null when intent is not dispatchable', async () => {
      ctx.prisma.actionIntent.findUnique = vi.fn().mockResolvedValue(makeIntent({ status: 'completed' }));

      const result = await claimActionIntent(ctx, {
        intent_id: 'intent-1',
        worker_id: 'w-1',
        now: 1000n,
        lock_ticks: 1000n
      });

      expect(result).toBeNull();
    });

    it('claims a pending intent', async () => {
      ctx.prisma.actionIntent.findUnique = vi.fn().mockResolvedValue(makeIntent());
      ctx.prisma.actionIntent.updateMany = vi.fn().mockResolvedValue({ count: 1 });
      // Second findUnique for the re-fetch after claim
      ctx.prisma.actionIntent.findUnique = vi.fn()
        .mockResolvedValueOnce(makeIntent())
        .mockResolvedValueOnce(makeIntent({ status: 'claimed', locked_by: 'w-1' }));

      const result = await claimActionIntent(ctx, {
        intent_id: 'intent-1',
        worker_id: 'w-1',
        now: 1000n,
        lock_ticks: 1000n
      });

      expect(result).not.toBeNull();
    });
  });

  describe('releaseActionIntentLock', () => {
    it('releases lock on intent', async () => {
      ctx.prisma.actionIntent.findUnique = vi.fn().mockResolvedValue(makeIntent({ locked_by: 'w-1' }));
      ctx.prisma.actionIntent.update = vi.fn().mockResolvedValue(makeIntent());

      await releaseActionIntentLock(ctx, {
        intent_id: 'intent-1',
        worker_id: 'w-1'
      });

      expect(ctx.prisma.actionIntent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'intent-1' },
          data: expect.objectContaining({
            locked_by: null,
            lock_expires_at: null
          })
        })
      );
    });
  });

  describe('markActionIntentDispatching', () => {
    it('marks intent as dispatching', async () => {
      ctx.prisma.actionIntent.update = vi.fn().mockResolvedValue(makeIntent({ status: 'dispatching' }));

      await markActionIntentDispatching(ctx, 'intent-1');

      expect(ctx.prisma.actionIntent.update).toHaveBeenCalled();
    });
  });

  describe('markActionIntentCompleted', () => {
    it('marks intent as completed', async () => {
      ctx.prisma.actionIntent.update = vi.fn().mockResolvedValue(makeIntent({ status: 'completed' }));

      await markActionIntentCompleted(ctx, 'intent-1');

      expect(ctx.prisma.actionIntent.update).toHaveBeenCalled();
    });
  });

  describe('markActionIntentFailed', () => {
    it('marks intent as failed', async () => {
      ctx.prisma.actionIntent.update = vi.fn().mockResolvedValue(makeIntent({ status: 'failed' }));

      await markActionIntentFailed(ctx, 'intent-1', 'Something went wrong', 'DISPATCH_ERROR');

      expect(ctx.prisma.actionIntent.update).toHaveBeenCalled();
    });
  });

  describe('markActionIntentDropped', () => {
    it('marks intent as dropped', async () => {
      ctx.prisma.actionIntent.update = vi.fn().mockResolvedValue(makeIntent({ status: 'dropped' }));

      await markActionIntentDropped(ctx, 'intent-1', 'transmission_policy');

      expect(ctx.prisma.actionIntent.update).toHaveBeenCalled();
    });
  });

  describe('getActionIntentForDispatchReflection', () => {
    it('returns null when intent not found', async () => {
      ctx.prisma.actionIntent.findUnique = vi.fn().mockResolvedValue(null);

      const result = await getActionIntentForDispatchReflection(ctx, 'nonexistent');
      expect(result).toBeNull();
    });

    it('returns intent with metadata when found', async () => {
      ctx.prisma.actionIntent.findUnique = vi.fn().mockResolvedValue(makeIntent());
      ctx.prisma.inferenceTrace.findUnique = vi.fn().mockResolvedValue({ id: 'trace-1', metadata: {} });
      ctx.prisma.decisionJob.findUnique = vi.fn().mockResolvedValue(null);
      ctx.prisma.event.findMany = vi.fn().mockResolvedValue([]);

      const result = await getActionIntentForDispatchReflection(ctx, 'intent-1');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('intent-1');
      expect(result!.intent_type).toBe('post_message');
    });
  });
});
