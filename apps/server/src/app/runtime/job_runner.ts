import type { InferenceService } from '../../inference/service.js';
import type { AppContext } from '../context.js';
import { listRunnableDecisionJobs } from '../services/inference_workflow.js';

export interface RunDecisionJobRunnerOptions {
  context: AppContext;
  inferenceService: InferenceService;
  limit?: number;
}

export const runDecisionJobRunner = async ({
  context,
  inferenceService,
  limit = 5
}: RunDecisionJobRunnerOptions): Promise<number> => {
  const jobs = await listRunnableDecisionJobs(context, limit);
  let executedCount = 0;

  for (const job of jobs) {
    try {
      const result = await inferenceService.executeDecisionJob(job.id);
      if (result) {
        executedCount += 1;
      }
    } catch {
      continue;
    }
  }

  return executedCount;
};
