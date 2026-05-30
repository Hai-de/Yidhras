import path from 'path';
import { z } from 'zod';

import { loadConfigYaml, readYamlFileIfExists, resolveWorkspaceRoot } from '../../config/loader.js';
import { deepMerge } from '../../config/merge.js';
import type {
  PromptVariableRecord,
  PromptVariableValue
} from '../../template_engine/frontends/narrative/types.js';
import { ApiError } from '../../utils/api_error.js';
import { isRecord } from '../../utils/type_guards.js';

// ── Zod schemas ───────────────────────────────────────────────

const nonEmptyStringSchema = z.string().trim().min(1);

const variableLayerConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    values: z.record(z.string(), z.unknown()).default({}),
    alias_values: z.record(z.string(), z.unknown()).optional()
  })
  .strict();

const variableContextConfigSchema = z
  .object({
    layers: z.record(z.string(), variableLayerConfigSchema).optional()
  })
  .strict();

const transmissionProfileDefaultsSchema = z
  .object({
    snr_fallback: z.number().min(0).max(1).optional(),
    delay_ticks_fallback: z.string().optional()
  })
  .strict();

const transmissionProfileThresholdsSchema = z
  .object({
    fragile_snr: z.number().min(0).max(1).optional()
  })
  .strict();

const transmissionProfileDropChancesSchema = z
  .object({
    fragile: z.number().min(0).max(1).optional(),
    best_effort: z.number().min(0).max(1).optional(),
    reliable: z.number().min(0).max(1).optional()
  })
  .strict();

const transmissionProfilePoliciesSchema = z
  .object({
    read_restricted_base: z.enum(['reliable', 'best_effort', 'fragile', 'blocked']).optional(),
    low_snr_base: z.enum(['reliable', 'best_effort', 'fragile', 'blocked']).optional(),
    default_base: z.enum(['reliable', 'best_effort', 'fragile', 'blocked']).optional()
  })
  .strict();

const transmissionProfileConfigSchema = z
  .object({
    defaults: transmissionProfileDefaultsSchema.optional(),
    thresholds: transmissionProfileThresholdsSchema.optional(),
    drop_chances: transmissionProfileDropChancesSchema.optional(),
    policies: transmissionProfilePoliciesSchema.optional()
  })
  .strict();

const policyEvaluationConfigSchema = z
  .object({
    resource: nonEmptyStringSchema,
    action: nonEmptyStringSchema,
    fields: z.array(nonEmptyStringSchema)
  })
  .strict();

const policySummaryConfigSchema = z
  .object({
    evaluations: z.array(policyEvaluationConfigSchema).optional()
  })
  .strict();

export const inferenceContextConfigSchema = z
  .object({
    config_version: z.number().int().positive(),
    variable_context: variableContextConfigSchema.optional(),
    transmission_profile: transmissionProfileConfigSchema.optional(),
    policy_summary: policySummaryConfigSchema.optional()
  })
  .strict();

export type InferenceContextConfig = z.infer<typeof inferenceContextConfigSchema>;
export type VariableLayerConfig = z.infer<typeof variableLayerConfigSchema>;
export type VariableContextConfig = z.infer<typeof variableContextConfigSchema>;
export type TransmissionProfileConfig = z.infer<typeof transmissionProfileConfigSchema>;
export type PolicySummaryConfig = z.infer<typeof policySummaryConfigSchema>;
export type PolicyEvaluationConfig = z.infer<typeof policyEvaluationConfigSchema>;

