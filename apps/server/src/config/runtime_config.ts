import path from 'path';

import { ensureRuntimeConfigScaffold } from '../init/runtime_scaffold.js';
import { readYamlFileIfExists, resolveFromWorkspaceRoot, resolveWorkspaceRoot } from './loader.js';
import { deepMergeAll } from './merge.js';
import { type RuntimeConfig, RuntimeConfigSchema } from './schema.js';

export interface RuntimeConfigMetadata {
  workspaceRoot: string;
  configDir: string;
  activeEnv: string;
  loadedFiles: string[];
}

export interface RuntimeStartupPolicy {
  allowDegradedMode: boolean;
  failOnMissingWorldPackDir: boolean;
  failOnNoWorldPack: boolean;
}

export interface ResolvedWorldBootstrapConfig {
  enabled: boolean;
  overwrite: boolean;
  targetPackDirName: string;
  targetPackDirPath: string;
  templateFilePath: string;
}

interface RuntimeConfigCache {
  config: RuntimeConfig;
  metadata: RuntimeConfigMetadata;
}

const CONFIG_DIR_RELATIVE_PATH = path.join('data', 'configw');
const DEFAULT_CONFIG_BASENAME = 'default.yaml';
const LOCAL_CONFIG_BASENAME = 'local.yaml';

const BUILTIN_DEFAULTS: RuntimeConfig = {
  config_version: 1,
  app: {
    name: 'Yidhras',
    env: 'development',
    port: 3001
  },
  paths: {
    world_packs_dir: 'data/world_packs',
    assets_dir: 'data/assets',
    plugins_dir: 'data/plugins',
    ai_models_config: 'apps/server/config/ai_models.yaml'
  },
  plugins: {
    enable_warning: {
      enabled: true,
      require_acknowledgement: true
    }
  },
  world: {
    preferred_pack: 'death_note',
    bootstrap: {
      enabled: true,
      target_pack_dir: 'death_note',
      template_file: 'data/configw/templates/world-pack/death_note.yaml',
      overwrite: false
    }
  },
  startup: {
    allow_degraded_mode: true,
    fail_on_missing_world_pack_dir: false,
    fail_on_no_world_pack: false
  },
  sqlite: {
    busy_timeout_ms: 5000,
    wal_autocheckpoint_pages: 1000,
    synchronous: 'NORMAL'
  },
  scheduler: {
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
    }
  },
  prompt_workflow: {
    profiles: {
      agent_decision_default: { token_budget: 2200, section_policy: 'standard', compatibility_mode: 'full' },
      context_summary_default: { token_budget: 1600, section_policy: 'minimal', compatibility_mode: 'bridge_only' },
      memory_compaction_default: { token_budget: 1800, section_policy: 'minimal', compatibility_mode: 'bridge_only' }
    }
  },
  features: {
    inference_trace: true,
    notifications: true
  }
};

let runtimeConfigCache: RuntimeConfigCache | null = null;
let runtimeConfigSnapshotLogged = false;

const parseOptionalStringEnv = (value: string | undefined): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
};

const parseBooleanEnv = (name: string, value: string | undefined): boolean | undefined => {
  const normalized = parseOptionalStringEnv(value);
  if (normalized === undefined) {
    return undefined;
  }

  switch (normalized.toLowerCase()) {
    case '1':
    case 'true':
    case 'yes':
    case 'on':
      return true;
    case '0':
    case 'false':
    case 'no':
    case 'off':
      return false;
    default:
      throw new Error(`[runtime_config] 环境变量 ${name} 不是合法布尔值: ${value}`);
  }
};

const parseIntegerEnv = (name: string, value: string | undefined): number | undefined => {
  const normalized = parseOptionalStringEnv(value);
  if (normalized === undefined) {
    return undefined;
  }

  const parsed = Number(normalized);
  if (!Number.isInteger(parsed)) {
    throw new Error(`[runtime_config] 环境变量 ${name} 不是合法整数: ${value}`);
  }

  return parsed;
};

export const getActiveAppEnv = (): string => {
  return parseOptionalStringEnv(process.env.APP_ENV)
    ?? parseOptionalStringEnv(process.env.NODE_ENV)
    ?? BUILTIN_DEFAULTS.app.env;
};

