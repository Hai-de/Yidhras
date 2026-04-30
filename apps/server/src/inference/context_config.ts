import path from 'path';

import { loadConfigYaml, readYamlFileIfExists, resolveWorkspaceRoot } from '../config/loader.js';
import { deepMerge } from '../config/merge.js';
import { ApiError } from '../utils/api_error.js';
import {
  type InferenceContextConfig,
  inferenceContextConfigSchema
} from './context_config_schema.js';

const CONFIG_BASENAME = 'inference_context.yaml';
const CONFIG_DIR_RELATIVE_PATH = path.join('data', 'configw');
const DEPLOYMENT_CONFIG_DIRNAME = 'inference_context.d';
const DEPLOYMENT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

const BUILTIN_DEFAULTS: InferenceContextConfig = {
  config_version: 1,
  variable_context: {
    layers: {
      system: {
        enabled: true,
        values: {
          name: 'Yidhras',
          timezone: 'Asia/Shanghai'
        },
        alias_values: {
          system_name: '{{name}}',
          timezone: '{{timezone}}'
        }
      },
      app: {
        enabled: true,
        values: {
          startup_health: '{{app.startup_health}}'
        },
        alias_values: {
          startup_level: '{{app.startup_health.level}}'
        }
      },
      pack: {
        enabled: true,
        values: {
          metadata: '{{pack.metadata}}',
          variables: '{{pack.variables}}',
          prompts: '{{pack.prompts}}',
          ai: '{{pack.ai}}'
        },
        alias_values: {
          world_name: '{{pack.metadata.name}}',
          pack_id: '{{pack.metadata.id}}',
          pack_name: '{{pack.metadata.name}}'
        }
      },
      runtime: {
        enabled: true,
        values: {
          current_tick: '{{runtime.current_tick}}',
          pack_state: '{{runtime.pack_state}}',
          pack_runtime: '{{runtime.pack_runtime}}',
          world_state: '{{runtime.pack_state.world_state}}',
          owned_artifacts: '{{runtime.pack_state.owned_artifacts}}',
          latest_event: '{{runtime.pack_state.latest_event}}'
        },
        alias_values: {
          current_tick: '{{runtime.current_tick}}',
          world_state: '{{runtime.pack_state.world_state}}',
          latest_event: '{{runtime.pack_state.latest_event}}',
          owned_artifacts: '{{runtime.pack_state.owned_artifacts}}'
        }
      },
      actor: {
        enabled: true,
        values: {
          identity_id: '{{actor.identity.id}}',
          identity_type: '{{actor.identity.type}}',
          display_name: '{{actor.display_name}}',
          role: '{{actor.role}}',
          binding_ref: '{{actor.binding_ref}}',
          agent_id: '{{actor.agent_id}}',
          agent_snapshot: '{{actor.agent_snapshot}}'
        },
        alias_values: {
          actor_name: '{{actor.display_name}}',
          actor_role: '{{actor.role}}',
          actor_id: '{{actor.agent_id ?? actor.identity.id}}',
          identity_id: '{{actor.identity.id}}'
        }
      },
      request: {
        enabled: true,
        values: {
          task_type: 'agent_decision',
          strategy: '{{request.strategy}}',
          attributes: '{{request.attributes}}',
          agent_id: '{{request.agent_id}}',
          identity_id: '{{request.identity_id}}',
          idempotency_key: '{{request.idempotency_key}}'
        },
        alias_values: {
          strategy: '{{request.strategy}}',
          task_type: 'agent_decision',
          request_agent_id: '{{request.agent_id}}',
          request_identity_id: '{{request.identity_id}}'
        }
      }
    }
  },
  transmission_profile: {
    defaults: {
      snr_fallback: 0.5,
      delay_ticks_fallback: '1'
    },
    thresholds: {
      fragile_snr: 0.3
    },
    drop_chances: {
      fragile: 0.35,
      best_effort: 0.15,
      reliable: 0.0
    },
    policies: {
      read_restricted_base: 'best_effort',
      low_snr_base: 'fragile',
      default_base: 'reliable'
    }
  },
  policy_summary: {
    evaluations: [
      {
        resource: 'social_post',
        action: 'read',
        fields: [
          'id',
          'author_id',
          'content',
          'created_at',
          'content.private.preview',
          'content.private.raw'
        ]
      },
      {
        resource: 'social_post',
        action: 'write',
        fields: ['content']
      }
    ]
  }
};