// ── Constants ──────────────────────────────────────────────────

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
        values: { name: 'Yidhras', timezone: 'Asia/Shanghai' },
        alias_values: { system_name: '{{name}}', timezone: '{{timezone}}' }
      },
      app: {
        enabled: true,
        values: { startup_health: '{{app.startup_health}}' },
        alias_values: { startup_level: '{{app.startup_health.level}}' }
      },
      pack: {
        enabled: true,
        values: { metadata: '{{pack.metadata}}', variables: '{{pack.variables}}', prompts: '{{pack.prompts}}', ai: '{{pack.ai}}' },
        alias_values: { world_name: '{{pack.metadata.name}}', pack_id: '{{pack.metadata.id}}', pack_name: '{{pack.metadata.name}}' }
      },
      runtime: {
        enabled: true,
        values: { current_tick: '{{runtime.current_tick}}', pack_state: '{{runtime.pack_state}}', pack_runtime: '{{runtime.pack_runtime}}', world_state: '{{runtime.pack_state.world_state}}', owned_artifacts: '{{runtime.pack_state.owned_artifacts}}', latest_event: '{{runtime.pack_state.latest_event}}' },
        alias_values: { current_tick: '{{runtime.current_tick}}', world_state: '{{runtime.pack_state.world_state}}', latest_event: '{{runtime.pack_state.latest_event}}', owned_artifacts: '{{runtime.pack_state.owned_artifacts}}' }
      },
      actor: {
        enabled: true,
        values: { identity_id: '{{actor.identity.id}}', identity_type: '{{actor.identity.type}}', display_name: '{{actor.display_name}}', role: '{{actor.role}}', binding_ref: '{{actor.binding_ref}}', agent_id: '{{actor.agent_id}}', agent_snapshot: '{{actor.agent_snapshot}}' },
        alias_values: { actor_name: '{{actor.display_name}}', actor_role: '{{actor.role}}', actor_id: '{{actor.agent_id ?? actor.identity.id}}', identity_id: '{{actor.identity.id}}' }
      },
      request: {
        enabled: true,
        values: { task_type: 'agent_decision', strategy: '{{request.strategy}}', attributes: '{{request.attributes}}', agent_id: '{{request.agent_id}}', identity_id: '{{request.identity_id}}', idempotency_key: '{{request.idempotency_key}}' },
        alias_values: { strategy: '{{request.strategy}}', task_type: 'agent_decision', request_agent_id: '{{request.agent_id}}', request_identity_id: '{{request.identity_id}}' }
      }
    }
  },
  transmission_profile: {
    defaults: { snr_fallback: 0.5, delay_ticks_fallback: '1' },
    thresholds: { fragile_snr: 0.3 },
    drop_chances: { fragile: 0.35, best_effort: 0.15, reliable: 0.0 },
    policies: { read_restricted_base: 'best_effort', low_snr_base: 'fragile', default_base: 'reliable' }
  },
  policy_summary: {
    evaluations: [
      { resource: 'social_post', action: 'read', fields: ['id', 'author_id', 'content', 'created_at', 'content.private.preview', 'content.private.raw'] },
      { resource: 'social_post', action: 'write', fields: ['content'] }
    ]
  }
};

// ── Environment overrides ──────────────────────────────────────

const parseNumberEnv = (name: string, value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (normalized.length === 0) return undefined;
  const parsed = Number(normalized);
  if (Number.isNaN(parsed)) {
    throw new Error(`[inference_context_config] env ${name} invalid number: ${value}`);
  }
  return parsed;
};

