import path from 'path'

import { ensureRuntimeConfigScaffold } from '../init/runtime_scaffold.js'
import { createLogger } from '../utils/logger.js'
import { safeFs } from '../utils/safe_fs.js'
import { BUILTIN_DEFAULTS } from './domains/index.js'
import { readYamlFileIfExists, resolveFromWorkspaceRoot, resolveWorkspaceRoot } from './loader.js'
import { deepMergeAll } from './merge.js'
import { type RuntimeConfig, RuntimeConfigSchema } from './schema.js'

const logger = createLogger('runtime-config')

export interface RuntimeConfigMetadata {
  workspaceRoot: string
  configDir: string
  activeEnv: string
  loadedFiles: string[]
}

export interface RuntimeStartupPolicy {
  allowDegradedMode: boolean
  failOnMissingWorldPackDir: boolean
  failOnNoWorldPack: boolean
}

export interface ResolvedWorldBootstrapConfig {
  enabled: boolean
  overwrite: boolean
  targetPackDirName: string
  targetPackDirPath: string
  templateFilePath: string
}

interface RuntimeConfigCache {
  config: RuntimeConfig
  metadata: RuntimeConfigMetadata
}

const CONFIG_DIR_RELATIVE_PATH = path.join('data', 'configw')
const CONFIG_FRAGMENTS_DIRNAME = 'conf.d'
const LOCAL_CONFIG_BASENAME = 'local.yaml'

// Built-in defaults are now defined per-domain in config/domains/.
// Imported from domains/index.js above as BUILTIN_DEFAULTS.

let runtimeConfigCache: RuntimeConfigCache | null = null
let runtimeConfigSnapshotLogged = false

