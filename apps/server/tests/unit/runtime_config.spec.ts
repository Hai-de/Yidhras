import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getDatabaseConfig,
  getExperimentalMultiPackRuntimeConfig,
  getMemoryTriggerEngineConfig,
  getRuntimeConfig,
  getRuntimeMultiPackConfig,
  getSchedulerAgentConfig,
  getSchedulerAutomaticRebalanceConfig,
  getSchedulerEntityConcurrencyConfig,
  getSchedulerLeaseTicks,
  getSchedulerObservabilityConfig,
  getSchedulerRunnerConfig,
  getSchedulerTickBudgetConfig,
  getSimulationLoopIntervalMs,
  getWorldEngineConfig,
  isAiGatewayEnabled,
  isExperimentalMultiPackOperatorApiEnabled,
  isExperimentalMultiPackRuntimeEnabled,
  resetRuntimeConfigCache
} from '../../src/config/runtime_config.js';

const createdRoots: string[] = [];

const writeWorkspaceFile = async (rootDir: string, relativePath: string, content: string): Promise<void> => {
  const targetPath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content, 'utf-8');
};

const createWorkspace = async (files: Record<string, string>): Promise<string> => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'yidhras-runtime-config-'));
  createdRoots.push(rootDir);

  await writeWorkspaceFile(rootDir, 'pnpm-workspace.yaml', 'packages: []\n');
  await writeWorkspaceFile(rootDir, 'apps/server/config/ai_models.yaml', 'version: 1\nproviders: []\nmodels: []\nroutes: []\n');
  await writeWorkspaceFile(rootDir, 'apps/server/templates/world-pack/example_pack.yaml', 'metadata:\n  id: world-example-pack\n');
  await writeWorkspaceFile(rootDir, 'apps/server/templates/world-pack/example_pack.README.md', '# example pack\n');
  await writeWorkspaceFile(rootDir, 'apps/server/templates/world-pack/example_pack.CHANGELOG.md', '# changelog\n');
  await writeWorkspaceFile(rootDir, 'apps/server/templates/configw/default.yaml', 'config_version: 1\n');
  await writeWorkspaceFile(rootDir, 'apps/server/templates/configw/development.yaml', 'app:\n  env: "development"\n');
  await writeWorkspaceFile(rootDir, 'apps/server/templates/configw/production.yaml', 'app:\n  env: "production"\n');
  await writeWorkspaceFile(rootDir, 'apps/server/templates/configw/test.yaml', 'app:\n  env: "test"\n');

  for (const [relativePath, content] of Object.entries(files)) {
    await writeWorkspaceFile(rootDir, relativePath, content);
  }

  return rootDir;
};