interface ConfigCacheEntry {
  config: InferenceContextConfig;
  loadedFile: string | null;
}

let globalCache: ConfigCacheEntry | null = null;
const deploymentCaches = new Map<string, ConfigCacheEntry>();

const parseNumberEnv = (name: string, value: string | undefined): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    return undefined;
  }
  const parsed = Number(normalized);
  if (Number.isNaN(parsed)) {
    throw new Error(`[inference_context_config] env ${name} invalid number: ${value}`);
  }
  return parsed;
};

const buildEnvironmentOverrides = (): Record<string, unknown> => {
  const snrFallback = parseNumberEnv('ICC_SNR_FALLBACK', process.env.ICC_SNR_FALLBACK);
  const fragileSnr = parseNumberEnv('ICC_FRAGILE_SNR', process.env.ICC_FRAGILE_SNR);
  const fragileDropChance = parseNumberEnv('ICC_FRAGILE_DROP_CHANCE', process.env.ICC_FRAGILE_DROP_CHANCE);
  const bestEffortDropChance = parseNumberEnv(
    'ICC_BEST_EFFORT_DROP_CHANCE',
    process.env.ICC_BEST_EFFORT_DROP_CHANCE
  );
  const reliableDropChance = parseNumberEnv('ICC_RELIABLE_DROP_CHANCE', process.env.ICC_RELIABLE_DROP_CHANCE);
  const overrides: Record<string, unknown> = {};

  if (
    snrFallback !== undefined
    || fragileSnr !== undefined
    || fragileDropChance !== undefined
    || bestEffortDropChance !== undefined
    || reliableDropChance !== undefined
  ) {
    overrides.transmission_profile = {
      ...(snrFallback !== undefined ? { defaults: { snr_fallback: snrFallback } } : {}),
      ...(fragileSnr !== undefined ? { thresholds: { fragile_snr: fragileSnr } } : {}),
      ...(fragileDropChance !== undefined || bestEffortDropChance !== undefined || reliableDropChance !== undefined
        ? {
            drop_chances: {
              ...(fragileDropChance !== undefined ? { fragile: fragileDropChance } : {}),
              ...(bestEffortDropChance !== undefined ? { best_effort: bestEffortDropChance } : {}),
              ...(reliableDropChance !== undefined ? { reliable: reliableDropChance } : {})
            }
          }
        : {})
    };
  }

  return overrides;
};

const validateDeploymentId = (id: string): void => {
  if (!DEPLOYMENT_ID_PATTERN.test(id)) {
    throw new ApiError(400, 'ICC_INVALID_DEPLOYMENT_ID', 'deployment_id contains illegal characters', {
      deployment_id: id,
      allowed_pattern: '^[a-zA-Z0-9_-]+$'
    });
  }
};

const getDeploymentConfigPath = (deploymentId: string, workspaceRoot: string): string => {
  return path.join(workspaceRoot, CONFIG_DIR_RELATIVE_PATH, DEPLOYMENT_CONFIG_DIRNAME, `${deploymentId}.yaml`);
};

