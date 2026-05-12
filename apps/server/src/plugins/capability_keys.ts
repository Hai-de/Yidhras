import type { PluginCapabilityLevel } from './context.js';

export const PLUGIN_CAPABILITY_KEY = {
  CONTEXT_SOURCE_REGISTER: 'server.context_source.register',
  PROMPT_WORKFLOW_REGISTER: 'server.prompt_workflow.register',
  API_ROUTE_REGISTER: 'server.api_route.register',
  INFERENCE_REQUEST: 'server.inference.request',
  STEP_CONTRIBUTOR_REGISTER: 'server.step_contributor.register',
  RULE_CONTRIBUTOR_REGISTER: 'server.rule_contributor.register',
  QUERY_CONTRIBUTOR_REGISTER: 'server.query_contributor.register',
  DATA_CLEANER_REGISTER: 'server.data_cleaner.register',
  SLOT_CONDITION_REGISTER: 'server.slot_condition.register',
  SLOT_CONTENT_TRANSFORM_REGISTER: 'server.slot_content_transform.register',
  PERCEPTION_RESOLVER_REGISTER: 'server.perception_resolver.register'
} as const;

export type PluginCapabilityKey = (typeof PLUGIN_CAPABILITY_KEY)[keyof typeof PLUGIN_CAPABILITY_KEY];

export const CAPABILITY_KEY_MIN_LEVEL: Record<PluginCapabilityKey, PluginCapabilityLevel> = {
  [PLUGIN_CAPABILITY_KEY.CONTEXT_SOURCE_REGISTER]: 'pack_scoped',
  [PLUGIN_CAPABILITY_KEY.PROMPT_WORKFLOW_REGISTER]: 'pack_scoped',
  [PLUGIN_CAPABILITY_KEY.API_ROUTE_REGISTER]: 'pack_scoped',
  [PLUGIN_CAPABILITY_KEY.INFERENCE_REQUEST]: 'pack_scoped',
  [PLUGIN_CAPABILITY_KEY.STEP_CONTRIBUTOR_REGISTER]: 'pack_scoped',
  [PLUGIN_CAPABILITY_KEY.RULE_CONTRIBUTOR_REGISTER]: 'pack_scoped',
  [PLUGIN_CAPABILITY_KEY.QUERY_CONTRIBUTOR_REGISTER]: 'pack_scoped',
  [PLUGIN_CAPABILITY_KEY.DATA_CLEANER_REGISTER]: 'pack_scoped',
  [PLUGIN_CAPABILITY_KEY.SLOT_CONDITION_REGISTER]: 'pack_scoped',
  [PLUGIN_CAPABILITY_KEY.SLOT_CONTENT_TRANSFORM_REGISTER]: 'pack_scoped',
  [PLUGIN_CAPABILITY_KEY.PERCEPTION_RESOLVER_REGISTER]: 'pack_scoped'
};