const parseOptionalStringEnv = (value: string | undefined): string | undefined => {
  if (value === undefined) {
    return undefined
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

const parseBooleanEnv = (name: string, value: string | undefined): boolean | undefined => {
  const normalized = parseOptionalStringEnv(value)
  if (normalized === undefined) {
    return undefined
  }

  switch (normalized.toLowerCase()) {
    case '1':
    case 'true':
    case 'yes':
    case 'on':
      return true
    case '0':
    case 'false':
    case 'no':
    case 'off':
      return false
    default:
      throw new Error(`[runtime_config] 环境变量 ${name} 不是合法布尔值: ${value}`)
  }
}

const parseIntegerEnv = (name: string, value: string | undefined): number | undefined => {
  const normalized = parseOptionalStringEnv(value)
  if (normalized === undefined) {
    return undefined
  }

  const parsed = Number(normalized)
  if (!Number.isInteger(parsed)) {
    throw new Error(`[runtime_config] 环境变量 ${name} 不是合法整数: ${value}`)
  }

  return parsed
}

export const getActiveAppEnv = (): string => {
  return parseOptionalStringEnv(process.env.APP_ENV)
    ?? parseOptionalStringEnv(process.env.NODE_ENV)
    ?? BUILTIN_DEFAULTS.app.env
}

const buildEnvironmentOverrides = (activeEnv: string): Record<string, unknown> => {
  const appPort = parseIntegerEnv('PORT', process.env.PORT)
  const preferredPack = parseOptionalStringEnv(process.env.WORLD_PACK)
  const preferredOpening = parseOptionalStringEnv(process.env.WORLD_PREFERRED_OPENING)
  const worldPacksDir = parseOptionalStringEnv(process.env.WORLD_PACKS_DIR)
  const aiModelsConfigPath = parseOptionalStringEnv(process.env.AI_MODELS_CONFIG_PATH)
  const bootstrapEnabled = parseBooleanEnv('WORLD_BOOTSTRAP_ENABLED', process.env.WORLD_BOOTSTRAP_ENABLED)
  const bootstrapTargetPackDir = parseOptionalStringEnv(process.env.WORLD_BOOTSTRAP_TARGET_PACK_DIR)
  const bootstrapTemplateFile = parseOptionalStringEnv(process.env.WORLD_BOOTSTRAP_TEMPLATE_FILE)
  const bootstrapOverwrite = parseBooleanEnv('WORLD_BOOTSTRAP_OVERWRITE', process.env.WORLD_BOOTSTRAP_OVERWRITE)
  const sqliteBusyTimeoutMs = parseIntegerEnv('SQLITE_BUSY_TIMEOUT_MS', process.env.SQLITE_BUSY_TIMEOUT_MS)
  const sqliteWalAutocheckpointPages = parseIntegerEnv('SQLITE_WAL_AUTOCHECKPOINT_PAGES', process.env.SQLITE_WAL_AUTOCHECKPOINT_PAGES)
  const sqliteSynchronous = parseOptionalStringEnv(process.env.SQLITE_SYNCHRONOUS)?.toUpperCase()
  const simulationLoopIntervalMs = parseIntegerEnv('SIM_LOOP_INTERVAL_MS', process.env.SIM_LOOP_INTERVAL_MS)
  const schedulerLeaseTicks = parseIntegerEnv('SCHEDULER_LEASE_TICKS', process.env.SCHEDULER_LEASE_TICKS)
  const schedulerAutomaticRebalanceBacklogLimit = parseIntegerEnv('SCHEDULER_AUTOMATIC_REBALANCE_BACKLOG_LIMIT', process.env.SCHEDULER_AUTOMATIC_REBALANCE_BACKLOG_LIMIT)
  const schedulerAutomaticRebalanceMaxRecommendations = parseIntegerEnv('SCHEDULER_AUTOMATIC_REBALANCE_MAX_RECOMMENDATIONS', process.env.SCHEDULER_AUTOMATIC_REBALANCE_MAX_RECOMMENDATIONS)
  const schedulerAutomaticRebalanceMaxApply = parseIntegerEnv('SCHEDULER_AUTOMATIC_REBALANCE_MAX_APPLY', process.env.SCHEDULER_AUTOMATIC_REBALANCE_MAX_APPLY)
  const schedulerAgentLimit = parseIntegerEnv('SCHEDULER_AGENT_LIMIT', process.env.SCHEDULER_AGENT_LIMIT)
  const schedulerAgentCooldownTicks = parseIntegerEnv('SCHEDULER_AGENT_COOLDOWN_TICKS', process.env.SCHEDULER_AGENT_COOLDOWN_TICKS)
  const schedulerAgentDecisionKernelMode = parseOptionalStringEnv(process.env.SCHEDULER_AGENT_DECISION_KERNEL_MODE)
  const schedulerAgentDecisionKernelTimeoutMs = parseIntegerEnv('SCHEDULER_AGENT_DECISION_KERNEL_TIMEOUT_MS', process.env.SCHEDULER_AGENT_DECISION_KERNEL_TIMEOUT_MS)
  const schedulerAgentDecisionKernelBinaryPath = parseOptionalStringEnv(process.env.SCHEDULER_AGENT_DECISION_KERNEL_BINARY_PATH)
  const schedulerAgentDecisionKernelAutoRestart = parseBooleanEnv('SCHEDULER_AGENT_DECISION_KERNEL_AUTO_RESTART', process.env.SCHEDULER_AGENT_DECISION_KERNEL_AUTO_RESTART)
  const memoryTriggerEngineMode = parseOptionalStringEnv(process.env.MEMORY_TRIGGER_ENGINE_MODE)
  const memoryTriggerEngineTimeoutMs = parseIntegerEnv('MEMORY_TRIGGER_ENGINE_TIMEOUT_MS', process.env.MEMORY_TRIGGER_ENGINE_TIMEOUT_MS)
  const memoryTriggerEngineBinaryPath = parseOptionalStringEnv(process.env.MEMORY_TRIGGER_ENGINE_BINARY_PATH)
  const memoryTriggerEngineAutoRestart = parseBooleanEnv('MEMORY_TRIGGER_ENGINE_AUTO_RESTART', process.env.MEMORY_TRIGGER_ENGINE_AUTO_RESTART)
  const worldEngineTimeoutMs = parseIntegerEnv('WORLD_ENGINE_TIMEOUT_MS', process.env.WORLD_ENGINE_TIMEOUT_MS)
  const worldEngineBinaryPath = parseOptionalStringEnv(process.env.WORLD_ENGINE_BINARY_PATH)
  const worldEngineAutoRestart = parseBooleanEnv('WORLD_ENGINE_AUTO_RESTART', process.env.WORLD_ENGINE_AUTO_RESTART)
  const schedulerEntityDefaultMaxActiveWorkflows = parseIntegerEnv('SCHEDULER_ENTITY_DEFAULT_MAX_ACTIVE_WORKFLOWS_PER_ENTITY', process.env.SCHEDULER_ENTITY_DEFAULT_MAX_ACTIVE_WORKFLOWS_PER_ENTITY)
  const schedulerEntityMaxActivationsPerTick = parseIntegerEnv('SCHEDULER_ENTITY_MAX_ACTIVATIONS_PER_TICK', process.env.SCHEDULER_ENTITY_MAX_ACTIVATIONS_PER_TICK)
  const schedulerAllowParallelDecisionPerEntity = parseBooleanEnv('SCHEDULER_ALLOW_PARALLEL_DECISION_PER_ENTITY', process.env.SCHEDULER_ALLOW_PARALLEL_DECISION_PER_ENTITY)
  const schedulerAllowParallelActionPerEntity = parseBooleanEnv('SCHEDULER_ALLOW_PARALLEL_ACTION_PER_ENTITY', process.env.SCHEDULER_ALLOW_PARALLEL_ACTION_PER_ENTITY)
  const schedulerEventFollowupPreemptsPeriodic = parseBooleanEnv('SCHEDULER_EVENT_FOLLOWUP_PREEMPTS_PERIODIC', process.env.SCHEDULER_EVENT_FOLLOWUP_PREEMPTS_PERIODIC)
  const schedulerDecisionJobBatchLimit = parseIntegerEnv('SCHEDULER_DECISION_JOB_BATCH_LIMIT', process.env.SCHEDULER_DECISION_JOB_BATCH_LIMIT)
  const schedulerDecisionJobConcurrency = parseIntegerEnv('SCHEDULER_DECISION_JOB_CONCURRENCY', process.env.SCHEDULER_DECISION_JOB_CONCURRENCY)
  const schedulerDecisionJobLockTicks = parseIntegerEnv('SCHEDULER_DECISION_JOB_LOCK_TICKS', process.env.SCHEDULER_DECISION_JOB_LOCK_TICKS)
  const schedulerActionDispatcherBatchLimit = parseIntegerEnv('SCHEDULER_ACTION_DISPATCHER_BATCH_LIMIT', process.env.SCHEDULER_ACTION_DISPATCHER_BATCH_LIMIT)
  const schedulerActionDispatcherConcurrency = parseIntegerEnv('SCHEDULER_ACTION_DISPATCHER_CONCURRENCY', process.env.SCHEDULER_ACTION_DISPATCHER_CONCURRENCY)
  const schedulerActionDispatcherLockTicks = parseIntegerEnv('SCHEDULER_ACTION_DISPATCHER_LOCK_TICKS', process.env.SCHEDULER_ACTION_DISPATCHER_LOCK_TICKS)
  const schedulerTickBudgetCreatedJobs = parseIntegerEnv('SCHEDULER_TICK_BUDGET_MAX_CREATED_JOBS', process.env.SCHEDULER_TICK_BUDGET_MAX_CREATED_JOBS)
  const schedulerTickBudgetExecutedDecisions = parseIntegerEnv('SCHEDULER_TICK_BUDGET_MAX_EXECUTED_DECISIONS', process.env.SCHEDULER_TICK_BUDGET_MAX_EXECUTED_DECISIONS)
  const schedulerTickBudgetDispatchedActions = parseIntegerEnv('SCHEDULER_TICK_BUDGET_MAX_DISPATCHED_ACTIONS', process.env.SCHEDULER_TICK_BUDGET_MAX_DISPATCHED_ACTIONS)
  const schedulerDefaultQueryLimit = parseIntegerEnv('SCHEDULER_DEFAULT_QUERY_LIMIT', process.env.SCHEDULER_DEFAULT_QUERY_LIMIT)
  const schedulerMaxQueryLimit = parseIntegerEnv('SCHEDULER_MAX_QUERY_LIMIT', process.env.SCHEDULER_MAX_QUERY_LIMIT)
  const schedulerSummaryDefaultSampleRuns = parseIntegerEnv('SCHEDULER_SUMMARY_DEFAULT_SAMPLE_RUNS', process.env.SCHEDULER_SUMMARY_DEFAULT_SAMPLE_RUNS)
  const schedulerSummaryMaxSampleRuns = parseIntegerEnv('SCHEDULER_SUMMARY_MAX_SAMPLE_RUNS', process.env.SCHEDULER_SUMMARY_MAX_SAMPLE_RUNS)
  const schedulerOperatorDefaultRecentLimit = parseIntegerEnv('SCHEDULER_OPERATOR_DEFAULT_RECENT_LIMIT', process.env.SCHEDULER_OPERATOR_DEFAULT_RECENT_LIMIT)
  const schedulerOperatorMaxRecentLimit = parseIntegerEnv('SCHEDULER_OPERATOR_MAX_RECENT_LIMIT', process.env.SCHEDULER_OPERATOR_MAX_RECENT_LIMIT)
  const allowDegradedMode = parseBooleanEnv('STARTUP_ALLOW_DEGRADED_MODE', process.env.STARTUP_ALLOW_DEGRADED_MODE)
  const failOnMissingWorldPackDir = parseBooleanEnv(
    'STARTUP_FAIL_ON_MISSING_WORLD_PACK_DIR',
    process.env.STARTUP_FAIL_ON_MISSING_WORLD_PACK_DIR
  )
  const failOnNoWorldPack = parseBooleanEnv('STARTUP_FAIL_ON_NO_WORLD_PACK', process.env.STARTUP_FAIL_ON_NO_WORLD_PACK)
  const aiGatewayEnabled = parseBooleanEnv('AI_GATEWAY_ENABLED', process.env.AI_GATEWAY_ENABLED)
  const pluginEnableWarningEnabled = parseBooleanEnv('PLUGIN_ENABLE_WARNING_ENABLED', process.env.PLUGIN_ENABLE_WARNING_ENABLED)
  const experimentalMultiPackEnabled = parseBooleanEnv('EXPERIMENTAL_MULTI_PACK_RUNTIME_ENABLED', process.env.EXPERIMENTAL_MULTI_PACK_RUNTIME_ENABLED)
  const experimentalMultiPackOperatorApiEnabled = parseBooleanEnv('EXPERIMENTAL_MULTI_PACK_RUNTIME_OPERATOR_API_ENABLED', process.env.EXPERIMENTAL_MULTI_PACK_RUNTIME_OPERATOR_API_ENABLED)
  const experimentalMultiPackUiEnabled = parseBooleanEnv('EXPERIMENTAL_MULTI_PACK_RUNTIME_UI_ENABLED', process.env.EXPERIMENTAL_MULTI_PACK_RUNTIME_UI_ENABLED)
  const runtimeMultiPackMaxLoadedPacks = parseIntegerEnv('RUNTIME_MULTI_PACK_MAX_LOADED_PACKS', process.env.RUNTIME_MULTI_PACK_MAX_LOADED_PACKS)
  const runtimeMultiPackStartMode = parseOptionalStringEnv(process.env.RUNTIME_MULTI_PACK_START_MODE)
  const operatorJwtSecret = parseOptionalStringEnv(process.env.OPERATOR_JWT_SECRET)
  const operatorJwtExpiresIn = parseOptionalStringEnv(process.env.OPERATOR_JWT_EXPIRES_IN)
  const operatorBcryptRounds = parseIntegerEnv('OPERATOR_BCRYPT_ROUNDS', process.env.OPERATOR_BCRYPT_ROUNDS)
  const operatorRootDefaultPassword = parseOptionalStringEnv(process.env.OPERATOR_ROOT_DEFAULT_PASSWORD)
  const runtimeMultiPackBootstrapPacks = parseOptionalStringEnv(process.env.RUNTIME_MULTI_PACK_BOOTSTRAP_PACKS)
    ?.split(',')
    .map(value => value.trim())
    .filter(value => value.length > 0)
  const pluginEnableWarningRequireAcknowledgement = parseBooleanEnv(
    'PLUGIN_ENABLE_WARNING_REQUIRE_ACKNOWLEDGEMENT',
    process.env.PLUGIN_ENABLE_WARNING_REQUIRE_ACKNOWLEDGEMENT
  )

  const overrides: Record<string, unknown> = {
    app: {
      env: activeEnv
    },
    features: {
      ...(aiGatewayEnabled !== undefined ? { ai_gateway_enabled: aiGatewayEnabled } : {}),
      experimental: {}
    }
  }

  if (sqliteBusyTimeoutMs !== undefined || sqliteWalAutocheckpointPages !== undefined || sqliteSynchronous !== undefined) {
    overrides.database = {
      sqlite: {
        ...(sqliteBusyTimeoutMs !== undefined ? { busy_timeout_ms: sqliteBusyTimeoutMs } : {}),
        ...(sqliteWalAutocheckpointPages !== undefined
          ? { wal_autocheckpoint_pages: sqliteWalAutocheckpointPages }
          : {}),
        ...(sqliteSynchronous !== undefined ? { synchronous: sqliteSynchronous } : {})
      }
    }
  }

  if (appPort !== undefined) {
    (overrides.app as Record<string, unknown>).port = appPort
  }

  if (worldPacksDir !== undefined || aiModelsConfigPath !== undefined) {
    overrides.paths = {
      ...(worldPacksDir !== undefined ? { world_packs_dir: worldPacksDir } : {}),
      ...(aiModelsConfigPath !== undefined ? { ai_models_config: aiModelsConfigPath } : {})
    }
  }

  if (
    runtimeMultiPackMaxLoadedPacks !== undefined
    || runtimeMultiPackStartMode !== undefined
    || runtimeMultiPackBootstrapPacks !== undefined
  ) {
    overrides.runtime = {
      multi_pack: {
        ...(runtimeMultiPackMaxLoadedPacks !== undefined ? { max_loaded_packs: runtimeMultiPackMaxLoadedPacks } : {}),
        ...(runtimeMultiPackStartMode !== undefined ? { start_mode: runtimeMultiPackStartMode } : {}),
        ...(runtimeMultiPackBootstrapPacks !== undefined ? { bootstrap_packs: runtimeMultiPackBootstrapPacks } : {})
      }
    }
  }

  if (
    operatorJwtSecret !== undefined
    || operatorJwtExpiresIn !== undefined
    || operatorBcryptRounds !== undefined
    || operatorRootDefaultPassword !== undefined
  ) {
    overrides.operator = {
      auth: {
        ...(operatorJwtSecret !== undefined ? { jwt_secret: operatorJwtSecret } : {}),
        ...(operatorJwtExpiresIn !== undefined ? { jwt_expires_in: operatorJwtExpiresIn } : {}),
        ...(operatorBcryptRounds !== undefined ? { bcrypt_rounds: operatorBcryptRounds } : {})
      },
      root: {
        ...(operatorRootDefaultPassword !== undefined ? { default_password: operatorRootDefaultPassword } : {})
      }
    }
  }

  if (pluginEnableWarningEnabled !== undefined || pluginEnableWarningRequireAcknowledgement !== undefined) {
    overrides.plugins = {
      enable_warning: {
        ...(pluginEnableWarningEnabled !== undefined ? { enabled: pluginEnableWarningEnabled } : {}),
        ...(pluginEnableWarningRequireAcknowledgement !== undefined
          ? { require_acknowledgement: pluginEnableWarningRequireAcknowledgement }
          : {})
      }
    }
  }

  if (
    experimentalMultiPackEnabled !== undefined
    || experimentalMultiPackOperatorApiEnabled !== undefined
    || experimentalMultiPackUiEnabled !== undefined
  ) {
    (overrides.features as Record<string, unknown>).experimental = {
      multi_pack_runtime: {
        ...(experimentalMultiPackEnabled !== undefined ? { enabled: experimentalMultiPackEnabled } : {}),
        ...(experimentalMultiPackOperatorApiEnabled !== undefined ? { operator_api_enabled: experimentalMultiPackOperatorApiEnabled } : {}),
        ...(experimentalMultiPackUiEnabled !== undefined ? { ui_enabled: experimentalMultiPackUiEnabled } : {})
      }
    }
  }

  if (
    preferredPack !== undefined
    || preferredOpening !== undefined
    || bootstrapEnabled !== undefined
    || bootstrapTargetPackDir !== undefined
    || bootstrapTemplateFile !== undefined
    || bootstrapOverwrite !== undefined
  ) {
    overrides.world = {
      ...(preferredPack !== undefined ? { preferred_pack: preferredPack } : {}),
      ...(preferredOpening !== undefined ? { preferred_opening: preferredOpening } : {}),
      bootstrap: {
        ...(bootstrapEnabled !== undefined ? { enabled: bootstrapEnabled } : {}),
        ...(bootstrapTargetPackDir !== undefined ? { target_pack_dir: bootstrapTargetPackDir } : {}),
        ...(bootstrapTemplateFile !== undefined ? { template_file: bootstrapTemplateFile } : {}),
        ...(bootstrapOverwrite !== undefined ? { overwrite: bootstrapOverwrite } : {})
      }
    }
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
    }
  }

  if (
    simulationLoopIntervalMs !== undefined
    || schedulerLeaseTicks !== undefined
    || schedulerAutomaticRebalanceBacklogLimit !== undefined
    || schedulerAutomaticRebalanceMaxRecommendations !== undefined
    || schedulerAutomaticRebalanceMaxApply !== undefined
    || schedulerAgentLimit !== undefined
    || schedulerAgentCooldownTicks !== undefined
    || schedulerAgentDecisionKernelMode !== undefined
    || schedulerAgentDecisionKernelTimeoutMs !== undefined
    || schedulerAgentDecisionKernelBinaryPath !== undefined
    || schedulerAgentDecisionKernelAutoRestart !== undefined
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
    || memoryTriggerEngineMode !== undefined
    || memoryTriggerEngineTimeoutMs !== undefined
    || memoryTriggerEngineBinaryPath !== undefined
    || memoryTriggerEngineAutoRestart !== undefined
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
        ...(schedulerAgentCooldownTicks !== undefined ? { cooldown_ticks: schedulerAgentCooldownTicks } : {}),
        decision_kernel: {
          ...(schedulerAgentDecisionKernelMode !== undefined ? { mode: schedulerAgentDecisionKernelMode } : {}),
          ...(schedulerAgentDecisionKernelTimeoutMs !== undefined ? { timeout_ms: schedulerAgentDecisionKernelTimeoutMs } : {}),
          ...(schedulerAgentDecisionKernelBinaryPath !== undefined ? { binary_path: schedulerAgentDecisionKernelBinaryPath } : {}),
          ...(schedulerAgentDecisionKernelAutoRestart !== undefined ? { auto_restart: schedulerAgentDecisionKernelAutoRestart } : {})
        }
      },
      memory: {
        trigger_engine: {
          ...(memoryTriggerEngineMode !== undefined ? { mode: memoryTriggerEngineMode } : {}),
          ...(memoryTriggerEngineTimeoutMs !== undefined ? { timeout_ms: memoryTriggerEngineTimeoutMs } : {}),
          ...(memoryTriggerEngineBinaryPath !== undefined ? { binary_path: memoryTriggerEngineBinaryPath } : {}),
          ...(memoryTriggerEngineAutoRestart !== undefined ? { auto_restart: memoryTriggerEngineAutoRestart } : {})
        }
      }
    }
  }

  if (
    worldEngineTimeoutMs !== undefined
    || worldEngineBinaryPath !== undefined
    || worldEngineAutoRestart !== undefined
  ) {
    overrides.world_engine = {
      ...(worldEngineTimeoutMs !== undefined ? { timeout_ms: worldEngineTimeoutMs } : {}),
      ...(worldEngineBinaryPath !== undefined ? { binary_path: worldEngineBinaryPath } : {}),
      ...(worldEngineAutoRestart !== undefined ? { auto_restart: worldEngineAutoRestart } : {})
    }
  }

  return overrides
}

