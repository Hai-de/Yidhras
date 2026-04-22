import { z } from 'zod';

import { readYamlFileIfExists, resolveWorkspaceRoot } from '../config/loader.js';
import { deepMerge } from '../config/merge.js';
import { getAiModelsConfigPath } from '../config/runtime_config.js';
import {
  AI_AUDIT_LEVELS,
  AI_MODEL_AVAILABILITY,
  AI_MODEL_ENDPOINT_KINDS,
  AI_MODEL_STRUCTURED_OUTPUT_SUPPORT,
  AI_PRIVACY_TIERS,
  AI_RESPONSE_MODES,
  AI_TASK_TYPES,
  type AiModelRegistryEntry,
  type AiProviderConfig,
  type AiRegistryConfig,
  type AiRoutePolicy
} from './types.js';

const nonEmptyStringSchema = z.string().trim().min(1);

const aiModelSelectorSchema = z
  .object({
    provider: nonEmptyStringSchema.optional(),
    model: nonEmptyStringSchema.optional(),
    tags: z.array(nonEmptyStringSchema).optional(),
    exclude_tags: z.array(nonEmptyStringSchema).optional()
  })
  .strict();

const aiProviderConfigSchema = z
  .object({
    provider: nonEmptyStringSchema,
    api_key_env: nonEmptyStringSchema.nullish(),
    base_url: nonEmptyStringSchema.nullish(),
    organization_env: nonEmptyStringSchema.nullish(),
    project_env: nonEmptyStringSchema.nullish(),
    default_headers: z.record(z.string(), z.string()).optional(),
    enabled: z.boolean().default(true),
    metadata: z.record(z.string(), z.unknown()).optional()
  })
  .strict();

const aiModelCapabilitiesSchema = z
  .object({
    text_generation: z.boolean(),
    structured_output: z.enum(AI_MODEL_STRUCTURED_OUTPUT_SUPPORT),
    tool_calling: z.boolean(),
    vision_input: z.boolean(),
    embeddings: z.boolean(),
    rerank: z.boolean(),
    max_context_tokens: z.number().int().positive().optional(),
    max_output_tokens: z.number().int().positive().optional()
  })
  .strict();

const aiModelRegistryEntrySchema = z
  .object({
    provider: nonEmptyStringSchema,
    model: nonEmptyStringSchema,
    endpoint_kind: z.enum(AI_MODEL_ENDPOINT_KINDS),
    base_url: nonEmptyStringSchema.nullish(),
    api_version: nonEmptyStringSchema.nullish(),
    capabilities: aiModelCapabilitiesSchema,
    tags: z.array(nonEmptyStringSchema).default([]),
    availability: z.enum(AI_MODEL_AVAILABILITY).default('active'),
    pricing: z
      .object({
        input_per_1m_usd: z.number().nonnegative().optional(),
        output_per_1m_usd: z.number().nonnegative().optional()
      })
      .strict()
      .optional(),
    defaults: z
      .object({
        timeout_ms: z.number().int().positive().optional(),
        temperature: z.number().min(0).max(2).optional(),
        max_output_tokens: z.number().int().positive().optional()
      })
      .strict()
      .optional(),
    metadata: z.record(z.string(), z.unknown()).optional()
  })
  .strict();

const aiRoutePolicySchema = z
  .object({
    route_id: nonEmptyStringSchema,
    task_types: z.array(z.enum(AI_TASK_TYPES)).min(1),
    pack_id: nonEmptyStringSchema.nullish(),
    preferred_models: z.array(aiModelSelectorSchema).default([]),
    fallback_models: z.array(aiModelSelectorSchema).default([]),
    constraints: z
      .object({
        require_structured_output: z.boolean().optional(),
        require_tool_calling: z.boolean().optional(),
        require_local_only: z.boolean().optional(),
        max_latency_ms: z.number().int().positive().optional(),
        max_cost_usd: z.number().nonnegative().optional(),
        privacy_tier: z.enum(AI_PRIVACY_TIERS).optional(),
        response_modes: z.array(z.enum(AI_RESPONSE_MODES)).optional()
      })
      .strict()
      .optional(),
    defaults: z
      .object({
        timeout_ms: z.number().int().positive().optional(),
        retry_limit: z.number().int().min(0).optional(),
        allow_fallback: z.boolean().optional(),
        audit_level: z.enum(AI_AUDIT_LEVELS).optional()
      })
      .strict()
      .optional(),
    metadata: z.record(z.string(), z.unknown()).optional()
  })
  .strict();

const aiRegistryConfigSchema = z
  .object({
    version: z.number().int().positive().default(1),
    providers: z.array(aiProviderConfigSchema).default([]),
    models: z.array(aiModelRegistryEntrySchema).default([]),
    routes: z.array(aiRoutePolicySchema).default([])
  })
  .strict();

