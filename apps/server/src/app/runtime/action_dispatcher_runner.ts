import type { AppContext } from '../context.js';
import {
  dispatchActionIntent,
  listDispatchableActionIntents,
  markActionIntentCompleted,
  markActionIntentDispatching,
  markActionIntentDropped,
  markActionIntentFailed
} from '../services/action_dispatcher.js';

export interface RunActionDispatcherOptions {
  context: AppContext;
  limit?: number;
}

export const runActionDispatcher = async ({
  context,
  limit = 5
}: RunActionDispatcherOptions): Promise<number> => {
  const intents = await listDispatchableActionIntents(context, limit);
  let dispatchedCount = 0;

  for (const intent of intents) {
    await markActionIntentDispatching(context, intent.id);
    try {
      const result = await dispatchActionIntent(context, intent);
      if (result.outcome === 'dropped') {
        await markActionIntentDropped(context, intent.id, result.reason);
        continue;
      }

      await markActionIntentCompleted(context, intent.id);
      dispatchedCount += 1;
    } catch (err) {
      const errorCode = err instanceof Error && 'code' in err && typeof err.code === 'string'
        ? err.code
        : 'ACTION_DISPATCH_FAIL';
      await markActionIntentFailed(
        context,
        intent.id,
        err instanceof Error ? err.message : String(err),
        errorCode
      );
    }
  }

  return dispatchedCount;
};