const loadConfigFragments = (configDir: string): Record<string, unknown>[] => {
  const fragmentsDir = path.join(configDir, CONFIG_FRAGMENTS_DIRNAME)
  if (!safeFs.existsSync(configDir, fragmentsDir) || !safeFs.statSync(configDir, fragmentsDir).isDirectory()) {
    return []
  }

  const files = safeFs
    .readdirSync(configDir, fragmentsDir)
    .filter(name => name.endsWith('.yaml') || name.endsWith('.yml'))
    .sort()
    .map(name => path.join(fragmentsDir, name))

  return files.map(filePath => readYamlFileIfExists(filePath))
}

const loadRuntimeConfig = (): RuntimeConfigCache => {
  const workspaceRoot = resolveWorkspaceRoot()
  ensureRuntimeConfigScaffold(workspaceRoot)

  const configDir = path.join(workspaceRoot, CONFIG_DIR_RELATIVE_PATH)
  const activeEnv = getActiveAppEnv()

  // Load conf.d/ fragments
  const baseFileOverrides = loadConfigFragments(configDir)

  const envFileOverride = readYamlFileIfExists(path.join(configDir, `${activeEnv}.yaml`))
  const localFileOverride = readYamlFileIfExists(path.join(configDir, LOCAL_CONFIG_BASENAME))
  const envOverrides = buildEnvironmentOverrides(activeEnv)

  const merged = deepMergeAll(
    BUILTIN_DEFAULTS as unknown as Record<string, unknown>,
    ...baseFileOverrides,
    envFileOverride,
    localFileOverride,
    envOverrides
  )

  const parsed = RuntimeConfigSchema.parse(merged)


  const loadedFiles: string[] = [path.join(configDir, CONFIG_FRAGMENTS_DIRNAME)]
  const envPath = path.join(configDir, `${activeEnv}.yaml`)
  if (Object.keys(envFileOverride).length > 0) loadedFiles.push(envPath)
  const localPath = path.join(configDir, LOCAL_CONFIG_BASENAME)
  if (Object.keys(localFileOverride).length > 0) loadedFiles.push(localPath)

  return {
    config: parsed,
    metadata: {
      workspaceRoot,
      configDir,
      activeEnv,
      loadedFiles
    }
  }
}

