import type { AppContext } from '../context.js';
import {
  assertActionIntentLockOwnership,
  claimActionIntent,
  DEFAULT_ACTION_INTENT_LOCK_TICKS,
  dispatchActionIntent,
  listDispatchableActionIntents,
  markActionIntentCompleted,
  markActionIntentDropped,
  markActionIntentFailed
} from '../services/action_dispatcher.js';

export interface RunActionDispatcherOptions {
  context: AppContext;
  workerId: string;
  limit?: number;
  lockTicks?: bigint;
}

export const runActionDispatcher = async ({
  context,
  workerId,
  limit = 5,
  lockTicks = DEFAULT_ACTION_INTENT_LOCK_TICKS
}: RunActionDispatcherOptions): Promise<number> => {
  const intents = await listDispatchableActionIntents(context, limit);
  let dispatchedCount = 0;

  for (const intent of intents) {
    let claimedIntent = null;

    try {
      claimedIntent = await claimActionIntent(context, {
        intent_id: intent.id,
        worker_id: workerId,
        lock_ticks: lockTicks
      });
      if (!claimedIntent) {
        continue;
      }

      assertActionIntentLockOwnership(claimedIntent, workerId, context.sim.getCurrentTick());

      const result = await dispatchActionIntent(context, claimedIntent);
      if (result.outcome === 'dropped') {
        await markActionIntentDropped(context, claimedIntent.id, result.reason);
        continue;
      }

      await markActionIntentCompleted(context, claimedIntent.id);
      dispatchedCount += 1;
    } catch (err) {
      if (!claimedIntent) {
        continue;
      }

      const errorCode = err instanceof Error && 'code' in err && typeof err.code === 'string'
        ? err.code
        : 'ACTION_DISPATCH_FAIL';
      await markActionIntentFailed(
        context,
        claimedIntent.id,
        err instanceof Error ? err.message : String(err),
        errorCode
      );
    }
  }

  return dispatchedCount;
};
