import { z } from 'zod';

const NonEmptyStringSchema = z.string().trim().min(1);

const AiModelsConfigPathSchema = z
  .string()
  .trim()
  .min(1)
  .default('apps/server/config/ai_models.yaml');

const PositiveIntSchema = z.number().int().positive();
const NonNegativeIntSchema = z.number().int().min(0);
const SqliteSynchronousSchema = z.enum(['OFF', 'NORMAL', 'FULL', 'EXTRA']);

const MultiPackRuntimeStartModeSchema = z.enum(['manual', 'bootstrap_list']);

const ExperimentalMultiPackRuntimeSchema = z
  .object({
    enabled: z.boolean(),
    operator_api_enabled: z.boolean(),
    ui_enabled: z.boolean()
  })
  .strict();

const RuntimeMultiPackSchema = z
  .object({
    max_loaded_packs: PositiveIntSchema,
    start_mode: MultiPackRuntimeStartModeSchema,
    bootstrap_packs: z.array(NonEmptyStringSchema)
  })
  .strict();

const PromptWorkflowProfileDefaultsSchema = z
  .object({
    token_budget: PositiveIntSchema,
    section_policy: z.enum(['minimal', 'standard', 'expanded', 'include_only'])
  })
  .strict();

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
    mode: z.enum(['ts', 'rust_shadow', 'rust_primary']),
    timeout_ms: PositiveIntSchema,
    binary_path: NonEmptyStringSchema,
    auto_restart: z.boolean()
  })
  .strict();

const SchedulerDecisionKernelRuntimeSchema = SidecarRuntimeSchema;

const WorldEngineRuntimeSchema = z
  .object({
    timeout_ms: PositiveIntSchema,
    binary_path: NonEmptyStringSchema,
    auto_restart: z.boolean()
  })
  .strict();

const MemoryTriggerEngineRuntimeSchema = z
  .object({
    mode: z.enum(['ts', 'rust_shadow', 'rust_primary']),
    timeout_ms: PositiveIntSchema,
    binary_path: NonEmptyStringSchema,
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

const SchedulerObservabilitySchema = z
  .object({
    default_query_limit: PositiveIntSchema,
    max_query_limit: PositiveIntSchema,
    summary: SchedulerObservabilitySummarySchema,
    trends: SchedulerObservabilitySummarySchema,
    operator_projection: SchedulerObservabilityOperatorProjectionSchema
  })
  .strict();

const SchedulerRecoverySuppressionSchema = z
  .object({
    suppress_periodic: z.boolean(),
    suppress_event_tiers: z.array(z.enum(['high', 'low']))
  })
  .strict();

export const RuntimeConfigSchema = z
  .object({
    config_version: z.number().int().positive(),
    app: z
      .object({
        name: NonEmptyStringSchema,
        env: NonEmptyStringSchema,
        port: z.number().int().min(1).max(65535)
      })
      .strict(),
    paths: z
      .object({
        world_packs_dir: NonEmptyStringSchema,
        assets_dir: NonEmptyStringSchema,
        plugins_dir: NonEmptyStringSchema,
        ai_models_config: AiModelsConfigPathSchema
      })
      .strict(),
    plugins: z
      .object({
        enable_warning: z
          .object({
            enabled: z.boolean(),
            require_acknowledgement: z.boolean()
          })
          .strict()
      })
      .strict(),
    world: z
      .object({
        preferred_pack: NonEmptyStringSchema,
        bootstrap: z
          .object({
            enabled: z.boolean(),
            target_pack_dir: NonEmptyStringSchema,
            template_file: NonEmptyStringSchema,
            overwrite: z.boolean()
          })
          .strict()
      })
      .strict(),
    world_engine: WorldEngineRuntimeSchema,
    startup: z
      .object({
        allow_degraded_mode: z.boolean(),
        fail_on_missing_world_pack_dir: z.boolean(),
        fail_on_no_world_pack: z.boolean()
      })
      .strict(),
    sqlite: z
      .object({
        busy_timeout_ms: PositiveIntSchema,
        wal_autocheckpoint_pages: PositiveIntSchema,
        synchronous: SqliteSynchronousSchema
      })
      .strict(),
    scheduler: z
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
          .object(SchedulerObservabilitySchema.shape)
          .strict(),
        agent: z
          .object({
            limit: PositiveIntSchema,
            cooldown_ticks: PositiveIntSchema,
            max_candidates: PositiveIntSchema,
            decision_kernel: SchedulerDecisionKernelRuntimeSchema,
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
            trigger_engine: MemoryTriggerEngineRuntimeSchema
          })
          .strict()
      })
      .strict(),
    prompt_workflow: z
      .object({
        profiles: z
          .object({
            agent_decision_default: PromptWorkflowProfileDefaultsSchema,
            context_summary_default: PromptWorkflowProfileDefaultsSchema,
            memory_compaction_default: PromptWorkflowProfileDefaultsSchema
          })
          .strict()
      })
      .strict(),
    runtime: z
      .object({
        multi_pack: RuntimeMultiPackSchema
      })
      .strict(),
    features: z
      .object({
        ai_gateway_enabled: z.boolean(),
        inference_trace: z.boolean(),
        notifications: z.boolean(),
        experimental: z
          .object({
            multi_pack_runtime: ExperimentalMultiPackRuntimeSchema
          })
          .strict()
      })
      .strict()
  })
  .strict();

export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;
