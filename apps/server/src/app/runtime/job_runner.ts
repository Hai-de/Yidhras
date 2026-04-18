import { getSchedulerRunnerConfig } from '../../config/runtime_config.js';
import type { InferenceService } from '../../inference/service.js';
import type { AppContext } from '../context.js';
import {
  claimDecisionJob,
  listRunnableDecisionJobs
} from '../services/inference_workflow.js';
import { hasActiveWorkflowForActor } from './entity_activity_query.js';
import { runWithConcurrency } from './runner_concurrency.js';

export interface RunDecisionJobRunnerOptions {
  context: AppContext;
  inferenceService: InferenceService;
  workerId: string;
  limit?: number;
  concurrency?: number;
  lockTicks?: bigint;
}

export const runDecisionJobRunner = async ({
  context,
  inferenceService,
  workerId,
  limit = getSchedulerRunnerConfig().decision_job.batch_limit,
  concurrency = getSchedulerRunnerConfig().decision_job.concurrency,
  lockTicks = BigInt(getSchedulerRunnerConfig().decision_job.lock_ticks)
}: RunDecisionJobRunnerOptions): Promise<number> => {
  const jobs = await listRunnableDecisionJobs(context, limit);

  const results = await runWithConcurrency(jobs, concurrency, async job => {
    try {
      const claimedJob = await claimDecisionJob(context, {
        job_id: job.id,
        worker_id: workerId,
        lock_ticks: lockTicks
      });
      if (!claimedJob) {
        return 0;
      }

      const requestInput = typeof claimedJob.request_input === 'object' && claimedJob.request_input !== null ? claimedJob.request_input : null;
      const actorId = requestInput && 'agent_id' in requestInput && typeof requestInput.agent_id === 'string'
        ? requestInput.agent_id
        : null;
      if (actorId) {
        const hasOtherActiveWorkflow = await hasActiveWorkflowForActor(context, actorId, {
          excludeDecisionJobIds: [claimedJob.id]
        });
        if (hasOtherActiveWorkflow) {
          return 0;
        }
      }

      const result = await inferenceService.executeDecisionJob(claimedJob.id, { workerId });
      return result ? 1 : 0;
    } catch {
      return 0;
    }
  });

  return results.reduce<number>((sum, value) => sum + value, 0);
};
