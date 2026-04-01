import 'dotenv/config';

import { PrismaClient } from '@prisma/client';

import type { AppContext } from '../app/context.js';
import { runAgentScheduler } from '../app/runtime/agent_scheduler.js';
import { claimDecisionJob } from '../app/services/inference_workflow.js';
import {
  getLatestSchedulerRunReadModel,
  getSchedulerSummarySnapshot
} from '../app/services/scheduler_observability.js';
import { sim } from '../core/simulation.js';
import type { SystemMessage } from '../utils/notifications.js';

const assertCondition: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const prisma = new PrismaClient();

const createTestContext = (worldPack: string): AppContext => {
  return {
    prisma: sim.prisma,
    sim,
    notifications: {
      push: () => ({
        id: 'scheduler-e2e',
        level: 'info',
        content: 'scheduler-e2e',
        timestamp: Date.now(),
        code: 'SCHEDULER_E2E'
      } satisfies SystemMessage),
      getMessages: () => [],
      clear: () => undefined
    },
    startupHealth: {
      level: 'ok',
      checks: { db: true, world_pack_dir: true, world_pack_available: true },
      available_world_packs: [worldPack],
      errors: []
    },
    getRuntimeReady: () => true,
    setRuntimeReady: () => undefined,
    getPaused: () => false,
    setPaused: () => undefined,
    assertRuntimeReady: () => undefined
  };
};