const getRuntimeConfigCache = (): RuntimeConfigCache => {
  if (!runtimeConfigCache) {
    runtimeConfigCache = loadRuntimeConfig()
  }

  return runtimeConfigCache
}

export const resetRuntimeConfigCache = (): void => {
  runtimeConfigCache = null
  runtimeConfigSnapshotLogged = false
}

export const getRuntimeConfig = (): RuntimeConfig => {
  return getRuntimeConfigCache().config
}

export const getRuntimeConfigMetadata = (): RuntimeConfigMetadata => {
  return getRuntimeConfigCache().metadata
}

export const resolveWorkspacePath = (relativePath: string): string => {
  return resolveFromWorkspaceRoot(relativePath, getRuntimeConfigMetadata().workspaceRoot)
}

export const getAppPort = (): number => {
  return getRuntimeConfig().app.port
}

export const getDatabaseConfig = (): RuntimeConfig['database'] => {
  return getRuntimeConfig().database
}

export const getSimulationLoopIntervalMs = (): number => {
  return getRuntimeConfig().scheduler.runtime.simulation_loop_interval_ms
}

export const getSchedulerLeaseTicks = (): bigint => {
  return BigInt(getRuntimeConfig().scheduler.lease_ticks)
}

export const getSchedulerAutomaticRebalanceConfig = (): RuntimeConfig['scheduler']['automatic_rebalance'] => {
  return getRuntimeConfig().scheduler.automatic_rebalance
}

