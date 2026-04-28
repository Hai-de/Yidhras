import { z } from 'zod';

const PositiveIntSchema = z.number().int().positive();
const NonNegativeIntSchema = z.number().int().min(0);

const SchedulerSignalPolicySchema = z
  .object({
    priority_score: z.number().int().nonnegative(),
    delay_ticks: PositiveIntSchema,
    coalesce_window_ticks: PositiveIntSchema,
    suppression_tier: z.enum(['high', 'low'])
  })
  .strict();

const SidecarRuntimeSchema = z
  .object({
    mode: z.enum(['rust_primary']),
    timeout_ms: PositiveIntSchema,
    binary_path: z.string().trim().min(1),
    auto_restart: z.boolean()
  })
  .strict();

const SchedulerEntityConcurrencySchema = z
  .object({
    default_max_active_workflows_per_entity: PositiveIntSchema,
    max_entity_activations_per_tick: PositiveIntSchema,
    allow_parallel_decision_per_entity: z.boolean(),
    allow_parallel_action_per_entity: z.boolean(),
    event_followup_preempts_periodic: z.boolean()
  })
  .strict();

const SchedulerTickBudgetSchema = z
  .object({
    max_created_jobs_per_tick: PositiveIntSchema,
    max_executed_decisions_per_tick: PositiveIntSchema,
    max_dispatched_actions_per_tick: PositiveIntSchema
  })
  .strict();

const SchedulerRunnerDefaultsSchema = z
  .object({
    batch_limit: PositiveIntSchema,
    concurrency: PositiveIntSchema,
    lock_ticks: PositiveIntSchema
  })
  .strict();

const SchedulerObservabilitySummarySchema = z
  .object({
    default_sample_runs: PositiveIntSchema,
    max_sample_runs: PositiveIntSchema
  })
  .strict();

const SchedulerObservabilityOperatorProjectionSchema = z
  .object({
    default_sample_runs: PositiveIntSchema,
    max_sample_runs: PositiveIntSchema,
    default_recent_limit: PositiveIntSchema,
    max_recent_limit: PositiveIntSchema
  })
  .strict();

const SchedulerRecoverySuppressionSchema = z
  .object({
    suppress_periodic: z.boolean(),
    suppress_event_tiers: z.array(z.enum(['high', 'low']))
  })
  .strict();

export const SchedulerConfigSchema = z
  .object({
    enabled: z.boolean(),
    runtime: z
      .object({
        simulation_loop_interval_ms: PositiveIntSchema
      })
      .strict(),
    lease_ticks: PositiveIntSchema,
    entity_concurrency: SchedulerEntityConcurrencySchema,
    tick_budget: SchedulerTickBudgetSchema,
    automatic_rebalance: z
      .object({
        backlog_limit: NonNegativeIntSchema,
        max_recommendations: PositiveIntSchema,
        max_apply: PositiveIntSchema
      })
      .strict(),
    runners: z
      .object({
        decision_job: SchedulerRunnerDefaultsSchema,
        action_dispatcher: SchedulerRunnerDefaultsSchema
      })
      .strict(),
    observability: z
      .object({
        default_query_limit: PositiveIntSchema,
        max_query_limit: PositiveIntSchema,
        summary: SchedulerObservabilitySummarySchema,
        trends: SchedulerObservabilitySummarySchema,
        operator_projection: SchedulerObservabilityOperatorProjectionSchema
      })
      .strict(),
    agent: z
      .object({
        limit: PositiveIntSchema,
        cooldown_ticks: PositiveIntSchema,
        max_candidates: PositiveIntSchema,
        decision_kernel: SidecarRuntimeSchema,
        signal_policy: z
          .object({
            event_followup: SchedulerSignalPolicySchema,
            relationship_change_followup: SchedulerSignalPolicySchema,
            snr_change_followup: SchedulerSignalPolicySchema,
            overlay_change_followup: SchedulerSignalPolicySchema,
            memory_change_followup: SchedulerSignalPolicySchema
          })
          .strict(),
        recovery_suppression: z
          .object({
            replay: SchedulerRecoverySuppressionSchema,
            retry: SchedulerRecoverySuppressionSchema
          })
          .strict()
      })
      .strict(),
    memory: z
      .object({
        trigger_engine: z
          .object({
            mode: z.enum(['rust_primary']),
            timeout_ms: PositiveIntSchema,
            binary_path: z.string().trim().min(1),
            auto_restart: z.boolean()
          })
          .strict()
      })
      .strict()
  })
  .strict();

export type SchedulerConfig = z.infer<typeof SchedulerConfigSchema>;

export const SCHEDULER_DEFAULTS: SchedulerConfig = {
  enabled: true,
  runtime: {
    simulation_loop_interval_ms: 1000
  },
  lease_ticks: 5,
  entity_concurrency: {
    default_max_active_workflows_per_entity: 1,
    max_entity_activations_per_tick: 1,
    allow_parallel_decision_per_entity: false,
    allow_parallel_action_per_entity: false,
    event_followup_preempts_periodic: true
  },
  tick_budget: {
    max_created_jobs_per_tick: 32,
    max_executed_decisions_per_tick: 16,
    max_dispatched_actions_per_tick: 16
  },
  automatic_rebalance: {
    backlog_limit: 2,
    max_recommendations: 1,
    max_apply: 1
  },
  runners: {
    decision_job: {
      batch_limit: 5,
      concurrency: 2,
      lock_ticks: 5
    },
    action_dispatcher: {
      batch_limit: 5,
      concurrency: 1,
      lock_ticks: 5
    }
  },
  observability: {
    default_query_limit: 20,
    max_query_limit: 100,
    summary: {
      default_sample_runs: 20,
      max_sample_runs: 100
    },
    trends: {
      default_sample_runs: 20,
      max_sample_runs: 100
    },
    operator_projection: {
      default_sample_runs: 20,
      max_sample_runs: 100,
      default_recent_limit: 5,
      max_recent_limit: 20
    }
  },
  agent: {
    limit: 5,
    cooldown_ticks: 3,
    max_candidates: 20,
    decision_kernel: {
      mode: 'rust_primary',
      timeout_ms: 500,
      binary_path:
        'apps/server/rust/scheduler_decision_sidecar/target/debug/scheduler_decision_sidecar',
      auto_restart: true
    },
    signal_policy: {
      event_followup: {
        priority_score: 30,
        delay_ticks: 1,
        coalesce_window_ticks: 2,
        suppression_tier: 'high'
      },
      relationship_change_followup: {
        priority_score: 20,
        delay_ticks: 1,
        coalesce_window_ticks: 2,
        suppression_tier: 'low'
      },
      snr_change_followup: {
        priority_score: 10,
        delay_ticks: 1,
        coalesce_window_ticks: 2,
        suppression_tier: 'low'
      },
      overlay_change_followup: {
        priority_score: 8,
        delay_ticks: 1,
        coalesce_window_ticks: 2,
        suppression_tier: 'low'
      },
      memory_change_followup: {
        priority_score: 9,
        delay_ticks: 1,
        coalesce_window_ticks: 2,
        suppression_tier: 'low'
      }
    },
    recovery_suppression: {
      replay: { suppress_periodic: true, suppress_event_tiers: ['low'] },
      retry: { suppress_periodic: true, suppress_event_tiers: ['low'] }
    }
  },
  memory: {
    trigger_engine: {
      mode: 'rust_primary',
      timeout_ms: 500,
      binary_path:
        'apps/server/rust/memory_trigger_sidecar/target/debug/memory_trigger_sidecar',
      auto_restart: true
    }
  }
};
