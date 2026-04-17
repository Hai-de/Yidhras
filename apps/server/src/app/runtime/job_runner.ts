import { getSchedulerRunnerConfig } from '../../config/runtime_config.js';
import type { InferenceService } from '../../inference/service.js';
import type { AppContext } from '../context.js';
import {
  claimDecisionJob,
  listRunnableDecisionJobs
} from '../services/inference_workflow.js';

export interface RunDecisionJobRunnerOptions {
  context: AppContext;
  inferenceService: InferenceService;
  workerId: string;
  limit?: number;
  lockTicks?: bigint;
}

export const runDecisionJobRunner = async ({
  context,
  inferenceService,
  workerId,
  limit = getSchedulerRunnerConfig().decision_job.batch_limit,
  lockTicks = BigInt(getSchedulerRunnerConfig().decision_job.lock_ticks)
}: RunDecisionJobRunnerOptions): Promise<number> => {
  const jobs = await listRunnableDecisionJobs(context, limit);
  let executedCount = 0;

  for (const job of jobs) {
    try {
      const claimedJob = await claimDecisionJob(context, {
        job_id: job.id,
        worker_id: workerId,
        lock_ticks: lockTicks
      });
      if (!claimedJob) {
        continue;
      }

      const result = await inferenceService.executeDecisionJob(claimedJob.id, { workerId });
      if (result) {
        executedCount += 1;
      }
    } catch {
      continue;
    }
  }

  return executedCount;
};