export const getSchedulerObservabilityConfig = (): RuntimeConfig['scheduler']['observability'] => {
  return getRuntimeConfig().scheduler.observability
}

export const getSchedulerRunnerConfig = (): RuntimeConfig['scheduler']['runners'] => {
  return getRuntimeConfig().scheduler.runners
}

export const getSchedulerEntityConcurrencyConfig = (): RuntimeConfig['scheduler']['entity_concurrency'] => {
  return getRuntimeConfig().scheduler.entity_concurrency
}

export const getSchedulerTickBudgetConfig = (): RuntimeConfig['scheduler']['tick_budget'] => {
  return getRuntimeConfig().scheduler.tick_budget
}

export const getSchedulerAgentConfig = (): RuntimeConfig['scheduler']['agent'] => {
  return getRuntimeConfig().scheduler.agent
}

export const getSchedulerDecisionKernelConfig = (): RuntimeConfig['scheduler']['agent']['decision_kernel'] => {
  return getRuntimeConfig().scheduler.agent.decision_kernel
}

export const getMemoryTriggerEngineConfig = (): RuntimeConfig['scheduler']['memory']['trigger_engine'] => {
  return getRuntimeConfig().scheduler.memory.trigger_engine
}

export const getWorldEngineConfig = (): RuntimeConfig['world_engine'] => {
  return getRuntimeConfig().world_engine
}

