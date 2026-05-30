import { z } from 'zod';

import { readYamlFileIfExists, resolveWorkspaceRoot } from '../config/loader.js';
import { deepMerge } from '../config/merge.js';
import { getAiModelsConfigPath } from '../config/runtime_config.js';
import type { PromptSlotConfig } from '../inference/prompt_slot_config.js';
import { createLogger } from '../utils/logger.js';
import { buildAdaptersFromRegistry } from './providers/adapter_registry.js';
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
  type AiRoutePolicy,
  type AiToolRegistryEntry,
  type AiToolSpec
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
        response_modes: z.array(z.enum(AI_RESPONSE_MODES)).optional(),
        allow_tool_calling: z.boolean().optional(),
        allowed_tool_ids: z.array(nonEmptyStringSchema).optional()
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

const aiToolRegistryEntrySchema = z
  .object({
    tool_id: nonEmptyStringSchema,
    name: nonEmptyStringSchema,
    description: nonEmptyStringSchema,
    input_schema: z.record(z.string(), z.unknown()),
    strict: z.boolean().optional(),
    kind: z.enum(['system', 'pack']),
    pack_id: nonEmptyStringSchema.nullish(),
    enabled: z.boolean().default(true),
    sandbox: z.enum(['strict', 'readonly_world', 'mutation']).optional(),
    metadata: z.record(z.string(), z.unknown()).optional()
  })
  .strict();

export const BUILTIN_ADAPTER_NAMES = ['mock', 'openai', 'anthropic', 'deepseek', 'mimo', 'ollama'] as const;
export type BuiltinAdapterName = (typeof BUILTIN_ADAPTER_NAMES)[number];

export const AI_PROVIDER_TEMPLATE_KINDS = ['openai_compatible', 'anthropic_compatible', 'builtin'] as const;
export type AiProviderTemplateKind = (typeof AI_PROVIDER_TEMPLATE_KINDS)[number];

const aiProviderTemplateSchema = z
  .object({
    name: nonEmptyStringSchema,
    kind: z.enum(AI_PROVIDER_TEMPLATE_KINDS),
    base_url: nonEmptyStringSchema.nullish(),
    api_key_env: nonEmptyStringSchema.nullish(),
    capability_overrides: z
      .object({
        disallowTempWithTopP: z.boolean().optional(),
        maxTokensField: z.enum(['max_completion_tokens', 'max_tokens']).optional(),
        supportsSeed: z.boolean().optional(),
        maxStructuredOutput: z.enum(['none', 'json_object', 'json_schema']).optional()
      })
      .optional(),
    anthropic_overrides: z
      .object({
        supportsThinking: z.boolean().optional(),
        supportsImageInput: z.boolean().optional(),
        supportsToolUse: z.boolean().optional(),
        apiVersion: z.string().nullable().optional(),
        authHeader: z.enum(['x-api-key', 'bearer']).optional()
      })
      .optional(),
    default_headers: z.record(z.string(), z.string()).optional(),
    builtin_name: z.enum(BUILTIN_ADAPTER_NAMES).nullish()
  })
  .strict();

