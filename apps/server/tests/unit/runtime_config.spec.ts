import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  getRuntimeConfig,
  getSchedulerAgentConfig,
  getSchedulerAutomaticRebalanceConfig,
  getSchedulerLeaseTicks,
  getSchedulerObservabilityConfig,
  getSchedulerRunnerConfig,
  getSimulationLoopIntervalMs,
  getSqliteRuntimeConfig,
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
  await writeWorkspaceFile(rootDir, 'apps/server/templates/world-pack/death_note.yaml', 'metadata:\n  id: death_note\n');
  await writeWorkspaceFile(rootDir, 'apps/server/templates/world-pack/death_note.README.md', '# death_note\n');
  await writeWorkspaceFile(rootDir, 'apps/server/templates/world-pack/death_note.CHANGELOG.md', '# changelog\n');
  await writeWorkspaceFile(rootDir, 'apps/server/templates/configw/default.yaml', 'config_version: 1\n');
  await writeWorkspaceFile(rootDir, 'apps/server/templates/configw/development.yaml', 'app:\n  env: "development"\n');
  await writeWorkspaceFile(rootDir, 'apps/server/templates/configw/production.yaml', 'app:\n  env: "production"\n');
  await writeWorkspaceFile(rootDir, 'apps/server/templates/configw/test.yaml', 'app:\n  env: "test"\n');

  for (const [relativePath, content] of Object.entries(files)) {
    await writeWorkspaceFile(rootDir, relativePath, content);
  }

  return rootDir;
};

afterEach(async () => {
  resetRuntimeConfigCache();
  delete process.env.WORKSPACE_ROOT;
  delete process.env.SIM_LOOP_INTERVAL_MS;
  delete process.env.SCHEDULER_AGENT_LIMIT;
  delete process.env.SCHEDULER_AGENT_COOLDOWN_TICKS;

  const { rm } = await import('node:fs/promises');
  for (const root of createdRoots.splice(0, createdRoots.length)) {
    await rm(root, { force: true, recursive: true });
  }
});