export const getExperimentalMultiPackRuntimeConfig = (): RuntimeConfig['features']['experimental']['multi_pack_runtime'] => {
  return getRuntimeConfig().features.experimental.multi_pack_runtime
}

export const getRuntimeMultiPackConfig = (): RuntimeConfig['runtime']['multi_pack'] => {
  return getRuntimeConfig().runtime.multi_pack
}

export const isExperimentalMultiPackRuntimeEnabled = (): boolean => {
  return getExperimentalMultiPackRuntimeConfig().enabled
}

export const isExperimentalMultiPackOperatorApiEnabled = (): boolean => {
  const config = getExperimentalMultiPackRuntimeConfig()
  return config.enabled && config.operator_api_enabled
}

export const getWorldPacksDir = (): string => {
  return resolveWorkspacePath(getRuntimeConfig().paths.world_packs_dir)
}

export const getAiModelsConfigPath = (): string => {
  return resolveWorkspacePath(getRuntimeConfig().paths.ai_models_config)
}

export const getPreferredWorldPack = (): string => {
  return getRuntimeConfig().world.preferred_pack
}

export const getPreferredOpening = (): string | undefined => {
  return getRuntimeConfig().world.preferred_opening
}

export const getStartupPolicy = (): RuntimeStartupPolicy => {
  const startup = getRuntimeConfig().startup
  return {
    allowDegradedMode: startup.allow_degraded_mode,
    failOnMissingWorldPackDir: startup.fail_on_missing_world_pack_dir,
    failOnNoWorldPack: startup.fail_on_no_world_pack
  }
}

