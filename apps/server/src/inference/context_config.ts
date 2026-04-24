import path from 'path';

import { readYamlFileIfExists, resolveWorkspaceRoot } from '../config/loader.js';
import { deepMergeAll } from '../config/merge.js';
import {
  type InferenceContextConfig,
  inferenceContextConfigSchema
} from './context_config_schema.js';

const CONFIG_BASENAME = 'inference_context.yaml';
const CONFIG_DIR_RELATIVE_PATH = path.join('data', 'configw');

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

interface InferenceContextConfigCache {
  config: InferenceContextConfig;
  loadedFile: string | null;
}

let configCache: InferenceContextConfigCache | null = null;

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

const parseBooleanEnv = (name: string, value: string | undefined): boolean | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) {
    return undefined;
  }
  switch (normalized) {
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
      throw new Error(`[inference_context_config] env ${name} invalid boolean: ${value}`);
  }
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
  const strictNamespace = parseBooleanEnv(
    'ICC_POLICY_STRICT_NAMESPACE',
    process.env.ICC_POLICY_STRICT_NAMESPACE
  );

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

  if (strictNamespace !== undefined) {
    overrides.variable_context = {
      strict_namespace: strictNamespace
    };
  }

  return overrides;
};

const loadInferenceContextConfig = (): InferenceContextConfigCache => {
  const workspaceRoot = resolveWorkspaceRoot();
  const configDir = path.join(workspaceRoot, CONFIG_DIR_RELATIVE_PATH);
  const configFilePath = path.join(configDir, CONFIG_BASENAME);

  const fileOverride = readYamlFileIfExists(configFilePath);
  const envOverrides = buildEnvironmentOverrides();
  const merged = deepMergeAll(
    BUILTIN_DEFAULTS as unknown as Record<string, unknown>,
    fileOverride,
    envOverrides
  );

  const parsed = inferenceContextConfigSchema.parse(merged);

  return {
    config: parsed,
    loadedFile: Object.keys(fileOverride).length > 0 ? configFilePath : null
  };
};

const getCache = (): InferenceContextConfigCache => {
  if (!configCache) {
    configCache = loadInferenceContextConfig();
  }
  return configCache;
};

export const getInferenceContextConfig = (): InferenceContextConfig => {
  return getCache().config;
};

export const resetInferenceContextConfigCache = (): void => {
  configCache = null;
};

export const getInferenceContextConfigLoadedFile = (): string | null => {
  return getCache().loadedFile;
};

export const buildInferenceContextConfigSnapshot = (): Record<string, unknown> => {
  const config = getInferenceContextConfig();
  return {
    config_version: config.config_version,
    variable_layers_count: Object.keys(config.variable_context?.layers ?? {}).length,
    variable_alias_precedence: config.variable_context?.alias_precedence ?? [],
    variable_strict_namespace: config.variable_context?.strict_namespace ?? false,
    transmission_snr_fallback: config.transmission_profile?.defaults?.snr_fallback ?? 0.5,
    transmission_fragile_snr: config.transmission_profile?.thresholds?.fragile_snr ?? 0.3,
    transmission_fragile_drop: config.transmission_profile?.drop_chances?.fragile ?? 0.35,
    transmission_best_effort_drop: config.transmission_profile?.drop_chances?.best_effort ?? 0.15,
    transmission_reliable_drop: config.transmission_profile?.drop_chances?.reliable ?? 0.0,
    policy_evaluations_count: config.policy_summary?.evaluations?.length ?? 0
  };
};
