import { z } from 'zod';

import { APP_DEFAULTS,AppConfigSchema } from './app.js';
import { CLOCK_DEFAULTS, ClockConfigSchema } from './clock.js';
import { FEATURES_DEFAULTS, FeaturesConfigSchema } from './features.js';
import { LOGGING_DEFAULTS, LoggingConfigSchema } from './logging.js';
import { OPERATOR_DEFAULTS, OperatorConfigSchema } from './operator.js';
import { PATHS_DEFAULTS, PathsConfigSchema } from './paths.js';
import { PLUGINS_DEFAULTS, PluginsConfigSchema } from './plugins.js';
import { PROMPT_WORKFLOW_DEFAULTS, PromptWorkflowConfigSchema } from './prompt_workflow.js';
import { RUNTIME_DEFAULTS, RuntimeConfig_DomainSchema } from './runtime.js';
import { SCHEDULER_DEFAULTS, SchedulerConfigSchema } from './scheduler.js';
import { SQLITE_DEFAULTS, SqliteConfigSchema } from './sqlite.js';
import { STARTUP_DEFAULTS, StartupConfigSchema } from './startup.js';
import { WORLD_DEFAULTS, WorldConfigSchema } from './world.js';
import { WORLD_ENGINE_DEFAULTS, WorldEngineConfigSchema } from './world_engine.js';

export const RuntimeConfigSchema = z
  .object({
    config_version: z.number().int().positive(),
    app: AppConfigSchema,
    paths: PathsConfigSchema,
    operator: OperatorConfigSchema,
    plugins: PluginsConfigSchema,
    world: WorldConfigSchema,
    world_engine: WorldEngineConfigSchema,
    startup: StartupConfigSchema,
    sqlite: SqliteConfigSchema,
    logging: LoggingConfigSchema,
    clock: ClockConfigSchema,
    scheduler: SchedulerConfigSchema,
    prompt_workflow: PromptWorkflowConfigSchema,
    runtime: RuntimeConfig_DomainSchema,
    features: FeaturesConfigSchema
  })
  .strict();

export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;

export const BUILTIN_DEFAULTS: RuntimeConfig = {
  config_version: 1,
  app: APP_DEFAULTS,
  paths: PATHS_DEFAULTS,
  operator: OPERATOR_DEFAULTS,
  plugins: PLUGINS_DEFAULTS,
  world: WORLD_DEFAULTS,
  world_engine: WORLD_ENGINE_DEFAULTS,
  startup: STARTUP_DEFAULTS,
  sqlite: SQLITE_DEFAULTS,
  logging: LOGGING_DEFAULTS,
  clock: CLOCK_DEFAULTS,
  scheduler: SCHEDULER_DEFAULTS,
  prompt_workflow: PROMPT_WORKFLOW_DEFAULTS,
  runtime: RUNTIME_DEFAULTS,
  features: FEATURES_DEFAULTS
};

export {
  APP_DEFAULTS,
  AppConfigSchema,
  CLOCK_DEFAULTS,
  ClockConfigSchema,
  FEATURES_DEFAULTS,
  FeaturesConfigSchema,
  LOGGING_DEFAULTS,
  LoggingConfigSchema,
  OPERATOR_DEFAULTS,
  OperatorConfigSchema,
  PATHS_DEFAULTS,
  PathsConfigSchema,
  PLUGINS_DEFAULTS,
  PluginsConfigSchema,
  PROMPT_WORKFLOW_DEFAULTS,
  PromptWorkflowConfigSchema,
  RUNTIME_DEFAULTS,
  RuntimeConfig_DomainSchema,
  SCHEDULER_DEFAULTS,
  SchedulerConfigSchema,
  SQLITE_DEFAULTS,
  SqliteConfigSchema,
  STARTUP_DEFAULTS,
  StartupConfigSchema,
  WORLD_DEFAULTS,
  WORLD_ENGINE_DEFAULTS,
  WorldConfigSchema,
  WorldEngineConfigSchema
};

export type { AppConfig } from './app.js';
export type { ClockConfig } from './clock.js';
export type { FeaturesConfig } from './features.js';
export type { LoggingConfig } from './logging.js';
export type { OperatorConfig } from './operator.js';
export type { PathsConfig } from './paths.js';
export type { PluginsConfig } from './plugins.js';
export type { PromptWorkflowConfig } from './prompt_workflow.js';
export type { RuntimeConfig_Domain } from './runtime.js';
export type { SchedulerConfig } from './scheduler.js';
export type { SqliteConfig } from './sqlite.js';
export type { StartupConfig } from './startup.js';
export type { WorldConfig } from './world.js';
export type { WorldEngineConfig } from './world_engine.js';