export const getWorldBootstrapConfig = (): ResolvedWorldBootstrapConfig => {
  const config = getRuntimeConfig()
  const targetPackDirName = config.world.bootstrap.target_pack_dir

  return {
    enabled: config.world.bootstrap.enabled,
    overwrite: config.world.bootstrap.overwrite,
    targetPackDirName,
    targetPackDirPath: path.join(getWorldPacksDir(), targetPackDirName),
    templateFilePath: resolveWorkspacePath(config.world.bootstrap.template_file)
  }
}

export const getOperatorAuthConfig = (): RuntimeConfig['operator']['auth'] => {
  return getRuntimeConfig().operator.auth
}

export const getOperatorRootConfig = (): RuntimeConfig['operator']['root'] => {
  return getRuntimeConfig().operator.root
}

export const buildRuntimeConfigSnapshot = (): Record<string, string | boolean | string[]> => {
  const metadata = getRuntimeConfigMetadata()
  const config = getRuntimeConfig()
  const bootstrap = getWorldBootstrapConfig()

  return {
    env: metadata.activeEnv,
    workspace_root: metadata.workspaceRoot,
    config_dir: metadata.configDir,
    loaded_files: metadata.loadedFiles,
    app_port: String(config.app.port),
    preferred_world_pack: config.world.preferred_pack,
    world_packs_dir: getWorldPacksDir(),
    ai_models_config: getAiModelsConfigPath(),
    sqlite_busy_timeout_ms: String(config.database.sqlite?.busy_timeout_ms ?? 5000),
    sqlite_wal_autocheckpoint_pages: String(config.database.sqlite?.wal_autocheckpoint_pages ?? 1000),
    sqlite_synchronous: config.database.sqlite?.synchronous ?? 'NORMAL',
    operator_jwt_expires_in: config.operator.auth.jwt_expires_in,
    operator_bcrypt_rounds: String(config.operator.auth.bcrypt_rounds),
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
    scheduler_agent_decision_kernel_mode: config.scheduler.agent.decision_kernel.mode,
    scheduler_agent_decision_kernel_timeout_ms: String(config.scheduler.agent.decision_kernel.timeout_ms),
    scheduler_agent_decision_kernel_binary_path: config.scheduler.agent.decision_kernel.binary_path,
    scheduler_agent_decision_kernel_auto_restart: String(config.scheduler.agent.decision_kernel.auto_restart),
    memory_trigger_engine_mode: config.scheduler.memory.trigger_engine.mode,
    memory_trigger_engine_timeout_ms: String(config.scheduler.memory.trigger_engine.timeout_ms),
    memory_trigger_engine_binary_path: config.scheduler.memory.trigger_engine.binary_path,
    memory_trigger_engine_auto_restart: String(config.scheduler.memory.trigger_engine.auto_restart),
    world_engine_timeout_ms: String(config.world_engine.timeout_ms),
    world_engine_binary_path: config.world_engine.binary_path,
    world_engine_auto_restart: String(config.world_engine.auto_restart),
    bootstrap_template_file: bootstrap.templateFilePath,
    prompt_workflow_agent_decision_budget: String(config.prompt_workflow.profiles.agent_decision_default.token_budget),
    runtime_multi_pack_max_loaded_packs: String(config.runtime.multi_pack.max_loaded_packs),
    runtime_multi_pack_start_mode: config.runtime.multi_pack.start_mode,
    runtime_multi_pack_bootstrap_packs: config.runtime.multi_pack.bootstrap_packs,
    startup_allow_degraded_mode: String(config.startup.allow_degraded_mode),
    ai_gateway_enabled: String(config.features.ai_gateway_enabled),
    experimental_multi_pack_runtime_enabled: String(config.features.experimental.multi_pack_runtime.enabled),
    experimental_multi_pack_runtime_operator_api_enabled: String(config.features.experimental.multi_pack_runtime.operator_api_enabled),
    experimental_multi_pack_runtime_ui_enabled: String(config.features.experimental.multi_pack_runtime.ui_enabled)
  }
}