const buildEnvironmentOverrides = (activeEnv: string): Record<string, unknown> => {
  const appPort = parseIntegerEnv('PORT', process.env.PORT);
  const preferredPack = parseOptionalStringEnv(process.env.WORLD_PACK);
  const worldPacksDir = parseOptionalStringEnv(process.env.WORLD_PACKS_DIR);
  const aiModelsConfigPath = parseOptionalStringEnv(process.env.AI_MODELS_CONFIG_PATH);
  const bootstrapEnabled = parseBooleanEnv('WORLD_BOOTSTRAP_ENABLED', process.env.WORLD_BOOTSTRAP_ENABLED);
  const bootstrapTargetPackDir = parseOptionalStringEnv(process.env.WORLD_BOOTSTRAP_TARGET_PACK_DIR);
  const bootstrapTemplateFile = parseOptionalStringEnv(process.env.WORLD_BOOTSTRAP_TEMPLATE_FILE);
  const bootstrapOverwrite = parseBooleanEnv('WORLD_BOOTSTRAP_OVERWRITE', process.env.WORLD_BOOTSTRAP_OVERWRITE);
  const sqliteBusyTimeoutMs = parseIntegerEnv('SQLITE_BUSY_TIMEOUT_MS', process.env.SQLITE_BUSY_TIMEOUT_MS);
  const sqliteWalAutocheckpointPages = parseIntegerEnv('SQLITE_WAL_AUTOCHECKPOINT_PAGES', process.env.SQLITE_WAL_AUTOCHECKPOINT_PAGES);
  const sqliteSynchronous = parseOptionalStringEnv(process.env.SQLITE_SYNCHRONOUS)?.toUpperCase();
  const simulationLoopIntervalMs = parseIntegerEnv('SIM_LOOP_INTERVAL_MS', process.env.SIM_LOOP_INTERVAL_MS);
  const schedulerLeaseTicks = parseIntegerEnv('SCHEDULER_LEASE_TICKS', process.env.SCHEDULER_LEASE_TICKS);
  const schedulerAutomaticRebalanceBacklogLimit = parseIntegerEnv('SCHEDULER_AUTOMATIC_REBALANCE_BACKLOG_LIMIT', process.env.SCHEDULER_AUTOMATIC_REBALANCE_BACKLOG_LIMIT);
  const schedulerAutomaticRebalanceMaxRecommendations = parseIntegerEnv('SCHEDULER_AUTOMATIC_REBALANCE_MAX_RECOMMENDATIONS', process.env.SCHEDULER_AUTOMATIC_REBALANCE_MAX_RECOMMENDATIONS);
  const schedulerAutomaticRebalanceMaxApply = parseIntegerEnv('SCHEDULER_AUTOMATIC_REBALANCE_MAX_APPLY', process.env.SCHEDULER_AUTOMATIC_REBALANCE_MAX_APPLY);
  const schedulerAgentLimit = parseIntegerEnv('SCHEDULER_AGENT_LIMIT', process.env.SCHEDULER_AGENT_LIMIT);
  const schedulerAgentCooldownTicks = parseIntegerEnv('SCHEDULER_AGENT_COOLDOWN_TICKS', process.env.SCHEDULER_AGENT_COOLDOWN_TICKS);
  const schedulerEntityDefaultMaxActiveWorkflows = parseIntegerEnv('SCHEDULER_ENTITY_DEFAULT_MAX_ACTIVE_WORKFLOWS_PER_ENTITY', process.env.SCHEDULER_ENTITY_DEFAULT_MAX_ACTIVE_WORKFLOWS_PER_ENTITY);
  const schedulerEntityMaxActivationsPerTick = parseIntegerEnv('SCHEDULER_ENTITY_MAX_ACTIVATIONS_PER_TICK', process.env.SCHEDULER_ENTITY_MAX_ACTIVATIONS_PER_TICK);
  const schedulerAllowParallelDecisionPerEntity = parseBooleanEnv('SCHEDULER_ALLOW_PARALLEL_DECISION_PER_ENTITY', process.env.SCHEDULER_ALLOW_PARALLEL_DECISION_PER_ENTITY);
  const schedulerAllowParallelActionPerEntity = parseBooleanEnv('SCHEDULER_ALLOW_PARALLEL_ACTION_PER_ENTITY', process.env.SCHEDULER_ALLOW_PARALLEL_ACTION_PER_ENTITY);
  const schedulerEventFollowupPreemptsPeriodic = parseBooleanEnv('SCHEDULER_EVENT_FOLLOWUP_PREEMPTS_PERIODIC', process.env.SCHEDULER_EVENT_FOLLOWUP_PREEMPTS_PERIODIC);
  const schedulerDecisionJobBatchLimit = parseIntegerEnv('SCHEDULER_DECISION_JOB_BATCH_LIMIT', process.env.SCHEDULER_DECISION_JOB_BATCH_LIMIT);
  const schedulerDecisionJobConcurrency = parseIntegerEnv('SCHEDULER_DECISION_JOB_CONCURRENCY', process.env.SCHEDULER_DECISION_JOB_CONCURRENCY);
  const schedulerDecisionJobLockTicks = parseIntegerEnv('SCHEDULER_DECISION_JOB_LOCK_TICKS', process.env.SCHEDULER_DECISION_JOB_LOCK_TICKS);
  const schedulerActionDispatcherBatchLimit = parseIntegerEnv('SCHEDULER_ACTION_DISPATCHER_BATCH_LIMIT', process.env.SCHEDULER_ACTION_DISPATCHER_BATCH_LIMIT);
  const schedulerActionDispatcherConcurrency = parseIntegerEnv('SCHEDULER_ACTION_DISPATCHER_CONCURRENCY', process.env.SCHEDULER_ACTION_DISPATCHER_CONCURRENCY);
  const schedulerActionDispatcherLockTicks = parseIntegerEnv('SCHEDULER_ACTION_DISPATCHER_LOCK_TICKS', process.env.SCHEDULER_ACTION_DISPATCHER_LOCK_TICKS);
  const schedulerTickBudgetCreatedJobs = parseIntegerEnv('SCHEDULER_TICK_BUDGET_MAX_CREATED_JOBS', process.env.SCHEDULER_TICK_BUDGET_MAX_CREATED_JOBS);
  const schedulerTickBudgetExecutedDecisions = parseIntegerEnv('SCHEDULER_TICK_BUDGET_MAX_EXECUTED_DECISIONS', process.env.SCHEDULER_TICK_BUDGET_MAX_EXECUTED_DECISIONS);
  const schedulerTickBudgetDispatchedActions = parseIntegerEnv('SCHEDULER_TICK_BUDGET_MAX_DISPATCHED_ACTIONS', process.env.SCHEDULER_TICK_BUDGET_MAX_DISPATCHED_ACTIONS);
  const schedulerDefaultQueryLimit = parseIntegerEnv('SCHEDULER_DEFAULT_QUERY_LIMIT', process.env.SCHEDULER_DEFAULT_QUERY_LIMIT);
  const schedulerMaxQueryLimit = parseIntegerEnv('SCHEDULER_MAX_QUERY_LIMIT', process.env.SCHEDULER_MAX_QUERY_LIMIT);
  const schedulerSummaryDefaultSampleRuns = parseIntegerEnv('SCHEDULER_SUMMARY_DEFAULT_SAMPLE_RUNS', process.env.SCHEDULER_SUMMARY_DEFAULT_SAMPLE_RUNS);
  const schedulerSummaryMaxSampleRuns = parseIntegerEnv('SCHEDULER_SUMMARY_MAX_SAMPLE_RUNS', process.env.SCHEDULER_SUMMARY_MAX_SAMPLE_RUNS);
  const schedulerOperatorDefaultRecentLimit = parseIntegerEnv('SCHEDULER_OPERATOR_DEFAULT_RECENT_LIMIT', process.env.SCHEDULER_OPERATOR_DEFAULT_RECENT_LIMIT);
  const schedulerOperatorMaxRecentLimit = parseIntegerEnv('SCHEDULER_OPERATOR_MAX_RECENT_LIMIT', process.env.SCHEDULER_OPERATOR_MAX_RECENT_LIMIT);
  const allowDegradedMode = parseBooleanEnv('STARTUP_ALLOW_DEGRADED_MODE', process.env.STARTUP_ALLOW_DEGRADED_MODE);
  const failOnMissingWorldPackDir = parseBooleanEnv(
    'STARTUP_FAIL_ON_MISSING_WORLD_PACK_DIR',
    process.env.STARTUP_FAIL_ON_MISSING_WORLD_PACK_DIR
  );
  const failOnNoWorldPack = parseBooleanEnv('STARTUP_FAIL_ON_NO_WORLD_PACK', process.env.STARTUP_FAIL_ON_NO_WORLD_PACK);
  const pluginEnableWarningEnabled = parseBooleanEnv('PLUGIN_ENABLE_WARNING_ENABLED', process.env.PLUGIN_ENABLE_WARNING_ENABLED);
  const pluginEnableWarningRequireAcknowledgement = parseBooleanEnv(
    'PLUGIN_ENABLE_WARNING_REQUIRE_ACKNOWLEDGEMENT',
    process.env.PLUGIN_ENABLE_WARNING_REQUIRE_ACKNOWLEDGEMENT
  );

  const overrides: Record<string, unknown> = {
    app: {
      env: activeEnv
    }
  };

  if (sqliteBusyTimeoutMs !== undefined || sqliteWalAutocheckpointPages !== undefined || sqliteSynchronous !== undefined) {
    overrides.sqlite = {
      ...(sqliteBusyTimeoutMs !== undefined ? { busy_timeout_ms: sqliteBusyTimeoutMs } : {}),
      ...(sqliteWalAutocheckpointPages !== undefined
        ? { wal_autocheckpoint_pages: sqliteWalAutocheckpointPages }
        : {}),
      ...(sqliteSynchronous !== undefined ? { synchronous: sqliteSynchronous } : {})
    };
  }

  if (appPort !== undefined) {
    (overrides.app as Record<string, unknown>).port = appPort;
  }

  if (worldPacksDir !== undefined || aiModelsConfigPath !== undefined) {
    overrides.paths = {
      ...(worldPacksDir !== undefined ? { world_packs_dir: worldPacksDir } : {}),
      ...(aiModelsConfigPath !== undefined ? { ai_models_config: aiModelsConfigPath } : {})
    };
  }

  if (pluginEnableWarningEnabled !== undefined || pluginEnableWarningRequireAcknowledgement !== undefined) {
    overrides.plugins = {
      enable_warning: {
        ...(pluginEnableWarningEnabled !== undefined ? { enabled: pluginEnableWarningEnabled } : {}),
        ...(pluginEnableWarningRequireAcknowledgement !== undefined
          ? { require_acknowledgement: pluginEnableWarningRequireAcknowledgement }
          : {})
      }
    };
  }

  if (
    preferredPack !== undefined
    || bootstrapEnabled !== undefined
    || bootstrapTargetPackDir !== undefined
    || bootstrapTemplateFile !== undefined
    || bootstrapOverwrite !== undefined
  ) {
    overrides.world = {
      ...(preferredPack !== undefined ? { preferred_pack: preferredPack } : {}),
      bootstrap: {
        ...(bootstrapEnabled !== undefined ? { enabled: bootstrapEnabled } : {}),
        ...(bootstrapTargetPackDir !== undefined ? { target_pack_dir: bootstrapTargetPackDir } : {}),
        ...(bootstrapTemplateFile !== undefined ? { template_file: bootstrapTemplateFile } : {}),
        ...(bootstrapOverwrite !== undefined ? { overwrite: bootstrapOverwrite } : {})
      }
    };
  }

  if (
    allowDegradedMode !== undefined
    || failOnMissingWorldPackDir !== undefined
    || failOnNoWorldPack !== undefined
  ) {
    overrides.startup = {
      ...(allowDegradedMode !== undefined ? { allow_degraded_mode: allowDegradedMode } : {}),
      ...(failOnMissingWorldPackDir !== undefined ? { fail_on_missing_world_pack_dir: failOnMissingWorldPackDir } : {}),
      ...(failOnNoWorldPack !== undefined ? { fail_on_no_world_pack: failOnNoWorldPack } : {})
    };
  }

  if (
    simulationLoopIntervalMs !== undefined
    || schedulerLeaseTicks !== undefined
    || schedulerAutomaticRebalanceBacklogLimit !== undefined
    || schedulerAutomaticRebalanceMaxRecommendations !== undefined
    || schedulerAutomaticRebalanceMaxApply !== undefined
    || schedulerAgentLimit !== undefined
    || schedulerAgentCooldownTicks !== undefined
    || schedulerEntityDefaultMaxActiveWorkflows !== undefined
    || schedulerEntityMaxActivationsPerTick !== undefined
    || schedulerAllowParallelDecisionPerEntity !== undefined
    || schedulerAllowParallelActionPerEntity !== undefined
    || schedulerEventFollowupPreemptsPeriodic !== undefined
    || schedulerDecisionJobBatchLimit !== undefined
    || schedulerDecisionJobConcurrency !== undefined
    || schedulerDecisionJobLockTicks !== undefined
    || schedulerActionDispatcherBatchLimit !== undefined
    || schedulerActionDispatcherConcurrency !== undefined
    || schedulerActionDispatcherLockTicks !== undefined
    || schedulerTickBudgetCreatedJobs !== undefined
    || schedulerTickBudgetExecutedDecisions !== undefined
    || schedulerTickBudgetDispatchedActions !== undefined
    || schedulerDefaultQueryLimit !== undefined
    || schedulerMaxQueryLimit !== undefined
    || schedulerSummaryDefaultSampleRuns !== undefined
    || schedulerSummaryMaxSampleRuns !== undefined
    || schedulerOperatorDefaultRecentLimit !== undefined
    || schedulerOperatorMaxRecentLimit !== undefined
  ) {
    overrides.scheduler = {
      runtime: {
        ...(simulationLoopIntervalMs !== undefined ? { simulation_loop_interval_ms: simulationLoopIntervalMs } : {})
      },
      ...(schedulerLeaseTicks !== undefined ? { lease_ticks: schedulerLeaseTicks } : {}),
      entity_concurrency: {
        ...(schedulerEntityDefaultMaxActiveWorkflows !== undefined ? { default_max_active_workflows_per_entity: schedulerEntityDefaultMaxActiveWorkflows } : {}),
        ...(schedulerEntityMaxActivationsPerTick !== undefined ? { max_entity_activations_per_tick: schedulerEntityMaxActivationsPerTick } : {}),
        ...(schedulerAllowParallelDecisionPerEntity !== undefined ? { allow_parallel_decision_per_entity: schedulerAllowParallelDecisionPerEntity } : {}),
        ...(schedulerAllowParallelActionPerEntity !== undefined ? { allow_parallel_action_per_entity: schedulerAllowParallelActionPerEntity } : {}),
        ...(schedulerEventFollowupPreemptsPeriodic !== undefined ? { event_followup_preempts_periodic: schedulerEventFollowupPreemptsPeriodic } : {})
      },
      tick_budget: {
        ...(schedulerTickBudgetCreatedJobs !== undefined ? { max_created_jobs_per_tick: schedulerTickBudgetCreatedJobs } : {}),
        ...(schedulerTickBudgetExecutedDecisions !== undefined ? { max_executed_decisions_per_tick: schedulerTickBudgetExecutedDecisions } : {}),
        ...(schedulerTickBudgetDispatchedActions !== undefined ? { max_dispatched_actions_per_tick: schedulerTickBudgetDispatchedActions } : {})
      },
      automatic_rebalance: {
        ...(schedulerAutomaticRebalanceBacklogLimit !== undefined ? { backlog_limit: schedulerAutomaticRebalanceBacklogLimit } : {}),
        ...(schedulerAutomaticRebalanceMaxRecommendations !== undefined ? { max_recommendations: schedulerAutomaticRebalanceMaxRecommendations } : {}),
        ...(schedulerAutomaticRebalanceMaxApply !== undefined ? { max_apply: schedulerAutomaticRebalanceMaxApply } : {})
      },
      runners: {
        decision_job: {
          ...(schedulerDecisionJobBatchLimit !== undefined ? { batch_limit: schedulerDecisionJobBatchLimit } : {}),
          ...(schedulerDecisionJobConcurrency !== undefined ? { concurrency: schedulerDecisionJobConcurrency } : {}),
          ...(schedulerDecisionJobLockTicks !== undefined ? { lock_ticks: schedulerDecisionJobLockTicks } : {})
        },
        action_dispatcher: {
          ...(schedulerActionDispatcherBatchLimit !== undefined ? { batch_limit: schedulerActionDispatcherBatchLimit } : {}),
          ...(schedulerActionDispatcherConcurrency !== undefined ? { concurrency: schedulerActionDispatcherConcurrency } : {}),
          ...(schedulerActionDispatcherLockTicks !== undefined ? { lock_ticks: schedulerActionDispatcherLockTicks } : {})
        }
      },
      observability: {
        ...(schedulerDefaultQueryLimit !== undefined ? { default_query_limit: schedulerDefaultQueryLimit } : {}),
        ...(schedulerMaxQueryLimit !== undefined ? { max_query_limit: schedulerMaxQueryLimit } : {}),
        summary: {
          ...(schedulerSummaryDefaultSampleRuns !== undefined ? { default_sample_runs: schedulerSummaryDefaultSampleRuns } : {}),
          ...(schedulerSummaryMaxSampleRuns !== undefined ? { max_sample_runs: schedulerSummaryMaxSampleRuns } : {})
        },
        trends: {
          ...(schedulerSummaryDefaultSampleRuns !== undefined ? { default_sample_runs: schedulerSummaryDefaultSampleRuns } : {}),
          ...(schedulerSummaryMaxSampleRuns !== undefined ? { max_sample_runs: schedulerSummaryMaxSampleRuns } : {})
        },
        operator_projection: {
          ...(schedulerSummaryDefaultSampleRuns !== undefined ? { default_sample_runs: schedulerSummaryDefaultSampleRuns } : {}),
          ...(schedulerSummaryMaxSampleRuns !== undefined ? { max_sample_runs: schedulerSummaryMaxSampleRuns } : {}),
          ...(schedulerOperatorDefaultRecentLimit !== undefined ? { default_recent_limit: schedulerOperatorDefaultRecentLimit } : {}),
          ...(schedulerOperatorMaxRecentLimit !== undefined ? { max_recent_limit: schedulerOperatorMaxRecentLimit } : {})
        }
      },
      agent: {
        ...(schedulerAgentLimit !== undefined ? { limit: schedulerAgentLimit } : {}),
        ...(schedulerAgentCooldownTicks !== undefined ? { cooldown_ticks: schedulerAgentCooldownTicks } : {})
      }
    };
  }

  return overrides;
};