const defaultYamlBase = [
  'config_version: 1',
  'app:',
  '  name: "Yidhras"',
  '  env: "test"',
  '  port: 3001',
  'paths:',
  '  world_packs_dir: "data/world_packs"',
  '  assets_dir: "data/assets"',
  '  plugins_dir: "data/plugins"',
  '  ai_models_config: "apps/server/config/ai_models.yaml"',
  'plugins:',
  '  enable_warning:',
  '    enabled: true',
  '    require_acknowledgement: true',
  'world:',
  '  preferred_pack: "example_pack"',
  '  bootstrap:',
  '    enabled: false',
  '    target_pack_dir: "example_pack"',
  '    template_file: "data/configw/templates/world-pack/example_pack.yaml"',
  '    overwrite: false',
  'startup:',
  '  allow_degraded_mode: true',
  '  fail_on_missing_world_pack_dir: false',
  '  fail_on_no_world_pack: false',
  'scheduler:',
  '  enabled: true',
  '  runtime:',
  '    simulation_loop_interval_ms: 1500',
  '  lease_ticks: 5',
  '  entity_concurrency:',
  '    default_max_active_workflows_per_entity: 1',
  '    max_entity_activations_per_tick: 1',
  '    allow_parallel_decision_per_entity: false',
  '    allow_parallel_action_per_entity: false',
  '    event_followup_preempts_periodic: true',
  '  tick_budget:',
  '    max_created_jobs_per_tick: 32',
  '    max_executed_decisions_per_tick: 16',
  '    max_dispatched_actions_per_tick: 16',
  '  automatic_rebalance:',
  '    backlog_limit: 2',
  '    max_recommendations: 1',
  '    max_apply: 1',
  '  runners:',
  '    decision_job:',
  '      batch_limit: 6',
  '      concurrency: 3',
  '      lock_ticks: 7',
  '    action_dispatcher:',
  '      batch_limit: 8',
  '      concurrency: 2',
  '      lock_ticks: 9',
  '  observability:',
  '    default_query_limit: 25',
  '    max_query_limit: 150',
  '    summary:',
  '      default_sample_runs: 30',
  '      max_sample_runs: 130',
  '    trends:',
  '      default_sample_runs: 40',
  '      max_sample_runs: 140',
  '    operator_projection:',
  '      default_sample_runs: 50',
  '      max_sample_runs: 150',
  '      default_recent_limit: 7',
  '      max_recent_limit: 27',
  '  agent:',
  '    limit: 7',
  '    cooldown_ticks: 4',
  '    max_candidates: 33',
  '    signal_policy:',
  '      event_followup:',
  '        priority_score: 30',
  '        delay_ticks: 2',
  '        coalesce_window_ticks: 3',
  '        suppression_tier: "high"',
  '      relationship_change_followup:',
  '        priority_score: 21',
  '        delay_ticks: 2',
  '        coalesce_window_ticks: 3',
  '        suppression_tier: "low"',
  '      snr_change_followup:',
  '        priority_score: 11',
  '        delay_ticks: 2',
  '        coalesce_window_ticks: 3',
  '        suppression_tier: "low"',
  '      overlay_change_followup:',
  '        priority_score: 9',
  '        delay_ticks: 2',
  '        coalesce_window_ticks: 3',
  '        suppression_tier: "low"',
  '      memory_change_followup:',
  '        priority_score: 10',
  '        delay_ticks: 2',
  '        coalesce_window_ticks: 3',
  '        suppression_tier: "low"',
  '    recovery_suppression:',
  '      replay:',
  '        suppress_periodic: true',
  '        suppress_event_tiers: ["low"]',
  '      retry:',
  '        suppress_periodic: false',
  '        suppress_event_tiers: ["high", "low"]',
  '  memory:',
  '    trigger_engine:',
  '      mode: "rust_primary"',
  '      timeout_ms: 700',
  '      binary_path: "apps/server/rust/memory_trigger_sidecar/target/debug/memory_trigger_sidecar"',
  '      auto_restart: false',
  'world_engine:',
  '  timeout_ms: 1200',
  '  binary_path: "apps/server/rust/world_engine_sidecar/target/debug/world_engine_sidecar"',
  '  auto_restart: false',
  'prompt_workflow:',
  '  profiles:',
  '    agent_decision_default:',
  '      token_budget: 2600',
  '      section_policy: "expanded"',
  '    context_summary_default:',
  '      token_budget: 1700',
  '      section_policy: "minimal"',
  '    memory_compaction_default:',
  '      token_budget: 1900',
  '      section_policy: "minimal"',
  'runtime:',
  '  multi_pack:',
  '    max_loaded_packs: 2',
  '    start_mode: "manual"',
  '    bootstrap_packs: ["death_note", "test_pack"]',
  'features:',
  '  inference_trace: true',
  '  notifications: true',
  '  experimental:',
  '    multi_pack_runtime:',
  '      enabled: false',
  '      operator_api_enabled: false',
  '      ui_enabled: false'
].join('\n') + '\n';

