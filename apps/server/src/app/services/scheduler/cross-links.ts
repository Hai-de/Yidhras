import type { AppContext } from '../../context.js';
import type { SchedulerDecisionWorkflowLink } from './types.js';

export const buildSchedulerDecisionWorkflowLinks = async (
  context: AppContext,
  decisions: Array<{
    id: string;
    created_job_id: string | null;
  }>
): Promise<Map<string, SchedulerDecisionWorkflowLink>> => {
  const createdJobIds = Array.from(
    new Set(decisions.map(item => item.created_job_id).filter((value): value is string => typeof value === 'string'))
  );
  if (createdJobIds.length === 0) {
    return new Map();
  }

  const jobs = await context.repos.inference.findDecisionJobs({
    where: {
      id: {
        in: createdJobIds
      }
    },
    select: {
      id: true,
      status: true,
      intent_class: true,
      action_intent_id: true,
      source_inference_id: true,
      pending_source_key: true,
      job_type: true,
      attempt_count: true,
      max_attempts: true
    }
  });

  const jobsById = new Map(jobs.map(job => [job.id, job]));

  return new Map(
    decisions.flatMap(decision => {
      if (!decision.created_job_id) {
        return [];
      }
      const job = jobsById.get(decision.created_job_id);
      if (!job) {
        return [];
      }
      return [[
        decision.id,
        {
          job_id: job.id,
          status: job.status,
          intent_class: job.intent_class ?? null,
          workflow_state: job.status,
          action_intent_id: job.action_intent_id ?? null,
          inference_id: job.source_inference_id ?? job.pending_source_key ?? null,
          intent_type: job.job_type ?? null,
          dispatch_stage: job.status === 'completed' ? 'completed' : job.status === 'failed' ? 'dispatch_failed' : 'dispatch_pending',
          failure_stage: job.status === 'failed' ? 'decision_failed' : null,
          failure_code: job.status === 'failed' ? 'WORKFLOW_JOB_FAILED' : null,
          outcome_summary_excerpt: { attempt_count: job.attempt_count, max_attempts: job.max_attempts },
          audit_entry: { kind: 'workflow', id: job.id, summary: `${job.job_type} -> ${job.status}` }
        } satisfies SchedulerDecisionWorkflowLink
      ]];
    })
  );
};