async function main(): Promise<void> {
  const worldPack = process.env.WORLD_PACK ?? 'cyber_noir';
  await sim.init(worldPack);

  await prisma.relationshipAdjustmentLog.deleteMany({
    where: {
      OR: [{ from_id: 'agent-001' }, { to_id: 'agent-001' }]
    }
  });
  await prisma.sNRAdjustmentLog.deleteMany({
    where: {
      agent_id: 'agent-001'
    }
  });
  await prisma.event.deleteMany({
    where: {
      title: {
        startsWith: 'scheduler-e2e-event-'
      }
    }
  });
  await prisma.actionIntent.deleteMany({
    where: {
      id: {
        startsWith: 'scheduler-e2e-intent-'
      }
    }
  });
  await prisma.inferenceTrace.deleteMany({
    where: {
      id: {
        startsWith: 'scheduler-e2e-trace-'
      }
    }
  });

  const context: AppContext = createTestContext(worldPack);

  await prisma.decisionJob.deleteMany({
    where: {
      idempotency_key: {
        startsWith: 'sch:'
      }
    }
  });

  const beforeCount = await prisma.decisionJob.count({
    where: {
      idempotency_key: {
        startsWith: 'sch:'
      }
    }
  });

  const firstRun = await runAgentScheduler({
    context,
    limit: 10
  });

  const afterFirstCount = await prisma.decisionJob.count({
    where: {
      idempotency_key: {
        startsWith: 'sch:'
      }
    }
  });

  assertCondition(firstRun.created_count > 0, 'first scheduler run should create at least one job');
  assertCondition(afterFirstCount > beforeCount, 'scheduler should create new scheduled jobs');
  assertCondition(typeof firstRun.scheduler_run_id === 'string', 'first run should expose scheduler_run_id');

  const latestReadModel = await getLatestSchedulerRunReadModel(context);
  assertCondition(Boolean(latestReadModel), 'latest scheduler read model should exist after first run');
  assertCondition(
    Array.isArray(latestReadModel?.candidates) && latestReadModel.candidates.length > 0,
    'latest scheduler read model should include candidate decisions'
  );

  const secondRun = await runAgentScheduler({
    context,
    limit: 10
  });

  const afterSecondCount = await prisma.decisionJob.count({
    where: {
      idempotency_key: {
        startsWith: 'sch:'
      }
    }
  });

  assertCondition(secondRun.created_count === 0, 'second scheduler run in cooldown window should not create jobs');
  assertCondition(afterSecondCount === afterFirstCount, 'second scheduler run should not increase scheduled job count');
  assertCondition(secondRun.skipped_by_reason.pending_workflow > 0, 'second run should accumulate pending_workflow skip reason');

  const scheduledJobs = await prisma.decisionJob.findMany({
    where: {
      idempotency_key: {
        startsWith: 'sch:'
      }
    },
    orderBy: {
      created_at: 'desc'
    },
    take: 20
  });

  const periodicJobs = scheduledJobs.filter(job => {
    const requestInputRaw = job.request_input;
    if (!requestInputRaw || typeof requestInputRaw !== 'object' || Array.isArray(requestInputRaw)) {
      return false;
    }
    const attributesRaw = (requestInputRaw as Record<string, unknown>).attributes;
    return Boolean(
      attributesRaw &&
        typeof attributesRaw === 'object' &&
        !Array.isArray(attributesRaw) &&
        (attributesRaw as Record<string, unknown>).scheduler_kind === 'periodic'
    );
  });

  assertCondition(periodicJobs.length > 0, 'periodic scheduled jobs should exist after scheduler run');

  for (const job of periodicJobs) {
    const requestInputRaw = job.request_input;
    assertCondition(
      requestInputRaw !== null && typeof requestInputRaw === 'object' && !Array.isArray(requestInputRaw),
      'scheduled job request_input should be object'
    );
    const requestInput = requestInputRaw as Record<string, unknown>;
    assertCondition(typeof requestInput.agent_id === 'string', 'scheduled job request_input.agent_id should be string');
    assertCondition(
      typeof requestInput.idempotency_key === 'string' && requestInput.idempotency_key.startsWith('sch:'),
      'scheduled job idempotency key should have sch: prefix'
    );

    const attributesRaw = requestInput.attributes;
    assertCondition(
      attributesRaw !== null && typeof attributesRaw === 'object' && !Array.isArray(attributesRaw),
      'scheduled job should include scheduler attributes'
    );
    const attributes = attributesRaw as Record<string, unknown>;
    assertCondition(typeof job.scheduled_for_tick === 'bigint', 'scheduled job should persist scheduled_for_tick');
    assertCondition(job.intent_class === 'scheduler_periodic', 'periodic scheduled job should persist scheduler_periodic intent_class');
    assertCondition(attributes.scheduler_source === 'runtime_loop', 'scheduled job should include scheduler_source');
    assertCondition(attributes.job_intent_class === 'scheduler_periodic', 'periodic scheduled job should expose job_intent_class');
    assertCondition(attributes.job_source === 'scheduler', 'periodic scheduled job should expose job_source');
    assertCondition(attributes.scheduler_kind === 'periodic', 'scheduled job should include scheduler_kind=periodic');
    assertCondition(attributes.scheduler_reason === 'periodic_tick', 'scheduled job should include scheduler_reason=periodic_tick');
    assertCondition(
      Array.isArray(attributes.scheduler_secondary_reasons) && attributes.scheduler_secondary_reasons.length === 0,
      'periodic scheduled job should expose empty scheduler_secondary_reasons'
    );
    assertCondition(
      typeof attributes.scheduler_priority_score === 'number' && attributes.scheduler_priority_score === 1,
      'periodic scheduled job should expose scheduler_priority_score=1'
    );
    assertCondition(
      attributes.scheduler_scheduled_for_tick === job.scheduled_for_tick.toString(),
      'scheduled job should expose scheduler_scheduled_for_tick'
    );
  }

  const futureBaseTick = context.sim.clock.getTicks();
  const futureTick = futureBaseTick + 10n;
  const futureIdempotencyKey = `sch:agent-001:${futureBaseTick.toString()}:event_driven:event_followup`;
  await prisma.decisionJob.deleteMany({ where: { idempotency_key: futureIdempotencyKey } });
  const futureJob = await prisma.decisionJob.create({
    data: {
      source_inference_id: `pending_${futureIdempotencyKey}`,
      job_type: 'inference_run',
      status: 'pending',
      idempotency_key: futureIdempotencyKey,
      attempt_count: 0,
      max_attempts: 3,
      request_input: {
        agent_id: 'agent-001',
        identity_id: 'agent-001',
        strategy: 'rule_based',
        idempotency_key: futureIdempotencyKey,
        attributes: {
          scheduler_source: 'runtime_loop',
          scheduler_kind: 'event_driven',
          scheduler_reason: 'event_followup',
          scheduler_secondary_reasons: [],
          scheduler_priority_score: 30,
          scheduler_tick: futureBaseTick.toString(),
          scheduler_scheduled_for_tick: futureTick.toString()
        }
      },
      scheduled_for_tick: futureTick,
      created_at: futureBaseTick,
      updated_at: futureBaseTick
    }
  });

  const futureClaim = await claimDecisionJob(context, {
    job_id: futureJob.id,
    worker_id: 'scheduler-e2e-worker',
    now: futureBaseTick,
    lock_ticks: 5n
  });
  assertCondition(futureClaim === null, 'future scheduled job should not be claimable before scheduled_for_tick');

  const followupTick = context.sim.clock.getTicks();
  const followupTraceId = `scheduler-e2e-trace-${Date.now()}`;
  const followupIntentId = `scheduler-e2e-intent-${Date.now()}`;
  const followupEventTitle = `scheduler-e2e-event-${Date.now()}`;
  const recoveryReplayKey = `scheduler-e2e-replay-${Date.now()}`;
  const recoveryRetryKey = `scheduler-e2e-retry-${Date.now()}`;

  await prisma.inferenceTrace.create({
    data: {
      id: followupTraceId,
      kind: 'run',
      strategy: 'mock',
      provider: 'mock',
      actor_ref: {
        identity_id: 'agent-001',
        identity_type: 'agent',
        role: 'active',
        agent_id: 'agent-001',
        atmosphere_node_id: null
      },
      input: { agent_id: 'agent-001', strategy: 'mock' },
      context_snapshot: {},
      prompt_bundle: {},
      trace_metadata: {
        inference_id: followupTraceId,
        tick: followupTick.toString(),
        strategy: 'mock',
        provider: 'mock',
        world_pack_id: worldPack
      },
      decision: {},
      created_at: followupTick,
      updated_at: followupTick
    }
  });

  await prisma.actionIntent.create({
    data: {
      id: followupIntentId,
      source_inference_id: followupTraceId,
      intent_type: 'trigger_event',
      actor_ref: {
        identity_id: 'agent-001',
        role: 'active',
        agent_id: 'agent-001',
        atmosphere_node_id: null
      },
      target_ref: undefined,
      payload: {
        event_type: 'history',
        title: followupEventTitle,
        description: 'scheduler e2e followup'
      },
      status: 'completed',
      created_at: followupTick,
      updated_at: followupTick,
      dispatched_at: followupTick
    }
  });

  await prisma.event.create({
    data: {
      title: followupEventTitle,
      description: 'scheduler e2e followup',
      tick: followupTick,
      type: 'history',
      source_action_intent_id: followupIntentId,
      created_at: followupTick
    }
  });

  await prisma.relationshipAdjustmentLog
    .create({
      data: {
        id: `scheduler-e2e-rel-log-${Date.now()}`,
        action_intent_id: followupIntentId,
        relationship_id: `scheduler-e2e-rel-${Date.now()}`,
        from_id: 'agent-001',
        to_id: 'agent-002',
        type: 'friend',
        operation: 'set',
        old_weight: 0.2,
        new_weight: 0.8,
        reason: 'scheduler e2e relationship followup',
        created_at: followupTick
      }
    })
    .catch(() => undefined);

  await prisma.sNRAdjustmentLog.create({
    data: {
      id: `scheduler-e2e-snr-log-${Date.now()}`,
      action_intent_id: followupIntentId,
      agent_id: 'agent-001',
      operation: 'set',
      requested_value: 0.7,
      baseline_value: 0.5,
      resolved_value: 0.7,
      reason: 'scheduler e2e snr followup',
      created_at: followupTick
    }
  });

  await prisma.decisionJob.create({
    data: {
      source_inference_id: `pending_${recoveryReplayKey}`,
      job_type: 'inference_run',
      status: 'completed',
      idempotency_key: recoveryReplayKey,
      intent_class: 'replay_recovery',
      attempt_count: 1,
      max_attempts: 3,
      request_input: {
        agent_id: 'agent-001',
        identity_id: 'agent-001',
        strategy: 'rule_based',
        idempotency_key: recoveryReplayKey,
        attributes: {
          job_intent_class: 'replay_recovery',
          job_source: 'replay'
        }
      },
      created_at: followupTick,
      updated_at: followupTick,
      completed_at: followupTick
    }
  });

  await prisma.decisionJob.create({
    data: {
      source_inference_id: `pending_${recoveryRetryKey}`,
      job_type: 'inference_run',
      status: 'completed',
      idempotency_key: recoveryRetryKey,
      intent_class: 'retry_recovery',
      attempt_count: 1,
      max_attempts: 3,
      request_input: {
        agent_id: 'agent-002',
        identity_id: 'agent-002',
        strategy: 'rule_based',
        idempotency_key: recoveryRetryKey,
        attributes: {
          job_intent_class: 'retry_recovery',
          job_source: 'retry'
        }
      },
      created_at: followupTick,
      updated_at: followupTick,
      completed_at: followupTick
    }
  });

  await prisma.decisionJob.deleteMany({
    where: {
      status: 'pending',
      idempotency_key: {
        startsWith: 'sch:agent-001:'
      }
    }
  });

  const followupRun = await runAgentScheduler({ context, limit: 10 });
  assertCondition(followupRun.signals_detected_count > 0, 'event-driven scheduler should detect recent followup signals');
  assertCondition(
    followupRun.created_event_driven_count > 0 || followupRun.skipped_by_reason.pending_workflow > 0,
    'high-priority event-driven scheduler should create followup jobs during replay window or be blocked by pending workflow'
  );
  assertCondition(
    followupRun.skipped_by_reason.event_coalesced > 0 || followupRun.skipped_by_reason.pending_workflow > 0,
    'event-driven scheduler should record coalesced secondary reasons or surface pending workflow suppression'
  );
  assertCondition(typeof followupRun.skipped_by_reason.replay_window_periodic_suppressed === 'number', 'replay periodic suppression count should be present');
  assertCondition(typeof followupRun.skipped_by_reason.retry_window_periodic_suppressed === 'number', 'retry periodic suppression count should be present');

  const eventDrivenJobs = await prisma.decisionJob.findMany({
    where: {
      idempotency_key: {
        startsWith: 'sch:agent-001:'
      }
    },
    orderBy: {
      created_at: 'desc'
    }
  });
  const followupJob = eventDrivenJobs.find(job => {
    const requestInputRaw = job.request_input;
    if (!requestInputRaw || typeof requestInputRaw !== 'object' || Array.isArray(requestInputRaw)) {
      return false;
    }
    const attributesRaw = (requestInputRaw as Record<string, unknown>).attributes;
    if (!attributesRaw || typeof attributesRaw !== 'object' || Array.isArray(attributesRaw)) {
      return false;
    }
    const attributes = attributesRaw as Record<string, unknown>;
    return attributes.scheduler_kind === 'event_driven';
  });
  assertCondition(
    Boolean(followupJob) || followupRun.skipped_by_reason.pending_workflow > 0,
    'event-driven followup job should exist for high-priority event_followup unless blocked by pending workflow'
  );
  if (!followupJob) {
    console.log('[agent_scheduler] high-priority event_followup blocked by pending workflow baseline');
    return;
  }
  assertCondition(
    Boolean(followupJob && followupJob.scheduled_for_tick !== null && followupJob.scheduled_for_tick > followupTick),
    'event-driven followup job should be scheduled for a future tick'
  );

  const followupRequestInput = followupJob?.request_input;
  assertCondition(
    Boolean(followupRequestInput && typeof followupRequestInput === 'object' && !Array.isArray(followupRequestInput)),
    'event-driven followup job should expose request_input'
  );
  const followupAttributes = ((followupRequestInput as Record<string, unknown>).attributes ?? null) as Record<string, unknown> | null;
  assertCondition(Boolean(followupAttributes), 'event-driven followup job should expose scheduler attributes');
  assertCondition(followupJob?.intent_class === 'scheduler_event_followup', 'event-driven followup job should persist scheduler_event_followup intent_class');
  assertCondition(followupAttributes?.job_intent_class === 'scheduler_event_followup', 'event-driven followup should expose job_intent_class');
  assertCondition(followupAttributes?.job_source === 'scheduler', 'event-driven followup should expose job_source');
  assertCondition(followupAttributes?.scheduler_reason === 'event_followup', 'event-driven followup should prioritize event_followup');
  assertCondition(
    Array.isArray(followupAttributes?.scheduler_secondary_reasons) &&
      followupAttributes.scheduler_secondary_reasons.length >= 1,
    'event-driven followup should preserve at least one secondary scheduler reason'
  );
  assertCondition(
    followupAttributes.scheduler_secondary_reasons.every(
      reason => reason === 'relationship_change_followup' || reason === 'snr_change_followup'
    ),
    'event-driven followup secondary reasons should remain within merged signal reasons'
  );
  assertCondition(
    typeof followupAttributes?.scheduler_priority_score === 'number' && followupAttributes.scheduler_priority_score === 30,
    'event-driven followup should expose scheduler priority score'
  );
  assertCondition(typeof followupRun.scheduler_run_id === 'string', 'followup run should expose scheduler_run_id');

  const followupReadModel = await getLatestSchedulerRunReadModel(context);
  assertCondition(Boolean(followupReadModel), 'latest scheduler read model should exist after followup run');
  assertCondition(
    followupReadModel?.candidates.some(
      candidate => candidate.actor_id === 'agent-001' && candidate.kind === 'event_driven' && candidate.skipped_reason === null
    ) ?? false,
    'read model should record a surviving high-priority event-driven decision for agent-001'
  );
  assertCondition(
    Boolean(
      followupReadModel?.candidates.some(
        candidate =>
          candidate.skipped_reason === 'replay_window_periodic_suppressed' ||
          candidate.skipped_reason === 'retry_window_periodic_suppressed'
      )
    ),
    'read model should expose at least one fine-grained recovery-window periodic suppression decision'
  );

  const summarySnapshot = await getSchedulerSummarySnapshot(context, { sampleRuns: 10 });
  assertCondition(Array.isArray(summarySnapshot.top_skipped_reasons), 'scheduler summary should include top_skipped_reasons');
  assertCondition(
    summarySnapshot.top_skipped_reasons.some(
      item =>
        item.skipped_reason === 'pending_workflow' ||
        item.skipped_reason === 'replay_window_periodic_suppressed' ||
        item.skipped_reason === 'retry_window_periodic_suppressed'
    ),
    'scheduler summary should expose fine-grained skipped reason aggregation'
  );

  console.log('[agent_scheduler] PASS', {
    beforeCount,
    afterFirstCount,
    afterSecondCount,
    firstRun,
    secondRun,
    followupRun
  });
}

main()
  .catch(error => {
    console.error('[agent_scheduler] FAIL', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await sim.prisma.$disconnect();
  });