const loadRuntimeConfig = (): RuntimeConfigCache => {
  const workspaceRoot = resolveWorkspaceRoot();
  ensureRuntimeConfigScaffold(workspaceRoot);

  const configDir = path.join(workspaceRoot, CONFIG_DIR_RELATIVE_PATH);
  const activeEnv = getActiveAppEnv();
  const configFilePaths = [
    path.join(configDir, DEFAULT_CONFIG_BASENAME),
    path.join(configDir, `${activeEnv}.yaml`),
    path.join(configDir, LOCAL_CONFIG_BASENAME)
  ];

  const fileOverrides = configFilePaths.map(filePath => readYamlFileIfExists(filePath));
  const envOverrides = buildEnvironmentOverrides(activeEnv);
  const merged = deepMergeAll(
    BUILTIN_DEFAULTS as unknown as Record<string, unknown>,
    ...fileOverrides,
    envOverrides
  );

  const parsed = RuntimeConfigSchema.parse(merged);

  return {
    config: parsed,
    metadata: {
      workspaceRoot,
      configDir,
      activeEnv,
      loadedFiles: configFilePaths.filter((filePath, index) => Object.keys(fileOverrides[index]).length > 0)
    }
  };
};

const getRuntimeConfigCache = (): RuntimeConfigCache => {
  if (!runtimeConfigCache) {
    runtimeConfigCache = loadRuntimeConfig();
  }

  return runtimeConfigCache;
};