export interface AiRegistryMetadata {
  workspaceRoot: string;
  configPath: string;
  loadedFromFile: boolean;
}

interface AiRegistryCache {
  config: AiRegistryConfig;
  metadata: AiRegistryMetadata;
}

const BUILTIN_AI_REGISTRY_CONFIG: AiRegistryConfig = {
  version: 1,
  providers: [
    {
      provider: 'openai',
      api_key_env: 'OPENAI_API_KEY',
      base_url: 'https://api.openai.com/v1',
      organization_env: 'OPENAI_ORG_ID',
      project_env: 'OPENAI_PROJECT_ID',
      enabled: true,
      metadata: {
        strategy: 'openai_first'
      }
    }
  ],
  models: [
    {
      provider: 'openai',
      model: 'gpt-4.1-mini',
      endpoint_kind: 'responses',
      capabilities: {
        text_generation: true,
        structured_output: 'json_schema',
        tool_calling: true,
        vision_input: true,
        embeddings: false,
        rerank: false,
        max_context_tokens: 1047576,
        max_output_tokens: 32768
      },
      tags: ['default', 'interactive', 'structured', 'openai-first'],
      availability: 'active',
      pricing: {
        input_per_1m_usd: 0.4,
        output_per_1m_usd: 1.6
      },
      defaults: {
        timeout_ms: 30000,
        temperature: 0.2,
        max_output_tokens: 4096
      }
    },
    {
      provider: 'openai',
      model: 'gpt-4.1',
      endpoint_kind: 'responses',
      capabilities: {
        text_generation: true,
        structured_output: 'json_schema',
        tool_calling: true,
        vision_input: true,
        embeddings: false,
        rerank: false,
        max_context_tokens: 1047576,
        max_output_tokens: 32768
      },
      tags: ['fallback', 'structured', 'high_capacity', 'openai-first'],
      availability: 'active',
      pricing: {
        input_per_1m_usd: 2,
        output_per_1m_usd: 8
      },
      defaults: {
        timeout_ms: 45000,
        temperature: 0.2,
        max_output_tokens: 4096
      }
    },
    {
      provider: 'openai',
      model: 'text-embedding-3-small',
      endpoint_kind: 'embeddings',
      capabilities: {
        text_generation: false,
        structured_output: 'none',
        tool_calling: false,
        vision_input: false,
        embeddings: true,
        rerank: false,
        max_context_tokens: 8192
      },
      tags: ['default', 'embedding', 'openai-first'],
      availability: 'active',
      pricing: {
        input_per_1m_usd: 0.02
      },
      defaults: {
        timeout_ms: 15000
      }
    }
  ],
  routes: [
    {
      route_id: 'default.agent_decision',
      task_types: ['agent_decision'],
      preferred_models: [{ provider: 'openai', model: 'gpt-4.1-mini' }],
      fallback_models: [{ provider: 'openai', model: 'gpt-4.1' }],
      constraints: {
        require_structured_output: true,
        privacy_tier: 'trusted_cloud',
        response_modes: ['json_object', 'json_schema']
      },
      defaults: {
        timeout_ms: 30000,
        retry_limit: 1,
        allow_fallback: true,
        audit_level: 'standard'
      }
    },
    {
      route_id: 'default.context_summary',
      task_types: ['intent_grounding_assist', 'context_summary', 'memory_compaction', 'narrative_projection', 'entity_extraction', 'classification', 'rerank'],
      preferred_models: [{ provider: 'openai', model: 'gpt-4.1-mini' }],
      fallback_models: [{ provider: 'openai', model: 'gpt-4.1' }],
      constraints: {
        require_structured_output: true,
        privacy_tier: 'trusted_cloud'
      },
      defaults: {
        timeout_ms: 45000,
        retry_limit: 1,
        allow_fallback: true,
        audit_level: 'standard'
      }
    },
    {
      route_id: 'default.moderation',
      task_types: ['moderation'],
      preferred_models: [{ provider: 'openai', model: 'gpt-4.1-mini' }],
      fallback_models: [{ provider: 'openai', model: 'gpt-4.1' }],
      constraints: {
        require_structured_output: true,
        privacy_tier: 'trusted_cloud',
        response_modes: ['json_object', 'json_schema']
      },
      defaults: {
        timeout_ms: 20000,
        retry_limit: 1,
        allow_fallback: true,
        audit_level: 'standard'
      }
    },
    {
      route_id: 'default.embedding',
      task_types: ['embedding'],
      preferred_models: [{ provider: 'openai', model: 'text-embedding-3-small' }],
      fallback_models: [],
      constraints: {
        privacy_tier: 'trusted_cloud',
        response_modes: ['embedding']
      },
      defaults: {
        timeout_ms: 15000,
        retry_limit: 0,
        allow_fallback: false,
        audit_level: 'minimal'
      }
    }
  ]
};