export const aiRegistryConfigSchema = z
  .object({
    version: z.number().int().positive().default(1),
    provider_templates: z.array(aiProviderTemplateSchema).default([]),
    providers: z.array(aiProviderConfigSchema).default([]),
    models: z.array(aiModelRegistryEntrySchema).default([]),
    routes: z.array(aiRoutePolicySchema).default([]),
    tools: z.array(aiToolRegistryEntrySchema).default([])
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
  dynamicModels: AiModelRegistryEntry[];
  dynamicLastFetchedAt: number | null;
}

export const BUILTIN_AI_REGISTRY_CONFIG: AiRegistryConfig = {
  version: 1,
  provider_templates: [],
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
    },
    {
      provider: 'anthropic',
      api_key_env: 'ANTHROPIC_API_KEY',
      base_url: 'https://api.anthropic.com/v1',
      enabled: true,
      metadata: {
        strategy: 'anthropic_first'
      }
    },
    {
      provider: 'deepseek',
      api_key_env: 'DEEPSEEK_API_KEY',
      base_url: 'https://api.deepseek.com/v1',
      enabled: true,
      metadata: {
        strategy: 'deepseek_first'
      }
    },
    {
      provider: 'mimo',
      api_key_env: 'MIMO_API_KEY',
      base_url: 'https://token-plan-sgp.xiaomimimo.com/v1',
      enabled: true,
      metadata: {
        strategy: 'mimo_first'
      }
    },
    {
      provider: 'ollama',
      api_key_env: null,
      base_url: 'http://localhost:11434/v1',
      enabled: false,
      metadata: {
        strategy: 'local_first'
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
    },
    {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      endpoint_kind: 'messages',
      capabilities: {
        text_generation: true,
        structured_output: 'json_schema',
        tool_calling: true,
        vision_input: true,
        embeddings: false,
        rerank: false,
        max_context_tokens: 200000,
        max_output_tokens: 8192
      },
      tags: ['default', 'structured', 'anthropic-first'],
      availability: 'active',
      pricing: {
        input_per_1m_usd: 3,
        output_per_1m_usd: 15
      },
      defaults: {
        timeout_ms: 30000,
        temperature: 0.2,
        max_output_tokens: 4096
      }
    },
    {
      provider: 'deepseek',
      model: 'deepseek-chat',
      endpoint_kind: 'chat_completions',
      capabilities: {
        text_generation: true,
        structured_output: 'json_object',
        tool_calling: true,
        vision_input: false,
        embeddings: false,
        rerank: false,
        max_context_tokens: 131072,
        max_output_tokens: 8192
      },
      tags: ['default', 'structured', 'deepseek-first'],
      availability: 'active',
      pricing: {
        input_per_1m_usd: 0.14,
        output_per_1m_usd: 0.56
      },
      defaults: {
        timeout_ms: 30000,
        temperature: 0.2,
        max_output_tokens: 4096
      }
    },
    {
      provider: 'mimo',
      model: 'mimo-v2.5-pro',
      endpoint_kind: 'chat_completions',
      capabilities: {
        text_generation: true,
        structured_output: 'json_object',
        tool_calling: true,
        vision_input: false,
        embeddings: false,
        rerank: false,
        max_context_tokens: 1048576,
        max_output_tokens: 16384
      },
      tags: ['fallback', 'high_capacity', 'mimo-first'],
      availability: 'active',
      defaults: {
        timeout_ms: 45000,
        temperature: 0.7,
        max_output_tokens: 4096
      }
    },
    {
      provider: 'ollama',
      model: 'llama3.2',
      endpoint_kind: 'chat_completions',
      capabilities: {
        text_generation: true,
        structured_output: 'none',
        tool_calling: false,
        vision_input: false,
        embeddings: false,
        rerank: false,
        max_context_tokens: 131072,
        max_output_tokens: 4096
      },
      tags: ['local', 'on_device', 'self_hosted'],
      availability: 'active',
      defaults: {
        timeout_ms: 60000,
        temperature: 0.2,
        max_output_tokens: 4096
      }
    },
    {
      provider: 'ollama',
      model: 'nomic-embed-text',
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
      tags: ['local', 'embedding', 'self_hosted'],
      availability: 'active',
      defaults: {
        timeout_ms: 30000
      }
    }
  ],
  routes: [
    {
      route_id: 'default.agent_decision',
      task_types: ['agent_decision'],
      preferred_models: [{ provider: 'openai', model: 'gpt-4.1-mini' }],
      fallback_models: [
        { provider: 'openai', model: 'gpt-4.1' },
        { provider: 'anthropic', model: 'claude-sonnet-4-6' },
        { provider: 'mimo', model: 'mimo-v2.5-pro' },
        { provider: 'deepseek', model: 'deepseek-chat' }
      ],
      constraints: {
        require_structured_output: true,
        privacy_tier: 'trusted_cloud',
        response_modes: ['json_object', 'json_schema'],
        allow_tool_calling: true
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
      fallback_models: [
        { provider: 'openai', model: 'gpt-4.1' },
        { provider: 'anthropic', model: 'claude-sonnet-4-6' },
        { provider: 'mimo', model: 'mimo-v2.5-pro' },
        { provider: 'deepseek', model: 'deepseek-chat' }
      ],
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
      fallback_models: [
        { provider: 'openai', model: 'gpt-4.1' },
        { provider: 'anthropic', model: 'claude-sonnet-4-6' }
      ],
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
      fallback_models: [{ provider: 'ollama', model: 'nomic-embed-text' }],
      constraints: {
        privacy_tier: 'trusted_cloud',
        response_modes: ['embedding']
      },
      defaults: {
        timeout_ms: 15000,
        retry_limit: 0,
        allow_fallback: true,
        audit_level: 'minimal'
      }
    }
  ]
};

export const BUILTIN_AI_TOOLS: AiToolRegistryEntry[] = [
  {
    tool_id: 'sys.query_memory_blocks',
    name: 'query_memory_blocks',
    description: 'Query memory blocks for a pack by text or filter',
    input_schema: {
      type: 'object',
      properties: {
        pack_id: { type: 'string', description: 'The pack ID to query memory blocks from' },
        limit: { type: 'integer', description: 'Maximum number of blocks to return (default 10, max 100)' }
      },
      required: []
    },
    kind: 'system',
    enabled: true
  },
  {
    tool_id: 'sys.get_entity',
    name: 'get_entity',
    description: 'Get a single entity by ID from a pack',
    input_schema: {
      type: 'object',
      properties: {
        pack_id: { type: 'string', description: 'The pack ID' },
        entity_id: { type: 'string', description: 'The entity ID to retrieve' }
      },
      required: ['pack_id', 'entity_id']
    },
    kind: 'system',
    enabled: true
  },
  {
    tool_id: 'sys.list_active_agents',
    name: 'list_active_agents',
    description: 'List active agents, optionally filtered by pack',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'Maximum number of agents to return (default 50, max 100)' }
      },
      required: []
    },
    kind: 'system',
    enabled: true
  },
  {
    tool_id: 'sys.get_relationship',
    name: 'get_relationship',
    description: 'Get the relationship between two entities',
    input_schema: {
      type: 'object',
      properties: {
        source_id: { type: 'string', description: 'Source entity ID' },
        target_id: { type: 'string', description: 'Target entity ID' }
      },
      required: ['source_id', 'target_id']
    },
    kind: 'system',
    enabled: true
  },
  {
    tool_id: 'sys.get_clock_state',
    name: 'get_clock_state',
    description: 'Get the current simulation clock state including tick and formatted times',
    input_schema: {
      type: 'object',
      properties: {},
      required: []
    },
    kind: 'system',
    enabled: true
  }
];