export const resetRuntimeConfigCache = (): void => {
  runtimeConfigCache = null;
  runtimeConfigSnapshotLogged = false;
};

export const getRuntimeConfig = (): RuntimeConfig => {
  return getRuntimeConfigCache().config;
};

export const getRuntimeConfigMetadata = (): RuntimeConfigMetadata => {
  return getRuntimeConfigCache().metadata;
};

export const resolveWorkspacePath = (relativePath: string): string => {
  return resolveFromWorkspaceRoot(relativePath, getRuntimeConfigMetadata().workspaceRoot);
};

export const getAppPort = (): number => {
  return getRuntimeConfig().app.port;
};

export const getSqliteRuntimeConfig = (): RuntimeConfig['sqlite'] => {
  return getRuntimeConfig().sqlite;
};

export const getSimulationLoopIntervalMs = (): number => {
  return getRuntimeConfig().scheduler.runtime.simulation_loop_interval_ms;
};

export const getSchedulerLeaseTicks = (): bigint => {
  return BigInt(getRuntimeConfig().scheduler.lease_ticks);
};

export const getSchedulerAutomaticRebalanceConfig = (): RuntimeConfig['scheduler']['automatic_rebalance'] => {
  return getRuntimeConfig().scheduler.automatic_rebalance;
};