const loadGlobalConfig = (): ConfigCacheEntry => {
  const workspaceRoot = resolveWorkspaceRoot();
  const configDir = path.join(workspaceRoot, CONFIG_DIR_RELATIVE_PATH);
  const configFilePath = path.join(configDir, CONFIG_BASENAME);

  const parsed = loadConfigYaml({
    filePath: configFilePath,
    validate: raw => inferenceContextConfigSchema.parse(
      deepMerge(BUILTIN_DEFAULTS as unknown as Record<string, unknown>, raw)
    )
  });

  return {
    config: parsed,
    loadedFile: Object.keys(readYamlFileIfExists(configFilePath)).length > 0 ? configFilePath : null
  };
};

const getGlobalCache = (): ConfigCacheEntry => {
  if (!globalCache) {
    globalCache = loadGlobalConfig();
  }
  return globalCache;
};

const buildFinalConfig = (baseConfig: InferenceContextConfig): InferenceContextConfig => {
  const envOverrides = buildEnvironmentOverrides();
  if (Object.keys(envOverrides).length === 0) {
    return baseConfig;
  }
  const merged = deepMerge(
    baseConfig as unknown as Record<string, unknown>,
    envOverrides
  );
  return inferenceContextConfigSchema.parse(merged);
};

const loadDeploymentConfig = (deploymentId: string): ConfigCacheEntry => {
  validateDeploymentId(deploymentId);

  const globalEntry = getGlobalCache();
  const workspaceRoot = resolveWorkspaceRoot();
  const deploymentConfigPath = getDeploymentConfigPath(deploymentId, workspaceRoot);

  const deploymentOverride = readYamlFileIfExists(deploymentConfigPath);

  let merged: Record<string, unknown>;
  if (Object.keys(deploymentOverride).length === 0) {
    merged = globalEntry.config as unknown as Record<string, unknown>;
  } else {
    merged = deepMerge(
      globalEntry.config as unknown as Record<string, unknown>,
      deploymentOverride
    );
  }

  const parsed = inferenceContextConfigSchema.parse(merged);

  return {
    config: parsed,
    loadedFile: Object.keys(deploymentOverride).length > 0 ? deploymentConfigPath : globalEntry.loadedFile
  };
};

export const getInferenceContextConfig = (deploymentId?: string): InferenceContextConfig => {
  if (!deploymentId) {
    return buildFinalConfig(getGlobalCache().config);
  }

  const cached = deploymentCaches.get(deploymentId);
  const entry = cached ?? loadDeploymentConfig(deploymentId);
  if (!cached) deploymentCaches.set(deploymentId, entry);

  return buildFinalConfig(entry.config);
};

export const resetInferenceContextConfigCache = (deploymentId?: string): void => {
  if (deploymentId) {
    deploymentCaches.delete(deploymentId);
  } else {
    globalCache = null;
    deploymentCaches.clear();
  }
};

export const getInferenceContextConfigLoadedFile = (deploymentId?: string): string | null => {
  if (!deploymentId) {
    return getGlobalCache().loadedFile;
  }

  const cached = deploymentCaches.get(deploymentId);
  if (cached) {
    return cached.loadedFile;
  }

  const entry = loadDeploymentConfig(deploymentId);
  deploymentCaches.set(deploymentId, entry);
  return entry.loadedFile;
};

export const buildInferenceContextConfigSnapshot = (): Record<string, unknown> => {
  const config = getInferenceContextConfig();
  return {
    config_version: config.config_version,
    variable_layers_count: Object.keys(config.variable_context?.layers ?? {}).length,
    transmission_snr_fallback: config.transmission_profile?.defaults?.snr_fallback ?? 0.5,
    transmission_fragile_snr: config.transmission_profile?.thresholds?.fragile_snr ?? 0.3,
    transmission_fragile_drop: config.transmission_profile?.drop_chances?.fragile ?? 0.35,
    transmission_best_effort_drop: config.transmission_profile?.drop_chances?.best_effort ?? 0.15,
    transmission_reliable_drop: config.transmission_profile?.drop_chances?.reliable ?? 0.0,
    policy_evaluations_count: config.policy_summary?.evaluations?.length ?? 0
  };
};
