import * as contracts from '@yidhras/contracts';
import { describe, expect, it } from 'vitest';

describe('contracts — envelope', () => {
  it('apiSuccessMetaSchema parses valid pagination meta', () => {
    const result = contracts.apiSuccessMetaSchema.safeParse({
      pagination: { has_next_page: true, next_cursor: 'abc' }
    });
    expect(result.success).toBe(true);
  });

  it('apiSuccessMetaSchema accepts meta without pagination', () => {
    const result = contracts.apiSuccessMetaSchema.safeParse({
      warnings: [{ code: 'W1', message: 'test' }],
      schema_version: '1.0'
    });
    expect(result.success).toBe(true);
  });

  it('apiFailureSchema validates a failure response', () => {
    const result = contracts.apiFailureSchema.safeParse({
      success: false,
      error: { code: 'ERR_TEST', message: 'test error', request_id: 'req-001', timestamp: 123456789 }
    });
    expect(result.success).toBe(true);
  });

  it('apiFailureSchema rejects invalid success value', () => {
    const result = contracts.apiFailureSchema.safeParse({
      success: true,
      error: { code: 'X', message: 'x', request_id: 'r', timestamp: 0 }
    });
    expect(result.success).toBe(false);
  });

  it('createApiSuccessSchema wraps a data schema', () => {
    const schema = contracts.createApiSuccessSchema(contracts.inferenceRequestSchema);
    const result = schema.safeParse({
      success: true,
      data: { agent_id: 'agent-001', strategy: 'mock' }
    });
    expect(result.success).toBe(true);
  });

  it('createApiEnvelopeSchema accepts both success and failure', () => {
    const schema = contracts.createApiEnvelopeSchema(contracts.inferenceRequestSchema);
    const successResult = schema.safeParse({ success: true, data: { agent_id: 'agent-001' } });
    const failureResult = schema.safeParse({
      success: false,
      error: { code: 'E', message: 'fail', request_id: 'r', timestamp: 0 }
    });
    expect(successResult.success).toBe(true);
    expect(failureResult.success).toBe(true);
  });
});

describe('contracts — scheduler', () => {
  describe('enum schemas', () => {
    it('schedulerKindSchema accepts periodic and event_driven', () => {
      expect(contracts.schedulerKindSchema.safeParse('periodic').success).toBe(true);
      expect(contracts.schedulerKindSchema.safeParse('event_driven').success).toBe(true);
      expect(contracts.schedulerKindSchema.safeParse('invalid').success).toBe(false);
    });

    it('schedulerReasonSchema accepts defined reasons', () => {
      expect(contracts.schedulerReasonSchema.safeParse('periodic_tick').success).toBe(true);
      expect(contracts.schedulerReasonSchema.safeParse('event_followup').success).toBe(true);
      expect(contracts.schedulerReasonSchema.safeParse('unknown').success).toBe(false);
    });

    it('schedulerSkipReasonSchema accepts all skip reasons', () => {
      expect(contracts.schedulerSkipReasonSchema.safeParse('pending_workflow').success).toBe(true);
      expect(contracts.schedulerSkipReasonSchema.safeParse('replay_window_periodic_suppressed').success).toBe(true);
      expect(contracts.schedulerSkipReasonSchema.safeParse('invalid').success).toBe(false);
    });

    it('schedulerOwnershipStatusSchema accepts defined statuses', () => {
      expect(contracts.schedulerOwnershipStatusSchema.safeParse('assigned').success).toBe(true);
      expect(contracts.schedulerOwnershipStatusSchema.safeParse('unknown').success).toBe(false);
    });

    it('schedulerMigrationStatusSchema accepts defined statuses', () => {
      expect(contracts.schedulerMigrationStatusSchema.safeParse('completed').success).toBe(true);
      expect(contracts.schedulerMigrationStatusSchema.safeParse('failed').success).toBe(true);
      expect(contracts.schedulerMigrationStatusSchema.safeParse('unknown').success).toBe(false);
    });

    it('schedulerWorkerRuntimeStatusSchema accepts valid statuses', () => {
      expect(contracts.schedulerWorkerRuntimeStatusSchema.safeParse('active').success).toBe(true);
      expect(contracts.schedulerWorkerRuntimeStatusSchema.safeParse('suspected_dead').success).toBe(true);
      expect(contracts.schedulerWorkerRuntimeStatusSchema.safeParse('dead').success).toBe(false);
    });
  });

  describe('query schemas', () => {
    it('schedulerRunsQuerySchema accepts valid params', () => {
      const result = contracts.schedulerRunsQuerySchema.safeParse({
        limit: 5, worker_id: 'worker-1', partition_id: 'p-1', from_tick: '100', to_tick: '200'
      });
      expect(result.success).toBe(true);
    });

    it('schedulerRunsQuerySchema accepts empty object', () => {
      expect(contracts.schedulerRunsQuerySchema.safeParse({}).success).toBe(true);
    });

    it('schedulerRunsQuerySchema rejects negative limit', () => {
      expect(contracts.schedulerRunsQuerySchema.safeParse({ limit: -1 }).success).toBe(false);
    });

    it('schedulerSummaryQuerySchema accepts valid sample_runs', () => {
      expect(contracts.schedulerSummaryQuerySchema.safeParse({ sample_runs: 10 }).success).toBe(true);
    });

    it('schedulerDecisionsQuerySchema accepts filters', () => {
      const result = contracts.schedulerDecisionsQuerySchema.safeParse({
        kind: 'periodic', reason: 'periodic_tick', skipped_reason: 'pending_workflow', actor_id: 'agent-001'
      });
      expect(result.success).toBe(true);
    });

    it('schedulerDecisionsQuerySchema rejects unknown kind', () => {
      expect(contracts.schedulerDecisionsQuerySchema.safeParse({ kind: 'unknown' }).success).toBe(false);
    });

    it('schedulerRunIdParamsSchema requires non-empty id', () => {
      expect(contracts.schedulerRunIdParamsSchema.safeParse({ id: 'run-1' }).success).toBe(true);
      expect(contracts.schedulerRunIdParamsSchema.safeParse({ id: '' }).success).toBe(false);
      expect(contracts.schedulerRunIdParamsSchema.safeParse({ id: '  ' }).success).toBe(false);
    });
  });
});