let aiRegistryCache: AiRegistryCache | null = null;

const mergeById = <T>(
  base: T[],
  overrides: T[],
  keyFn: (item: T) => string
): T[] => {
  const merged = new Map(base.map(item => [keyFn(item), structuredClone(item)]));
  for (const override of overrides) {
    const key = keyFn(override);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, structuredClone(override));
      continue;
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary: mergeById generic T → Record<string, unknown> for deepMerge
    merged.set(key, deepMerge(existing as Record<string, unknown>, override as Record<string, unknown>) as T);
  }
  return Array.from(merged.values());
};

export const mergeAiRegistryConfig = (base: AiRegistryConfig, override: AiRegistryConfig): AiRegistryConfig => {
  return {
    version: override.version,
    provider_templates: mergeById(base.provider_templates ?? [], override.provider_templates ?? [], t => t.name),
    providers: mergeById(base.providers, override.providers, p => p.provider),
    models: mergeById(base.models, override.models, m => `${m.provider}:${m.model}`),
    routes: mergeById(base.routes, override.routes, r => r.route_id),
    tools: mergeById(base.tools ?? [], override.tools ?? [], t => t.tool_id)
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

  const withBuiltinTools: AiRegistryConfig = {
    ...BUILTIN_AI_REGISTRY_CONFIG,
    tools: BUILTIN_AI_TOOLS
  };

  return {
    config: mergeAiRegistryConfig(withBuiltinTools, parsedOverride),
    metadata: {
      workspaceRoot,
      configPath,
      loadedFromFile: hasFileOverrides
    },
    dynamicModels: [],
    dynamicLastFetchedAt: null
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

const logger = createLogger('ai-registry');

const buildSyntheticProviderConfig = (
  template: import('./types.js').AiProviderTemplate
): AiProviderConfig => ({
  provider: template.name,
  api_key_env: template.api_key_env ?? null,
  base_url: template.base_url ?? null,
  enabled: true,
  default_headers: template.default_headers
});

const resolveProviderConfig = (
  cache: AiRegistryCache,
  provider: string
): AiProviderConfig | null => {
  const fromProviders = cache.config.providers.find(p => p.provider === provider);
  if (fromProviders) return fromProviders;

  const fromTemplate = (cache.config.provider_templates ?? []).find(t => t.name === provider);
  if (fromTemplate) return buildSyntheticProviderConfig(fromTemplate);

  return null;
};

export const getAiRegistryConfig = (): AiRegistryConfig => {
  const cache = getAiRegistryCache();
  if (cache.dynamicModels.length === 0) {
    return cache.config;
  }
  const staticKeys = new Set(cache.config.models.map(m => `${m.provider}:${m.model}`));
  const newDynamic = cache.dynamicModels.filter(m => !staticKeys.has(`${m.provider}:${m.model}`));
  if (newDynamic.length === 0) {
    return cache.config;
  }
  return {
    ...cache.config,
    models: [...cache.config.models, ...newDynamic]
  };
};

export const getDynamicModelsMetadata = (): {
  count: number;
  lastFetchedAt: number | null;
} => {
  const cache = getAiRegistryCache();
  return {
    count: cache.dynamicModels.length,
    lastFetchedAt: cache.dynamicLastFetchedAt
  };
};

export const refreshDynamicModels = async (): Promise<void> => {
  const cache = getAiRegistryCache();
  const adapters = buildAdaptersFromRegistry(cache.config);
  const dynamicModels: AiModelRegistryEntry[] = [];

  for (const adapter of adapters) {
    if (!adapter.listModels) continue;
    const providerConfig = resolveProviderConfig(cache, adapter.provider);
    if (!providerConfig || !providerConfig.enabled) continue;

    try {
      const partialModels = await adapter.listModels(providerConfig);
      for (const partial of partialModels) {
        dynamicModels.push({
          provider: partial.provider,
          model: partial.model,
          endpoint_kind: partial.endpoint_kind ?? 'chat_completions',
          base_url: partial.base_url ?? null,
          api_version: partial.api_version ?? null,
          capabilities: {
            text_generation: partial.capabilities?.text_generation ?? true,
            structured_output: partial.capabilities?.structured_output ?? 'none',
            tool_calling: partial.capabilities?.tool_calling ?? false,
            vision_input: partial.capabilities?.vision_input ?? false,
            embeddings: partial.capabilities?.embeddings ?? false,
            rerank: partial.capabilities?.rerank ?? false,
            max_context_tokens: partial.capabilities?.max_context_tokens,
            max_output_tokens: partial.capabilities?.max_output_tokens
          },
          tags: partial.tags ?? ['dynamic'],
          availability: partial.availability ?? 'active',
          pricing: partial.pricing,
          defaults: partial.defaults,
          metadata: partial.metadata
        });
      }
    } catch (err) {
      logger.warn(`动态模型列表获取失败 [${adapter.provider}]`, { error: err instanceof Error ? err : new Error(String(err)) });
    }
  }

  cache.dynamicModels = dynamicModels;
  cache.dynamicLastFetchedAt = Date.now();
  logger.info(`动态模型刷新完成，共 ${String(dynamicModels.length)} 个模型`);
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

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
  return routes.filter(route => route.task_types.includes(taskType as AiRoutePolicy['task_types'][number]));
};

export const listAiToolEntries = (): AiToolRegistryEntry[] => {
  return getAiRegistryConfig().tools ?? [];
};

export const getAiToolEntry = (toolId: string): AiToolRegistryEntry | null => {
  return getAiRegistryConfig().tools?.find(entry => entry.tool_id === toolId) ?? null;
};

export const findAiToolEntryByName = (name: string): AiToolRegistryEntry | null => {
  return getAiRegistryConfig().tools?.find(entry => entry.name === name) ?? null;
};

export const resolveToolsFromRegistry = (toolIds: string[]): AiToolRegistryEntry[] => {
  const tools = getAiRegistryConfig().tools ?? [];
  const toolMap = new Map(tools.map(entry => [entry.tool_id, entry]));
  return toolIds
    .map(id => toolMap.get(id))
    .filter((entry): entry is AiToolRegistryEntry => entry !== undefined && entry.enabled);
};

export const resolveToolSpecsFromRegistry = (toolIds: string[]): AiToolSpec[] => {
  return resolveToolsFromRegistry(toolIds).map(entry => ({
    name: entry.name,
    description: entry.description,
    input_schema: entry.input_schema,
    strict: entry.strict
  }));
};

const promptSlotConfigSchema = z
  .object({
    id: nonEmptyStringSchema,
    display_name: nonEmptyStringSchema,
    description: nonEmptyStringSchema.optional(),
    default_priority: z.number().int().min(0),
    position: z.number().int().nullable().optional(),
    anchor: z
      .object({
        ref: z.string().min(1),
        relation: z.enum(['after', 'before'])
      })
      .nullable()
      .optional(),
    default_template: nonEmptyStringSchema.nullish(),
    template_context: z.enum(['inference', 'world_prompts', 'pack_state', 'none']).optional(),
    template_key: nonEmptyStringSchema.nullish(),
    message_role: z.enum(['system', 'developer', 'user']).optional(),
    include_in_combined: z.boolean(),
    combined_heading: nonEmptyStringSchema.nullish(),
    permissions: z
      .object({
        read: z.array(nonEmptyStringSchema).optional(),
        write: z.array(nonEmptyStringSchema).optional(),
        adjust: z.array(nonEmptyStringSchema).optional(),
        visible: z.boolean(),
        visible_to: z.array(nonEmptyStringSchema).optional()
      })
      .strict()
      .nullish(),
    enabled: z.boolean(),
    metadata: z.record(z.string(), z.unknown()).optional()
  })
  .strict();

export type ParsedPromptSlotConfig = z.infer<typeof promptSlotConfigSchema>;

export const promptSlotRegistrySchema = z
  .object({
    version: z.number().int().positive().default(1),
    slots: z.record(z.string(), promptSlotConfigSchema).default({})
  })
  .strict();

export const BUILTIN_SLOT_IDS = new Set([
  'system_core',
  'system_policy',
  'role_core',
  'world_context',
  'memory_short_term',
  'memory_long_term',
  'memory_summary',
  'output_contract',
  'post_process',
  'conversation_history'
]);

interface PromptSlotRegistryCache {
  config: { version: number; slots: Record<string, ParsedPromptSlotConfig> };
  metadata: { workspaceRoot: string; configPath: string; loadedFromFile: boolean };
  dynamic_slots: Map<string, ParsedPromptSlotConfig>;
}

export const BUILTIN_PROMPT_SLOTS_PATH = 'apps/server/src/ai/schemas/prompt_slots.default.yaml';

let promptSlotRegistryCache: PromptSlotRegistryCache | null = null;

const loadPromptSlotRegistry = (): PromptSlotRegistryCache => {
  const workspaceRoot = resolveWorkspaceRoot();
  const configPath = getAiModelsConfigPath();
  const defaultPath = `${workspaceRoot}/${BUILTIN_PROMPT_SLOTS_PATH}`;
  const defaultRaw = readYamlFileIfExists(defaultPath);
  const defaultParsed = promptSlotRegistrySchema.parse(defaultRaw);
  const overrideRaw = readYamlFileIfExists(configPath.replace('ai_models.yaml', 'prompt_slots.yaml'));
  const hasOverride = Object.keys(overrideRaw).length > 0;
  const merged = hasOverride
    ? promptSlotRegistrySchema.parse(deepMerge(defaultParsed, overrideRaw))
    : defaultParsed;
  return {
    config: merged,
    metadata: { workspaceRoot, configPath, loadedFromFile: hasOverride },
    dynamic_slots: new Map()
  };
};

const getPromptSlotRegistryCache = (): PromptSlotRegistryCache => {
  if (!promptSlotRegistryCache) {
    promptSlotRegistryCache = loadPromptSlotRegistry();
  }
  return promptSlotRegistryCache;
};

export const resetPromptSlotRegistryCache = (): void => {
  promptSlotRegistryCache = null;
};

export const getPromptSlotRegistry = (): { version: number; slots: Record<string, ParsedPromptSlotConfig> } => {
  const cache = getPromptSlotRegistryCache();
  const merged: Record<string, ParsedPromptSlotConfig> = { ...cache.config.slots };
  for (const [id, config] of cache.dynamic_slots) {
    // YAML 声明优先：同名不覆盖
    if (!(id in merged)) {
      merged[id] = config;
    }
  }
  return { version: cache.config.version, slots: merged };
};

export const getPromptSlotRegistryMetadata = (): PromptSlotRegistryCache['metadata'] => {
  return getPromptSlotRegistryCache().metadata;
};

/**
 * 运行时注册新插槽。同名插槽不会覆盖 YAML 声明（YAML 优先）。
 * 内置插槽 ID 不可注册为动态插槽。
 */
export const registerDynamicSlot = (config: PromptSlotConfig): boolean => {
  const cache = getPromptSlotRegistryCache();
  if (BUILTIN_SLOT_IDS.has(config.id)) return false;
  // YAML 优先：同名不覆盖
  if (config.id in cache.config.slots) return false;
  const parsed = promptSlotConfigSchema.parse(config);
  cache.dynamic_slots.set(config.id, parsed);
  return true;
};

/**
 * 注销动态插槽。内置插槽和 YAML 声明的插槽不可注销。
 */
export const unregisterDynamicSlot = (slotId: string): boolean => {
  const cache = getPromptSlotRegistryCache();
  if (BUILTIN_SLOT_IDS.has(slotId)) return false;
  if (slotId in cache.config.slots) return false;
  return cache.dynamic_slots.delete(slotId);
};

/**
 * 启用/禁用插槽（禁用时保留为结构性锚点）。
 * 对内置插槽、YAML 覆盖插槽、动态插槽均生效。
 */
export const setSlotEnabled = (slotId: string, enabled: boolean): boolean => {
  const cache = getPromptSlotRegistryCache();
  const dynamic = cache.dynamic_slots.get(slotId);
  if (dynamic) {
    dynamic.enabled = enabled;
    return true;
  }
  if (slotId in cache.config.slots) {
    // eslint-disable-next-line security/detect-object-injection
    cache.config.slots[slotId]!.enabled = enabled;
    return true;
  }
  return false;
};

/** 列出所有动态注册的插槽（不含 YAML 声明插槽）。 */
export const listDynamicSlots = (): ParsedPromptSlotConfig[] => {
  return [...getPromptSlotRegistryCache().dynamic_slots.values()];
};