let aiRegistryCache: AiRegistryCache | null = null;

const mergeProviderConfigs = (base: AiProviderConfig[], overrides: AiProviderConfig[]): AiProviderConfig[] => {
  const mergedByProvider = new Map(base.map(entry => [entry.provider, structuredClone(entry)]));

  for (const override of overrides) {
    const existing = mergedByProvider.get(override.provider);
    if (!existing) {
      mergedByProvider.set(override.provider, structuredClone(override));
      continue;
    }

    mergedByProvider.set(
      override.provider,
      deepMerge(existing as unknown as Record<string, unknown>, override as unknown as Record<string, unknown>) as unknown as AiProviderConfig
    );
  }

  return Array.from(mergedByProvider.values());
};

const mergeModelRegistryEntries = (base: AiModelRegistryEntry[], overrides: AiModelRegistryEntry[]): AiModelRegistryEntry[] => {
  const mergedByModelKey = new Map(base.map(entry => [`${entry.provider}:${entry.model}`, structuredClone(entry)]));

  for (const override of overrides) {
    const key = `${override.provider}:${override.model}`;
    const existing = mergedByModelKey.get(key);
    if (!existing) {
      mergedByModelKey.set(key, structuredClone(override));
      continue;
    }

    mergedByModelKey.set(
      key,
      deepMerge(existing as unknown as Record<string, unknown>, override as unknown as Record<string, unknown>) as unknown as AiModelRegistryEntry
    );
  }

  return Array.from(mergedByModelKey.values());
};

const mergeRoutePolicies = (base: AiRoutePolicy[], overrides: AiRoutePolicy[]): AiRoutePolicy[] => {
  const mergedByRouteId = new Map(base.map(entry => [entry.route_id, structuredClone(entry)]));

  for (const override of overrides) {
    const existing = mergedByRouteId.get(override.route_id);
    if (!existing) {
      mergedByRouteId.set(override.route_id, structuredClone(override));
      continue;
    }

    mergedByRouteId.set(
      override.route_id,
      deepMerge(existing as unknown as Record<string, unknown>, override as unknown as Record<string, unknown>) as unknown as AiRoutePolicy
    );
  }

  return Array.from(mergedByRouteId.values());
};

const mergeAiRegistryConfig = (base: AiRegistryConfig, override: AiRegistryConfig): AiRegistryConfig => {
  return {
    version: override.version,
    providers: mergeProviderConfigs(base.providers, override.providers),
    models: mergeModelRegistryEntries(base.models, override.models),
    routes: mergeRoutePolicies(base.routes, override.routes)
  };
};

const loadAiRegistryConfig = (): AiRegistryCache => {
  const workspaceRoot = resolveWorkspaceRoot();
  const configPath = getAiModelsConfigPath();
  const rawConfig = readYamlFileIfExists(configPath);
  const hasFileOverrides = Object.keys(rawConfig).length > 0;
  const parsedOverride = aiRegistryConfigSchema.parse({
    version: BUILTIN_AI_REGISTRY_CONFIG.version,
    ...rawConfig
  });

  return {
    config: mergeAiRegistryConfig(BUILTIN_AI_REGISTRY_CONFIG, parsedOverride),
    metadata: {
      workspaceRoot,
      configPath,
      loadedFromFile: hasFileOverrides
    }
  };
};

const getAiRegistryCache = (): AiRegistryCache => {
  if (!aiRegistryCache) {
    aiRegistryCache = loadAiRegistryConfig();
  }

  return aiRegistryCache;
};

export const resetAiRegistryCache = (): void => {
  aiRegistryCache = null;
};

export const getAiRegistryConfig = (): AiRegistryConfig => {
  return getAiRegistryCache().config;
};

export const getAiRegistryMetadata = (): AiRegistryMetadata => {
  return getAiRegistryCache().metadata;
};

export const listAiProviderConfigs = (): AiProviderConfig[] => {
  return getAiRegistryConfig().providers;
};

export const getAiProviderConfig = (provider: string): AiProviderConfig | null => {
  return getAiRegistryConfig().providers.find(entry => entry.provider === provider) ?? null;
};

export const listAiModelRegistryEntries = (): AiModelRegistryEntry[] => {
  return getAiRegistryConfig().models;
};

export const findAiModelRegistryEntry = (input: { provider: string; model: string }): AiModelRegistryEntry | null => {
  return (
    getAiRegistryConfig().models.find(entry => entry.provider === input.provider && entry.model === input.model) ?? null
  );
};

export const listAiRoutePolicies = (taskType?: string): AiRoutePolicy[] => {
  const routes = getAiRegistryConfig().routes;
  if (!taskType) {
    return routes;
  }

  return routes.filter(route => route.task_types.includes(taskType as AiRoutePolicy['task_types'][number]));
};
