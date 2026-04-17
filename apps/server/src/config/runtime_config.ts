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
  scheduler: {
    enabled: true
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
    plugin_enable_warning_enabled: String(config.plugins.enable_warning.enabled),
    bootstrap_enabled: String(bootstrap.enabled),
    plugin_enable_warning_require_acknowledgement: String(config.plugins.enable_warning.require_acknowledgement),
    bootstrap_target_pack_dir: bootstrap.targetPackDirName,
    bootstrap_template_file: bootstrap.templateFilePath,
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
