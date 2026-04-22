import type {
  AiPackConfig,
  AiResolvedTaskConfig,
  AiTaskDefinition,
  AiTaskOverride,
  AiTaskType
} from './types.js';

const AGENT_DECISION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    action_type: { type: 'string' },
    target_ref: {
      anyOf: [
        { type: 'object' },
        { type: 'null' }
      ]
    },
    payload: { type: 'object' },
    confidence: { type: 'number' },
    delay_hint_ticks: {
      anyOf: [
        { type: 'string' },
        { type: 'integer' }
      ]
    },
    reasoning: { type: 'string' },
    meta: {
      anyOf: [
        { type: 'object' },
        { type: 'null' }
      ]
    }
  },
  required: ['action_type', 'payload']
};

const CONTEXT_SUMMARY_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    key_points: {
      type: 'array',
      items: { type: 'string' }
    },
    omitted: {
      type: 'array',
      items: { type: 'string' }
    }
  },
  required: ['summary']
};

const MODERATION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    allowed: { type: 'boolean' },
    category: { type: 'string' },
    rationale: { type: 'string' }
  },
  required: ['allowed', 'category']
};

const ENTITY_EXTRACTION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    entities: {
      type: 'array',
      items: { type: 'object' }
    }
  },
  required: ['entities']
};

const CLASSIFICATION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    label: { type: 'string' },
    confidence: { type: 'number' },
    rationale: { type: 'string' }
  },
  required: ['label']
};

const TASK_DEFINITIONS: Record<AiTaskType, AiTaskDefinition> = {
  agent_decision: {
    task_type: 'agent_decision',
    default_response_mode: 'json_schema',
    default_prompt_preset: 'default_decision_v1',
    default_decoder: 'default_json_schema',
    default_route_id: 'default.agent_decision',
    default_schema: AGENT_DECISION_SCHEMA,
    default_strict: true,
    default_privacy_tier: 'trusted_cloud'
  },
  intent_grounding_assist: {
    task_type: 'intent_grounding_assist',
    default_response_mode: 'json_schema',
    default_prompt_preset: 'default_intent_grounding_v1',
    default_decoder: 'default_json_schema',
    default_route_id: 'default.context_summary',
    default_schema: AGENT_DECISION_SCHEMA,
    default_strict: true,
    default_privacy_tier: 'trusted_cloud'
  },
  context_summary: {
    task_type: 'context_summary',
    default_response_mode: 'json_schema',
    default_prompt_preset: 'default_context_summary_v1',
    default_decoder: 'default_json_schema',
    default_route_id: 'default.context_summary',
    default_schema: CONTEXT_SUMMARY_SCHEMA,
    default_strict: true,
    default_privacy_tier: 'trusted_cloud'
  },
  memory_compaction: {
    task_type: 'memory_compaction',
    default_response_mode: 'json_schema',
    default_prompt_preset: 'default_memory_compaction_v1',
    default_decoder: 'default_json_schema',
    default_route_id: 'default.context_summary',
    default_schema: CONTEXT_SUMMARY_SCHEMA,
    default_strict: true,
    default_privacy_tier: 'trusted_cloud'
  },
  narrative_projection: {
    task_type: 'narrative_projection',
    default_response_mode: 'json_schema',
    default_prompt_preset: 'default_narrative_projection_v1',
    default_decoder: 'default_json_schema',
    default_route_id: 'default.context_summary',
    default_schema: CONTEXT_SUMMARY_SCHEMA,
    default_strict: true,
    default_privacy_tier: 'trusted_cloud'
  },
  entity_extraction: {
    task_type: 'entity_extraction',
    default_response_mode: 'json_schema',
    default_prompt_preset: 'default_entity_extraction_v1',
    default_decoder: 'default_json_schema',
    default_route_id: 'default.context_summary',
    default_schema: ENTITY_EXTRACTION_SCHEMA,
    default_strict: true,
    default_privacy_tier: 'trusted_cloud'
  },
  classification: {
    task_type: 'classification',
    default_response_mode: 'json_schema',
    default_prompt_preset: 'default_classification_v1',
    default_decoder: 'default_json_schema',
    default_route_id: 'default.context_summary',
    default_schema: CLASSIFICATION_SCHEMA,
    default_strict: true,
    default_privacy_tier: 'trusted_cloud'
  },
  moderation: {
    task_type: 'moderation',
    default_response_mode: 'json_schema',
    default_prompt_preset: 'default_moderation_v1',
    default_decoder: 'default_json_schema',
    default_route_id: 'default.moderation',
    default_schema: MODERATION_SCHEMA,
    default_strict: true,
    default_privacy_tier: 'trusted_cloud'
  },
  embedding: {
    task_type: 'embedding',
    default_response_mode: 'embedding',
    default_prompt_preset: 'default_embedding_v1',
    default_decoder: 'default_embedding',
    default_route_id: 'default.embedding',
    default_strict: false,
    default_privacy_tier: 'trusted_cloud'
  },
  rerank: {
    task_type: 'rerank',
    default_response_mode: 'json_object',
    default_prompt_preset: 'default_rerank_v1',
    default_decoder: 'default_json_object',
    default_route_id: 'default.context_summary',
    default_strict: false,
    default_privacy_tier: 'trusted_cloud'
  }
};