const buildEnvironmentOverrides = (): Record<string, unknown> => {
  const snrFallback = parseNumberEnv('ICC_SNR_FALLBACK', process.env['ICC_SNR_FALLBACK']);
  const fragileSnr = parseNumberEnv('ICC_FRAGILE_SNR', process.env['ICC_FRAGILE_SNR']);
  const fragileDropChance = parseNumberEnv('ICC_FRAGILE_DROP_CHANCE', process.env['ICC_FRAGILE_DROP_CHANCE']);
  const bestEffortDropChance = parseNumberEnv('ICC_BEST_EFFORT_DROP_CHANCE', process.env['ICC_BEST_EFFORT_DROP_CHANCE']);
  const reliableDropChance = parseNumberEnv('ICC_RELIABLE_DROP_CHANCE', process.env['ICC_RELIABLE_DROP_CHANCE']);
  const overrides: Record<string, unknown> = {};

  if (
    snrFallback !== undefined || fragileSnr !== undefined ||
    fragileDropChance !== undefined || bestEffortDropChance !== undefined ||
    reliableDropChance !== undefined
  ) {
    overrides['transmission_profile'] = {
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

// ── Config loader class ────────────────────────────────────────

const getDeploymentConfigPath = (deploymentId: string, workspaceRoot: string): string => {
  return path.join(workspaceRoot, CONFIG_DIR_RELATIVE_PATH, DEPLOYMENT_CONFIG_DIRNAME, `${deploymentId}.yaml`);
};

/**
 * 配置加载器实例。替代旧的模块级 globalCache / deploymentCaches。
 * 每个实例独立管理自己的缓存，测试间不互相污染。
 */
export class InferenceContextConfigLoader {
  private globalCache: InferenceContextConfig | null = null;
  private deploymentCaches = new Map<string, InferenceContextConfig>();

  constructor(private readonly deploymentId?: string) {}

  private loadGlobalConfig(): InferenceContextConfig {
    const workspaceRoot = resolveWorkspaceRoot();
    const configDir = path.join(workspaceRoot, CONFIG_DIR_RELATIVE_PATH);
    const configFilePath = path.join(configDir, CONFIG_BASENAME);

    const parsed = loadConfigYaml({
      filePath: configFilePath,
      validate: (raw) =>
        inferenceContextConfigSchema.parse(
          deepMerge(BUILTIN_DEFAULTS as Record<string, unknown>, raw)
        )
    });

    return parsed;
  }

  private getGlobalConfig(): InferenceContextConfig {
    if (!this.globalCache) {
      this.globalCache = this.loadGlobalConfig();
    }
    return this.globalCache;
  }

  private loadDeploymentConfig(deploymentId: string): InferenceContextConfig {
    if (!DEPLOYMENT_ID_PATTERN.test(deploymentId)) {
      throw new ApiError(400, 'ICC_INVALID_DEPLOYMENT_ID', 'deployment_id contains illegal characters', {
        deployment_id: deploymentId,
        allowed_pattern: '^[a-zA-Z0-9_-]+$'
      });
    }

    const globalConfig = this.getGlobalConfig();
    const workspaceRoot = resolveWorkspaceRoot();
    const deploymentConfigPath = getDeploymentConfigPath(deploymentId, workspaceRoot);
    const deploymentOverride = readYamlFileIfExists(deploymentConfigPath);

    if (Object.keys(deploymentOverride).length === 0) {
      return globalConfig;
    }

    const merged = deepMerge(globalConfig, deploymentOverride);
    return inferenceContextConfigSchema.parse(merged);
  }

  getConfig(): InferenceContextConfig {
    const baseConfig = this.deploymentId
      ? (this.deploymentCaches.get(this.deploymentId) ?? this.loadDeploymentConfig(this.deploymentId))
      : this.getGlobalConfig();

    if (this.deploymentId && !this.deploymentCaches.has(this.deploymentId)) {
      this.deploymentCaches.set(this.deploymentId, baseConfig);
    }

    const envOverrides = buildEnvironmentOverrides();
    if (Object.keys(envOverrides).length === 0) {
      return baseConfig;
    }

    const merged = deepMerge(baseConfig, envOverrides);
    return inferenceContextConfigSchema.parse(merged);
  }

  resetCache(deploymentId?: string): void {
    if (deploymentId) {
      this.deploymentCaches.delete(deploymentId);
    } else {
      this.globalCache = null;
      this.deploymentCaches.clear();
    }
  }
}

// ── Template value resolution ──────────────────────────────────

const serializeUnknown = (value: unknown): string => {
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  return String(value);
};

const getValueAtPath = (pathStr: string, root: Record<string, unknown>): unknown => {
  return pathStr.split('.').reduce<unknown>((current, segment) => {
    if (isRecord(current) && segment in current) {
      // eslint-disable-next-line security/detect-object-injection -- keys are from internally constructed enum
      return current[segment];
    }
    return undefined;
  }, root);
};

const parseTemplateExpression = (expression: string): { path: string; fallback?: string } => {
  const trimmed = expression.trim();
  const fallbackIndex = trimmed.indexOf('??');
  if (fallbackIndex >= 0) {
    return {
      path: trimmed.slice(0, fallbackIndex).trim(),
      fallback: trimmed.slice(fallbackIndex + 2).trim()
    };
  }
  return { path: trimmed };
};

const isTemplateString = (value: unknown): value is string => {
  return typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}');
};

const resolveTemplateValue = (
  template: string,
  runtimeObjects: Record<string, unknown>
): PromptVariableValue => {
  const inner = template.slice(2, -2).trim();
  const { path: templatePath, fallback } = parseTemplateExpression(inner);
  const resolved = getValueAtPath(templatePath, runtimeObjects);
  if (resolved !== undefined) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
    return resolved as PromptVariableValue;
  }
  if (fallback !== undefined) {
    const fallbackResolved = getValueAtPath(fallback, runtimeObjects);
    if (fallbackResolved !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
      return fallbackResolved as PromptVariableValue;
    }
    return fallback;
  }
  return null;
};

const resolveValue = (
  value: unknown,
  runtimeObjects: Record<string, unknown>
): PromptVariableValue => {
  if (isTemplateString(value)) {
    return resolveTemplateValue(value, runtimeObjects);
  }
  if (value === null) {
    return null;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => resolveValue(entry, runtimeObjects));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, resolveValue(entry, runtimeObjects)])
    );
  }
  return serializeUnknown(value);
};

/**
 * 解析配置值中的模板表达式（`{{path}}` 语法），
 * 从 runtimeObjects 中注入实际值。
 *
 * 支持 `??` 后备语法: `{{primary ?? fallback}}`
 */
export const resolveConfigValues = (
  configValues: Record<string, unknown> | undefined,
  runtimeObjects: Record<string, unknown>
): PromptVariableRecord => {
  if (!configValues) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(configValues).map(([key, value]) => [key, resolveValue(value, runtimeObjects)])
  );
};
