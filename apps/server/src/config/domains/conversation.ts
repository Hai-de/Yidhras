import type { ConversationDomainConfig } from '../../conversation/format_config_schemas.js';
import { ConversationDomainConfigSchema } from '../../conversation/format_config_schemas.js';

/**
 * Config domain for conversation profiles.
 * Loaded from data/configw/conf.d/conversation.yaml.
 * The `conversation` top-level key comes from RuntimeConfig; this schema
 * defines the shape of the value under that key.
 *
 * Design doc: .limcode/design/multi-turn-conversation-design.md §6.4
 */

export const CONVERSATION_CONFIG_DOMAIN = 'conversation';

export const ConversationConfigSchema = ConversationDomainConfigSchema;

export type ConversationConfig = ConversationDomainConfig;

export const CONVERSATION_CONFIG_DEFAULTS: ConversationConfig = {
  profiles: {}
};