afterEach(async () => {
  resetRuntimeConfigCache();
  delete process.env.WORKSPACE_ROOT;
  delete process.env.SIM_LOOP_INTERVAL_MS;
  delete process.env.SCHEDULER_AGENT_LIMIT;
  delete process.env.SCHEDULER_AGENT_COOLDOWN_TICKS;
  delete process.env.SCHEDULER_ENTITY_DEFAULT_MAX_ACTIVE_WORKFLOWS_PER_ENTITY;
  delete process.env.SCHEDULER_ENTITY_MAX_ACTIVATIONS_PER_TICK;
  delete process.env.SCHEDULER_ALLOW_PARALLEL_DECISION_PER_ENTITY;
  delete process.env.SCHEDULER_ALLOW_PARALLEL_ACTION_PER_ENTITY;
  delete process.env.SCHEDULER_EVENT_FOLLOWUP_PREEMPTS_PERIODIC;
  delete process.env.SCHEDULER_DECISION_JOB_BATCH_LIMIT;
  delete process.env.SCHEDULER_DECISION_JOB_CONCURRENCY;
  delete process.env.SCHEDULER_DECISION_JOB_LOCK_TICKS;
  delete process.env.SCHEDULER_ACTION_DISPATCHER_BATCH_LIMIT;
  delete process.env.SCHEDULER_ACTION_DISPATCHER_CONCURRENCY;
  delete process.env.SCHEDULER_ACTION_DISPATCHER_LOCK_TICKS;
  delete process.env.SCHEDULER_TICK_BUDGET_MAX_CREATED_JOBS;
  delete process.env.SCHEDULER_TICK_BUDGET_MAX_EXECUTED_DECISIONS;
  delete process.env.SCHEDULER_TICK_BUDGET_MAX_DISPATCHED_ACTIONS;
  delete process.env.SCHEDULER_LEASE_TICKS;
  delete process.env.SCHEDULER_AUTOMATIC_REBALANCE_BACKLOG_LIMIT;
  delete process.env.SCHEDULER_AUTOMATIC_REBALANCE_MAX_RECOMMENDATIONS;
  delete process.env.SCHEDULER_AUTOMATIC_REBALANCE_MAX_APPLY;
  delete process.env.SCHEDULER_DEFAULT_QUERY_LIMIT;
  delete process.env.SCHEDULER_MAX_QUERY_LIMIT;
  delete process.env.SCHEDULER_SUMMARY_DEFAULT_SAMPLE_RUNS;
  delete process.env.SCHEDULER_SUMMARY_MAX_SAMPLE_RUNS;
  delete process.env.SCHEDULER_OPERATOR_DEFAULT_RECENT_LIMIT;
  delete process.env.SCHEDULER_OPERATOR_MAX_RECENT_LIMIT;
  delete process.env.MEMORY_TRIGGER_ENGINE_MODE;
  delete process.env.MEMORY_TRIGGER_ENGINE_TIMEOUT_MS;
  delete process.env.MEMORY_TRIGGER_ENGINE_BINARY_PATH;
  delete process.env.MEMORY_TRIGGER_ENGINE_AUTO_RESTART;
  delete process.env.EXPERIMENTAL_MULTI_PACK_RUNTIME_ENABLED;
  delete process.env.EXPERIMENTAL_MULTI_PACK_RUNTIME_OPERATOR_API_ENABLED;
  delete process.env.EXPERIMENTAL_MULTI_PACK_RUNTIME_UI_ENABLED;
  delete process.env.WORLD_ENGINE_TIMEOUT_MS;
  delete process.env.WORLD_ENGINE_BINARY_PATH;
  delete process.env.WORLD_ENGINE_AUTO_RESTART;
  delete process.env.AI_GATEWAY_ENABLED;
  delete process.env.RUNTIME_MULTI_PACK_MAX_LOADED_PACKS;
  delete process.env.RUNTIME_MULTI_PACK_START_MODE;
  delete process.env.RUNTIME_MULTI_PACK_BOOTSTRAP_PACKS;
  delete process.env.SQLITE_BUSY_TIMEOUT_MS;
  delete process.env.SQLITE_WAL_AUTOCHECKPOINT_PAGES;
  delete process.env.SQLITE_SYNCHRONOUS;

  const { rm } = await import('node:fs/promises');
  for (const root of createdRoots.splice(0, createdRoots.length)) {
    await rm(root, { force: true, recursive: true });
  }
});