export const logRuntimeConfigSnapshot = (logFn: (message: string) => void = (msg) => { logger.info(msg); }): void => {
  if (runtimeConfigSnapshotLogged) {
    return
  }

  const snapshot = buildRuntimeConfigSnapshot()
  const formatted = Object.entries(snapshot)
    .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(',') : value}`)
    .join(' | ')

  logFn(formatted)
  runtimeConfigSnapshotLogged = true
}

export const isAiGatewayEnabled = (): boolean => {
  return getRuntimeConfig().features.ai_gateway_enabled
}

export const validateProductionSecrets = (): void => {
  const config = getRuntimeConfig()
  const env = config.app.env

  if (env === 'development') {
    return
  }

  const defaultJwtSecret = 'changeme-please-replace-with-a-secure-random-string'
  if (config.operator.auth.jwt_secret === defaultJwtSecret) {
    throw new Error(
      'OPERATOR_JWT_SECRET 未配置。生产环境必须设置 OPERATOR_JWT_SECRET 环境变量或在 data/configw/local.yaml 中覆盖 jwt_secret。'
    )
  }

  const defaultPassword = 'changeme-root-password'
  if (config.operator.root.default_password === defaultPassword) {
    throw new Error(
      'OPERATOR_ROOT_DEFAULT_PASSWORD 未配置。生产环境必须设置 OPERATOR_ROOT_DEFAULT_PASSWORD 环境变量或在 data/configw/local.yaml 中覆盖 default_password。'
    )
  }
}