describe('runtime config YAML migration', () => {
  it('loads scheduler runtime and prompt workflow defaults from YAML', async () => {
    const rootDir = await createWorkspace({
      'data/configw/default.yaml': [
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
        '  preferred_pack: "death_note"',
        '  bootstrap:',
        '    enabled: false',
        '    target_pack_dir: "death_note"',
        '    template_file: "data/configw/templates/world-pack/death_note.yaml"',
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
        '  automatic_rebalance:',
        '    backlog_limit: 2',
        '    max_recommendations: 1',
        '    max_apply: 1',
        '  runners:',
        '    decision_job:',
        '      batch_limit: 6',
        '      lock_ticks: 7',
        '    action_dispatcher:',
        '      batch_limit: 8',
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
        'prompt_workflow:',
        '  profiles:',
        '    agent_decision_default:',
        '      token_budget: 2600',
        '      section_policy: "expanded"',
        '      compatibility_mode: "full"',
        '    context_summary_default:',
        '      token_budget: 1700',
        '      section_policy: "minimal"',
        '      compatibility_mode: "bridge_only"',
        '    memory_compaction_default:',
        '      token_budget: 1900',
        '      section_policy: "minimal"',
        '      compatibility_mode: "bridge_only"',
        'features:',
        '  inference_trace: true',
        '  notifications: true'
      ].join('\n') + '\n'
    });

    process.env.WORKSPACE_ROOT = rootDir;

    const config = getRuntimeConfig();

    expect(getSqliteRuntimeConfig()).toMatchObject({
      busy_timeout_ms: 5000,
      wal_autocheckpoint_pages: 1000,
      synchronous: 'NORMAL'
    });
    expect(getSimulationLoopIntervalMs()).toBe(1500);
    expect(getSchedulerLeaseTicks()).toBe(5n);
    expect(getSchedulerAutomaticRebalanceConfig()).toMatchObject({
      backlog_limit: 2,
      max_recommendations: 1,
      max_apply: 1
    });
    expect(getSchedulerRunnerConfig()).toMatchObject({
      decision_job: { batch_limit: 6, lock_ticks: 7 },
      action_dispatcher: { batch_limit: 8, lock_ticks: 9 }
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
    expect(config.prompt_workflow.profiles.agent_decision_default).toMatchObject({
      token_budget: 2600,
      section_policy: 'expanded',
      compatibility_mode: 'full'
    });
    expect(config.scheduler.agent.signal_policy.event_followup.delay_ticks).toBe(2);
    expect(config.scheduler.agent.recovery_suppression.retry.suppress_periodic).toBe(false);
  });

  it('allows env to override migrated scheduler YAML values', async () => {
    const rootDir = await createWorkspace({
      'data/configw/default.yaml': [
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
        '  preferred_pack: "death_note"',
        '  bootstrap:',
        '    enabled: false',
        '    target_pack_dir: "death_note"',
        '    template_file: "data/configw/templates/world-pack/death_note.yaml"',
        '    overwrite: false',
        'startup:',
        '  allow_degraded_mode: true',
        '  fail_on_missing_world_pack_dir: false',
        '  fail_on_no_world_pack: false',
        'scheduler:',
        '  enabled: true',
        '  runtime:',
        '    simulation_loop_interval_ms: 1000',
        '  lease_ticks: 5',
        '  automatic_rebalance:',
        '    backlog_limit: 2',
        '    max_recommendations: 1',
        '    max_apply: 1',
        '  runners:',
        '    decision_job:',
        '      batch_limit: 5',
        '      lock_ticks: 5',
        '    action_dispatcher:',
        '      batch_limit: 5',
        '      lock_ticks: 5',
        '  observability:',
        '    default_query_limit: 20',
        '    max_query_limit: 100',
        '    summary:',
        '      default_sample_runs: 20',
        '      max_sample_runs: 100',
        '    trends:',
        '      default_sample_runs: 20',
        '      max_sample_runs: 100',
        '    operator_projection:',
        '      default_sample_runs: 20',
        '      max_sample_runs: 100',
        '      default_recent_limit: 5',
        '      max_recent_limit: 20',
        '  agent:',
        '    limit: 5',
        '    cooldown_ticks: 3',
        '    max_candidates: 20',
        '    signal_policy:',
        '      event_followup: { priority_score: 30, delay_ticks: 1, coalesce_window_ticks: 2, suppression_tier: "high" }',
        '      relationship_change_followup: { priority_score: 20, delay_ticks: 1, coalesce_window_ticks: 2, suppression_tier: "low" }',
        '      snr_change_followup: { priority_score: 10, delay_ticks: 1, coalesce_window_ticks: 2, suppression_tier: "low" }',
        '      overlay_change_followup: { priority_score: 8, delay_ticks: 1, coalesce_window_ticks: 2, suppression_tier: "low" }',
        '      memory_change_followup: { priority_score: 9, delay_ticks: 1, coalesce_window_ticks: 2, suppression_tier: "low" }',
        '    recovery_suppression:',
        '      replay: { suppress_periodic: true, suppress_event_tiers: ["low"] }',
        '      retry: { suppress_periodic: true, suppress_event_tiers: ["low"] }',
        'prompt_workflow:',
        '  profiles:',
        '    agent_decision_default: { token_budget: 2200, section_policy: "standard", compatibility_mode: "full" }',
        '    context_summary_default: { token_budget: 1600, section_policy: "minimal", compatibility_mode: "bridge_only" }',
        '    memory_compaction_default: { token_budget: 1800, section_policy: "minimal", compatibility_mode: "bridge_only" }',
        'features:',
        '  inference_trace: true',
        '  notifications: true'
      ].join('\n') + '\n'
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
    process.env.SCHEDULER_DECISION_JOB_BATCH_LIMIT = '12';
    process.env.SCHEDULER_DECISION_JOB_LOCK_TICKS = '13';
    process.env.SCHEDULER_ACTION_DISPATCHER_BATCH_LIMIT = '14';
    process.env.SCHEDULER_ACTION_DISPATCHER_LOCK_TICKS = '15';
    process.env.SCHEDULER_DEFAULT_QUERY_LIMIT = '26';
    process.env.SCHEDULER_MAX_QUERY_LIMIT = '160';
    process.env.SCHEDULER_SUMMARY_DEFAULT_SAMPLE_RUNS = '31';
    process.env.SCHEDULER_SUMMARY_MAX_SAMPLE_RUNS = '131';
    process.env.SCHEDULER_OPERATOR_DEFAULT_RECENT_LIMIT = '8';
    process.env.SCHEDULER_OPERATOR_MAX_RECENT_LIMIT = '28';
    process.env.SCHEDULER_AGENT_LIMIT = '11';
    process.env.SCHEDULER_AGENT_COOLDOWN_TICKS = '6';

    expect(getSqliteRuntimeConfig()).toMatchObject({ busy_timeout_ms: 8000, wal_autocheckpoint_pages: 1200, synchronous: 'FULL' });
    expect(getSimulationLoopIntervalMs()).toBe(2500);
    expect(getSchedulerLeaseTicks()).toBe(9n);
    expect(getSchedulerAutomaticRebalanceConfig()).toMatchObject({ backlog_limit: 4, max_recommendations: 3, max_apply: 2 });
    expect(getSchedulerRunnerConfig()).toMatchObject({
      decision_job: { batch_limit: 12, lock_ticks: 13 },
      action_dispatcher: { batch_limit: 14, lock_ticks: 15 }
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
  });
});