export const getSchedulerObservabilityConfig = (): RuntimeConfig['scheduler']['observability'] => {
  return getRuntimeConfig().scheduler.observability;
};

export const getSchedulerRunnerConfig = (): RuntimeConfig['scheduler']['runners'] => {
  return getRuntimeConfig().scheduler.runners;
};

export const getSchedulerEntityConcurrencyConfig = (): RuntimeConfig['scheduler']['entity_concurrency'] => {
  return getRuntimeConfig().scheduler.entity_concurrency;
};

export const getSchedulerTickBudgetConfig = (): RuntimeConfig['scheduler']['tick_budget'] => {
  return getRuntimeConfig().scheduler.tick_budget;
};

export const getSchedulerAgentConfig = (): RuntimeConfig['scheduler']['agent'] => {
  return getRuntimeConfig().scheduler.agent;
};

export const getWorldPacksDir = (): string => {
  return resolveWorkspacePath(getRuntimeConfig().paths.world_packs_dir);
};

export const getAiModelsConfigPath = (): string => {
  return resolveWorkspacePath(getRuntimeConfig().paths.ai_models_config);
};

export const getPreferredWorldPack = (): string => {
  return getRuntimeConfig().world.preferred_pack;
};

export const getStartupPolicy = (): RuntimeStartupPolicy => {
  const startup = getRuntimeConfig().startup;
  return {
    allowDegradedMode: startup.allow_degraded_mode,
    failOnMissingWorldPackDir: startup.fail_on_missing_world_pack_dir,
    failOnNoWorldPack: startup.fail_on_no_world_pack
  };
};

