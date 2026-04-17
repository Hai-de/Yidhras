import { getSchedulerRunnerConfig } from '../../config/runtime_config.js';
import { createMemoryCompactionService } from '../../memory/recording/compaction_service.js';
import { createMemoryRecordingService } from '../../memory/recording/service.js';
import type { AppContext } from '../context.js';
import {
  assertActionIntentLockOwnership,
  claimActionIntent,
  dispatchActionIntent,
  getActionIntentForDispatchReflection,
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
  limit = getSchedulerRunnerConfig().action_dispatcher.batch_limit,
  lockTicks = BigInt(getSchedulerRunnerConfig().action_dispatcher.lock_ticks)
}: RunActionDispatcherOptions): Promise<number> => {
  const intents = await listDispatchableActionIntents(context, limit);
  let dispatchedCount = 0;
  const memoryCompactionService = createMemoryCompactionService({ context });
  const memoryRecordingService = createMemoryRecordingService({ context });

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
      if (claimedIntent.intent_type === 'trigger_event') {
        const latestIntent = await getActionIntentForDispatchReflection(context, claimedIntent.id);
        const latestEvent = latestIntent?.event_summaries[0]?.title ?? null;
        if (latestIntent?.semantic_intent_kind === 'record_private_reflection') {
          await memoryRecordingService.recordPrivateReflection({
            actor_id: latestIntent.actor_agent_id,
            pack_id: context.sim.getActivePack()?.metadata.id ?? 'unknown-pack',
            tick: context.sim.getCurrentTick().toString(),
            source_inference_id: latestIntent.source_inference_id,
            reasoning: latestEvent,
            semantic_intent_kind: latestIntent.semantic_intent_kind,
            tags: ['semantic_record']
          });
        }
        if (latestIntent?.semantic_intent_kind === 'update_target_dossier') {
          await memoryRecordingService.updateTargetDossier({
            actor_id: latestIntent.actor_agent_id,
            pack_id: context.sim.getActivePack()?.metadata.id ?? 'unknown-pack',
            tick: context.sim.getCurrentTick().toString(),
            source_inference_id: latestIntent.source_inference_id,
            reasoning: latestEvent,
            semantic_intent_kind: latestIntent.semantic_intent_kind,
            target_ref: latestIntent.target_ref,
            tags: ['semantic_record']
          });
        }
        if (latestIntent?.semantic_intent_kind === 'record_execution_postmortem') {
          await memoryRecordingService.recordExecutionReflection({
            actor_id: latestIntent.actor_agent_id,
            pack_id: context.sim.getActivePack()?.metadata.id ?? 'unknown-pack',
            tick: context.sim.getCurrentTick().toString(),
            source_inference_id: latestIntent.source_inference_id,
            source_action_intent_id: latestIntent.id,
            intent_type: 'record_execution_postmortem',
            outcome: 'completed',
            reason: latestEvent,
            semantic_intent_kind: latestIntent.semantic_intent_kind,
            target_ref: latestIntent.target_ref,
            event_summaries: latestIntent.event_summaries
          });
        }
      }
      if (result.outcome === 'dropped') {
        await markActionIntentDropped(context, claimedIntent.id, result.reason);
        const latestIntent = await getActionIntentForDispatchReflection(context, claimedIntent.id);
        if (latestIntent) {
          await memoryRecordingService.recordExecutionReflection({
            actor_id: latestIntent.actor_agent_id,
            pack_id: context.sim.getActivePack()?.metadata.id ?? 'unknown-pack',
            tick: context.sim.getCurrentTick().toString(),
            source_inference_id: latestIntent.source_inference_id,
            source_action_intent_id: latestIntent.id,
            intent_type: latestIntent.intent_type,
            outcome: 'dropped',
            reason: result.reason,
            target_ref: latestIntent.target_ref,
            semantic_intent_kind: latestIntent.semantic_intent_kind,
            event_summaries: []
          });
          await memoryCompactionService.runForAgent({ agent_id: latestIntent.actor_agent_id });
        }
        continue;
      }

      await markActionIntentCompleted(context, claimedIntent.id);
      const latestIntent = await getActionIntentForDispatchReflection(context, claimedIntent.id);
      if (latestIntent) {
        await memoryRecordingService.recordExecutionReflection({
          actor_id: latestIntent.actor_agent_id,
          pack_id: context.sim.getActivePack()?.metadata.id ?? 'unknown-pack',
          tick: context.sim.getCurrentTick().toString(),
          source_inference_id: latestIntent.source_inference_id,
          source_action_intent_id: latestIntent.id,
          intent_type: latestIntent.intent_type,
          outcome: 'completed',
          target_ref: latestIntent.target_ref,
          semantic_intent_kind: latestIntent.semantic_intent_kind,
          event_summaries: latestIntent.event_summaries
        });
        await memoryCompactionService.runForAgent({ agent_id: latestIntent.actor_agent_id });
      }
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
      const latestIntent = await getActionIntentForDispatchReflection(context, claimedIntent.id);
      if (latestIntent) {
        await memoryRecordingService.recordExecutionReflection({
          actor_id: latestIntent.actor_agent_id,
          pack_id: context.sim.getActivePack()?.metadata.id ?? 'unknown-pack',
          tick: context.sim.getCurrentTick().toString(),
          source_inference_id: latestIntent.source_inference_id,
          source_action_intent_id: latestIntent.id,
          intent_type: latestIntent.intent_type,
          outcome: 'failed',
          reason: err instanceof Error ? err.message : String(err),
          target_ref: latestIntent.target_ref,
          semantic_intent_kind: latestIntent.semantic_intent_kind,
          event_summaries: latestIntent.event_summaries
        });
        await memoryCompactionService.runForAgent({ agent_id: latestIntent.actor_agent_id });
      }
    }
  }

  return dispatchedCount;
};