describe('runtime config YAML migration', () => {
  it('loads scheduler runtime, prompt workflow defaults, and experimental multi-pack settings from YAML', async () => {
    const rootDir = await createWorkspace({
      'data/configw/test.yaml': defaultYamlBase
    });

    process.env.WORKSPACE_ROOT = rootDir;

    const config = getRuntimeConfig();

    expect(getDatabaseConfig().sqlite).toMatchObject({
      busy_timeout_ms: 5000,
      wal_autocheckpoint_pages: 1000,
      synchronous: 'NORMAL'
    });
    expect(getSimulationLoopIntervalMs()).toBe(1500);
    expect(getSchedulerLeaseTicks()).toBe(5n);
    expect(getSchedulerEntityConcurrencyConfig()).toMatchObject({
      default_max_active_workflows_per_entity: 1,
      max_entity_activations_per_tick: 1,
      allow_parallel_decision_per_entity: false,
      allow_parallel_action_per_entity: false,
      event_followup_preempts_periodic: true
    });
    expect(getSchedulerTickBudgetConfig()).toMatchObject({
      max_created_jobs_per_tick: 32,
      max_executed_decisions_per_tick: 16,
      max_dispatched_actions_per_tick: 16
    });
    expect(getSchedulerAutomaticRebalanceConfig()).toMatchObject({
      backlog_limit: 2,
      max_recommendations: 1,
      max_apply: 1
    });
    expect(getSchedulerRunnerConfig()).toMatchObject({
      decision_job: { batch_limit: 6, concurrency: 3, lock_ticks: 7 },
      action_dispatcher: { batch_limit: 8, concurrency: 2, lock_ticks: 9 }
    });
    expect(getSchedulerObservabilityConfig()).toMatchObject({
      default_query_limit: 25,
      max_query_limit: 150,
      summary: { default_sample_runs: 30, max_sample_runs: 130 },
      trends: { default_sample_runs: 40, max_sample_runs: 140 },
      operator_projection: {
        default_sample_runs: 50,
        max_sample_runs: 150,
        default_recent_limit: 7,
        max_recent_limit: 27
      }
    });
    expect(getSchedulerAgentConfig()).toMatchObject({
      limit: 7,
      cooldown_ticks: 4,
      max_candidates: 33
    });
    expect(getMemoryTriggerEngineConfig()).toEqual({
      mode: 'rust_primary',
      timeout_ms: 700,
      binary_path: 'apps/server/rust/memory_trigger_sidecar/target/debug/memory_trigger_sidecar',
      auto_restart: false
    });
    expect(getWorldEngineConfig()).toEqual({
      timeout_ms: 1200,
      binary_path: 'apps/server/rust/world_engine_sidecar/target/debug/world_engine_sidecar',
      auto_restart: false
    });
    expect(getRuntimeMultiPackConfig()).toMatchObject({
      max_loaded_packs: 2,
      start_mode: 'manual',
      bootstrap_packs: ['death_note', 'test_pack']
    });
    expect(getExperimentalMultiPackRuntimeConfig()).toMatchObject({
      enabled: false,
      operator_api_enabled: false,
      ui_enabled: false
    });
    expect(isAiGatewayEnabled()).toBe(false);
    expect(isExperimentalMultiPackRuntimeEnabled()).toBe(false);
    expect(isExperimentalMultiPackOperatorApiEnabled()).toBe(false);
    expect(config.prompt_workflow.profiles.agent_decision_default).toMatchObject({
      token_budget: 2600,
      section_policy: 'expanded'
    });
    expect(config.scheduler.agent.signal_policy.event_followup.delay_ticks).toBe(2);
    expect(config.scheduler.agent.recovery_suppression.retry.suppress_periodic).toBe(false);
  });

  it('allows env to override migrated scheduler YAML values and world engine runtime settings', async () => {
    const rootDir = await createWorkspace({
      'data/configw/default.yaml': defaultYamlBase
    });

    process.env.WORKSPACE_ROOT = rootDir;
    process.env.SQLITE_BUSY_TIMEOUT_MS = '8000';
    process.env.SQLITE_WAL_AUTOCHECKPOINT_PAGES = '1200';
    process.env.SQLITE_SYNCHRONOUS = 'FULL';
    process.env.SIM_LOOP_INTERVAL_MS = '2500';
    process.env.SCHEDULER_LEASE_TICKS = '9';
    process.env.SCHEDULER_AUTOMATIC_REBALANCE_BACKLOG_LIMIT = '4';
    process.env.SCHEDULER_AUTOMATIC_REBALANCE_MAX_RECOMMENDATIONS = '3';
    process.env.SCHEDULER_AUTOMATIC_REBALANCE_MAX_APPLY = '2';
    process.env.SCHEDULER_ENTITY_DEFAULT_MAX_ACTIVE_WORKFLOWS_PER_ENTITY = '2';
    process.env.SCHEDULER_ENTITY_MAX_ACTIVATIONS_PER_TICK = '3';
    process.env.SCHEDULER_ALLOW_PARALLEL_DECISION_PER_ENTITY = 'true';
    process.env.SCHEDULER_ALLOW_PARALLEL_ACTION_PER_ENTITY = 'true';
    process.env.SCHEDULER_EVENT_FOLLOWUP_PREEMPTS_PERIODIC = 'false';
    process.env.SCHEDULER_TICK_BUDGET_MAX_CREATED_JOBS = '48';
    process.env.SCHEDULER_TICK_BUDGET_MAX_EXECUTED_DECISIONS = '24';
    process.env.SCHEDULER_TICK_BUDGET_MAX_DISPATCHED_ACTIONS = '12';
    process.env.SCHEDULER_DECISION_JOB_BATCH_LIMIT = '12';
    process.env.SCHEDULER_DECISION_JOB_CONCURRENCY = '6';
    process.env.SCHEDULER_DECISION_JOB_LOCK_TICKS = '13';
    process.env.SCHEDULER_ACTION_DISPATCHER_BATCH_LIMIT = '14';
    process.env.SCHEDULER_ACTION_DISPATCHER_CONCURRENCY = '4';
    process.env.SCHEDULER_ACTION_DISPATCHER_LOCK_TICKS = '15';
    process.env.SCHEDULER_DEFAULT_QUERY_LIMIT = '26';
    process.env.SCHEDULER_MAX_QUERY_LIMIT = '160';
    process.env.SCHEDULER_SUMMARY_DEFAULT_SAMPLE_RUNS = '31';
    process.env.SCHEDULER_SUMMARY_MAX_SAMPLE_RUNS = '131';
    process.env.SCHEDULER_OPERATOR_DEFAULT_RECENT_LIMIT = '8';
    process.env.SCHEDULER_OPERATOR_MAX_RECENT_LIMIT = '28';
    process.env.MEMORY_TRIGGER_ENGINE_MODE = 'rust_primary';
    process.env.MEMORY_TRIGGER_ENGINE_TIMEOUT_MS = '900';
    process.env.MEMORY_TRIGGER_ENGINE_BINARY_PATH = 'custom/memory-trigger';
    process.env.MEMORY_TRIGGER_ENGINE_AUTO_RESTART = 'true';
    process.env.SCHEDULER_AGENT_LIMIT = '11';
    process.env.SCHEDULER_AGENT_COOLDOWN_TICKS = '6';
    process.env.EXPERIMENTAL_MULTI_PACK_RUNTIME_ENABLED = 'true';
    process.env.EXPERIMENTAL_MULTI_PACK_RUNTIME_OPERATOR_API_ENABLED = 'true';
    process.env.EXPERIMENTAL_MULTI_PACK_RUNTIME_UI_ENABLED = 'false';
    process.env.WORLD_ENGINE_TIMEOUT_MS = '1300';
    process.env.WORLD_ENGINE_BINARY_PATH = 'custom/world-engine';
    process.env.WORLD_ENGINE_AUTO_RESTART = 'false';
    process.env.RUNTIME_MULTI_PACK_MAX_LOADED_PACKS = '4';
    process.env.RUNTIME_MULTI_PACK_START_MODE = 'bootstrap_list';
    process.env.RUNTIME_MULTI_PACK_BOOTSTRAP_PACKS = 'death_note,test_pack';

    expect(getDatabaseConfig().sqlite).toMatchObject({ busy_timeout_ms: 8000, wal_autocheckpoint_pages: 1200, synchronous: 'FULL' });
    expect(getSimulationLoopIntervalMs()).toBe(2500);
    expect(getSchedulerLeaseTicks()).toBe(9n);
    expect(getSchedulerEntityConcurrencyConfig()).toMatchObject({
      default_max_active_workflows_per_entity: 2,
      max_entity_activations_per_tick: 3,
      allow_parallel_decision_per_entity: true,
      allow_parallel_action_per_entity: true,
      event_followup_preempts_periodic: false
    });
    expect(getSchedulerTickBudgetConfig()).toMatchObject({
      max_created_jobs_per_tick: 48,
      max_executed_decisions_per_tick: 24,
      max_dispatched_actions_per_tick: 12
    });
    expect(getSchedulerAutomaticRebalanceConfig()).toMatchObject({ backlog_limit: 4, max_recommendations: 3, max_apply: 2 });
    expect(getSchedulerRunnerConfig()).toMatchObject({
      decision_job: { batch_limit: 12, concurrency: 6, lock_ticks: 13 },
      action_dispatcher: { batch_limit: 14, concurrency: 4, lock_ticks: 15 }
    });
    expect(getSchedulerObservabilityConfig()).toMatchObject({
      default_query_limit: 26,
      max_query_limit: 160,
      summary: { default_sample_runs: 31, max_sample_runs: 131 },
      trends: { default_sample_runs: 31, max_sample_runs: 131 },
      operator_projection: {
        default_sample_runs: 31,
        max_sample_runs: 131,
        default_recent_limit: 8,
        max_recent_limit: 28
      }
    });
    expect(getSchedulerAgentConfig().limit).toBe(11);
    expect(getSchedulerAgentConfig().cooldown_ticks).toBe(6);
    expect(getMemoryTriggerEngineConfig()).toEqual({
      mode: 'rust_primary',
      timeout_ms: 900,
      binary_path: 'custom/memory-trigger',
      auto_restart: true
    });
    expect(getWorldEngineConfig()).toEqual({
      timeout_ms: 1300,
      binary_path: 'custom/world-engine',
      auto_restart: false
    });
    expect(getRuntimeMultiPackConfig()).toMatchObject({
      max_loaded_packs: 4,
      start_mode: 'bootstrap_list',
      bootstrap_packs: ['death_note', 'test_pack']
    });
    expect(getExperimentalMultiPackRuntimeConfig()).toMatchObject({
      enabled: true,
      operator_api_enabled: true,
      ui_enabled: false
    });
    expect(isExperimentalMultiPackRuntimeEnabled()).toBe(true);
    expect(isExperimentalMultiPackOperatorApiEnabled()).toBe(true);
  });

  it('allows AI gateway to be re-enabled via environment override', async () => {
    const rootDir = await createWorkspace({
      'data/configw/default.yaml': defaultYamlBase
    });

    process.env.WORKSPACE_ROOT = rootDir;
    process.env.AI_GATEWAY_ENABLED = 'true';

    expect(isAiGatewayEnabled()).toBe(true);
  });

  it('defaults AI gateway to disabled when no override is provided', async () => {
    const rootDir = await createWorkspace({
      'data/configw/default.yaml': defaultYamlBase
    });

    process.env.WORKSPACE_ROOT = rootDir;

    expect(isAiGatewayEnabled()).toBe(false);
  });
});