export const getWorldBootstrapConfig = (): ResolvedWorldBootstrapConfig => {
  const config = getRuntimeConfig();
  const targetPackDirName = config.world.bootstrap.target_pack_dir;

  return {
    enabled: config.world.bootstrap.enabled,
    overwrite: config.world.bootstrap.overwrite,
    targetPackDirName,
    targetPackDirPath: path.join(getWorldPacksDir(), targetPackDirName),
    templateFilePath: resolveWorkspacePath(config.world.bootstrap.template_file)
  };
};

export const buildRuntimeConfigSnapshot = (): Record<string, string | boolean | string[]> => {
  const metadata = getRuntimeConfigMetadata();
  const config = getRuntimeConfig();
  const bootstrap = getWorldBootstrapConfig();

  return {
    env: metadata.activeEnv,
    workspace_root: metadata.workspaceRoot,
    config_dir: metadata.configDir,
    loaded_files: metadata.loadedFiles,
    app_port: String(config.app.port),
    preferred_world_pack: config.world.preferred_pack,
    world_packs_dir: getWorldPacksDir(),
    ai_models_config: getAiModelsConfigPath(),
    sqlite_busy_timeout_ms: String(config.sqlite.busy_timeout_ms),
    sqlite_wal_autocheckpoint_pages: String(config.sqlite.wal_autocheckpoint_pages),
    sqlite_synchronous: config.sqlite.synchronous,
    plugin_enable_warning_enabled: String(config.plugins.enable_warning.enabled),
    bootstrap_enabled: String(bootstrap.enabled),
    plugin_enable_warning_require_acknowledgement: String(config.plugins.enable_warning.require_acknowledgement),
    bootstrap_target_pack_dir: bootstrap.targetPackDirName,
    simulation_loop_interval_ms: String(config.scheduler.runtime.simulation_loop_interval_ms),
    scheduler_lease_ticks: String(config.scheduler.lease_ticks),
    scheduler_entity_default_max_active_workflows_per_entity: String(config.scheduler.entity_concurrency.default_max_active_workflows_per_entity),
    scheduler_entity_max_activations_per_tick: String(config.scheduler.entity_concurrency.max_entity_activations_per_tick),
    scheduler_allow_parallel_decision_per_entity: String(config.scheduler.entity_concurrency.allow_parallel_decision_per_entity),
    scheduler_allow_parallel_action_per_entity: String(config.scheduler.entity_concurrency.allow_parallel_action_per_entity),
    scheduler_event_followup_preempts_periodic: String(config.scheduler.entity_concurrency.event_followup_preempts_periodic),
    scheduler_tick_budget_max_created_jobs: String(config.scheduler.tick_budget.max_created_jobs_per_tick),
    scheduler_tick_budget_max_executed_decisions: String(config.scheduler.tick_budget.max_executed_decisions_per_tick),
    scheduler_tick_budget_max_dispatched_actions: String(config.scheduler.tick_budget.max_dispatched_actions_per_tick),
    scheduler_automatic_rebalance_backlog_limit: String(config.scheduler.automatic_rebalance.backlog_limit),
    scheduler_automatic_rebalance_max_recommendations: String(config.scheduler.automatic_rebalance.max_recommendations),
    scheduler_automatic_rebalance_max_apply: String(config.scheduler.automatic_rebalance.max_apply),
    scheduler_runner_decision_job_batch_limit: String(config.scheduler.runners.decision_job.batch_limit),
    scheduler_runner_decision_job_concurrency: String(config.scheduler.runners.decision_job.concurrency),
    scheduler_runner_decision_job_lock_ticks: String(config.scheduler.runners.decision_job.lock_ticks),
    scheduler_runner_action_dispatcher_batch_limit: String(config.scheduler.runners.action_dispatcher.batch_limit),
    scheduler_runner_action_dispatcher_concurrency: String(config.scheduler.runners.action_dispatcher.concurrency),
    scheduler_runner_action_dispatcher_lock_ticks: String(config.scheduler.runners.action_dispatcher.lock_ticks),
    scheduler_default_query_limit: String(config.scheduler.observability.default_query_limit),
    scheduler_max_query_limit: String(config.scheduler.observability.max_query_limit),
    scheduler_summary_default_sample_runs: String(config.scheduler.observability.summary.default_sample_runs),
    scheduler_summary_max_sample_runs: String(config.scheduler.observability.summary.max_sample_runs),
    scheduler_operator_default_recent_limit: String(config.scheduler.observability.operator_projection.default_recent_limit),
    scheduler_operator_max_recent_limit: String(config.scheduler.observability.operator_projection.max_recent_limit),
    scheduler_agent_limit: String(config.scheduler.agent.limit),
    scheduler_agent_cooldown_ticks: String(config.scheduler.agent.cooldown_ticks),
    scheduler_agent_max_candidates: String(config.scheduler.agent.max_candidates),
    bootstrap_template_file: bootstrap.templateFilePath,
    prompt_workflow_agent_decision_budget: String(config.prompt_workflow.profiles.agent_decision_default.token_budget),
    startup_allow_degraded_mode: String(config.startup.allow_degraded_mode)
  };
};

export const logRuntimeConfigSnapshot = (logger: (message: string) => void = console.log): void => {
  if (runtimeConfigSnapshotLogged) {
    return;
  }

  const snapshot = buildRuntimeConfigSnapshot();
  const formatted = Object.entries(snapshot)
    .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(',') : value}`)
    .join(' | ');

  logger(`[configw] ${formatted}`);
  runtimeConfigSnapshotLogged = true;
};