describe('contracts — inference', () => {
  describe('enum schemas', () => {
    it('inferenceStrategySchema accepts mock and rule_based', () => {
      expect(contracts.inferenceStrategySchema.safeParse('mock').success).toBe(true);
      expect(contracts.inferenceStrategySchema.safeParse('rule_based').success).toBe(true);
      expect(contracts.inferenceStrategySchema.safeParse('model_routed').success).toBe(true);
    });

    it('aiInvocationStatusSchema accepts valid statuses', () => {
      expect(contracts.aiInvocationStatusSchema.safeParse('completed').success).toBe(true);
      expect(contracts.aiInvocationStatusSchema.safeParse('failed').success).toBe(true);
      expect(contracts.aiInvocationStatusSchema.safeParse('blocked').success).toBe(true);
      expect(contracts.aiInvocationStatusSchema.safeParse('timeout').success).toBe(true);
      expect(contracts.aiInvocationStatusSchema.safeParse('unknown').success).toBe(false);
    });
  });

  describe('request schemas', () => {
    it('inferenceRequestSchema accepts minimal and full request', () => {
      expect(contracts.inferenceRequestSchema.safeParse({}).success).toBe(true);
      expect(contracts.inferenceRequestSchema.safeParse({
        agent_id: 'a', identity_id: 'i', strategy: 'mock', attributes: { k: 'v' }, idempotency_key: 'key-001'
      }).success).toBe(true);
    });

    it('inferenceRequestSchema rejects invalid strategy', () => {
      expect(contracts.inferenceRequestSchema.safeParse({ strategy: 'invalid' }).success).toBe(false);
    });

    it('inferenceJobReplayRequestSchema accepts overrides', () => {
      expect(contracts.inferenceJobReplayRequestSchema.safeParse({
        reason: 'test replay', overrides: { strategy: 'rule_based' }
      }).success).toBe(true);
    });

    it('inferenceJobIdParamsSchema requires non-empty id', () => {
      expect(contracts.inferenceJobIdParamsSchema.safeParse({ id: 'job-1' }).success).toBe(true);
      expect(contracts.inferenceJobIdParamsSchema.safeParse({ id: '' }).success).toBe(false);
    });

    it('inferenceJobsQuerySchema accepts status array and single status', () => {
      expect(contracts.inferenceJobsQuerySchema.safeParse({ status: ['pending', 'running'] }).success).toBe(true);
      expect(contracts.inferenceJobsQuerySchema.safeParse({ status: 'completed' }).success).toBe(true);
    });

    it('aiInvocationIdParamsSchema requires non-empty id', () => {
      expect(contracts.aiInvocationIdParamsSchema.safeParse({ id: 'ai-1' }).success).toBe(true);
      expect(contracts.aiInvocationIdParamsSchema.safeParse({ id: '' }).success).toBe(false);
    });

    it('aiInvocationsQuerySchema accepts provider and model filters', () => {
      expect(contracts.aiInvocationsQuerySchema.safeParse({
        provider: 'openai', model: 'gpt-4.1-mini', status: 'completed'
      }).success).toBe(true);
    });
  });
});