const mergeTaskOverride = (base: AiTaskOverride | null, override: AiTaskOverride | null): AiTaskOverride | null => {
  if (!base && !override) {
    return null;
  }

  return {
    ...(base ?? {}),
    ...(override ?? {}),
    prompt: {
      ...(base?.prompt ?? {}),
      ...(override?.prompt ?? {})
    },
    output: {
      ...(base?.output ?? {}),
      ...(override?.output ?? {})
    },
    parse: {
      ...(base?.parse ?? {}),
      ...(override?.parse ?? {})
    },
    route: {
      ...(base?.route ?? {}),
      ...(override?.route ?? {})
    },
    metadata: {
      ...(base?.metadata ?? {}),
      ...(override?.metadata ?? {})
    }
  };
};

export const getAiTaskDefinition = (taskType: AiTaskType): AiTaskDefinition => {
  return TASK_DEFINITIONS[taskType];
};

export const resolveAiTaskConfig = (input: {
  taskType: AiTaskType;
  packAiConfig?: AiPackConfig | null;
  inlineOverride?: AiTaskOverride | null;
}): AiResolvedTaskConfig => {
  const definition = getAiTaskDefinition(input.taskType);
  const packDefaults = input.packAiConfig?.defaults;
  const packTaskOverride = input.packAiConfig?.tasks?.[input.taskType] ?? null;
  const mergedOverride = mergeTaskOverride(packTaskOverride, input.inlineOverride ?? null);

  return {
    definition,
    override: mergedOverride,
    output: {
      mode: mergedOverride?.output?.mode ?? definition.default_response_mode,
      schema: mergedOverride?.output?.schema ?? definition.default_schema,
      strict: mergedOverride?.output?.strict ?? definition.default_strict
    },
    prompt: {
      preset: mergedOverride?.prompt?.preset ?? packDefaults?.prompt_preset ?? definition.default_prompt_preset,
      system_append: mergedOverride?.prompt?.system_append,
      developer_append: mergedOverride?.prompt?.developer_append,
      user_prefix: mergedOverride?.prompt?.user_prefix,
      include_sections: mergedOverride?.prompt?.include_sections,
      examples: mergedOverride?.prompt?.examples
    },
    parse: {
      decoder: mergedOverride?.parse?.decoder ?? packDefaults?.decoder ?? definition.default_decoder,
      unwrap: mergedOverride?.parse?.unwrap,
      field_alias: mergedOverride?.parse?.field_alias,
      required_fields: mergedOverride?.parse?.required_fields,
      defaults: mergedOverride?.parse?.defaults
    },
    route: {
      route_id: mergedOverride?.route?.route_id ?? packDefaults?.route_id ?? definition.default_route_id ?? undefined,
      provider: mergedOverride?.route?.provider,
      model: mergedOverride?.route?.model,
      latency_tier: mergedOverride?.route?.latency_tier,
      determinism_tier: mergedOverride?.route?.determinism_tier,
      privacy_tier: mergedOverride?.route?.privacy_tier ?? packDefaults?.privacy_tier ?? definition.default_privacy_tier
    },
    metadata: mergedOverride?.metadata
  };
};
