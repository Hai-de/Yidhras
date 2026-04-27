import { getSchedulerRunnerConfig } from '../../config/runtime_config.js';
import type { InferenceService } from '../../inference/service.js';
import { createLogger } from '../../utils/logger.js';
import type { AppContext } from '../context.js';
import {
  claimDecisionJob,
  listRunnableDecisionJobs,
  updateDecisionJobState
} from '../services/inference_workflow.js';
import { hasActiveWorkflowForActor } from './entity_activity_query.js';
import { runWithConcurrency } from './runner_concurrency.js';

const logger = createLogger('job-runner');

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
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`决策作业执行失败 job_id=${job.id}: ${message}`);
      context.notifications.push(
        'warning',
        `决策作业执行失败: ${message}`,
        'DECISION_JOB_EXEC_FAIL',
        { job_id: job.id, error: message }
      );

      try {
        await updateDecisionJobState(context, {
          job_id: job.id,
          status: 'failed',
          last_error: message,
          last_error_code: 'DECISION_JOB_EXEC_FAIL',
          last_error_stage: 'job_runner',
          increment_attempt: false,
          locked_by: null,
          locked_at: null,
          lock_expires_at: null
        });
      } catch (auditErr) {
        logger.error(`无法写入作业失败审计记录 job_id=${job.id}`, { error: auditErr instanceof Error ? auditErr.message : String(auditErr) });
      }

      return 0;
    }
  });

  return results.reduce<number>((sum, value) => sum + value, 0);
};
