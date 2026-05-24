/**
 * ConversationFormatConfig — re-exports all schemas/types/defaults from format_config_schemas.ts
 * and adds runtime resolution functions that depend on getRuntimeConfig().
 *
 * Schemas were extracted to format_config_schemas.ts to break a circular dependency:
 * format_config.ts → runtime_config.ts → domains/index.ts → domains/conversation.ts → format_config_schemas.ts (no circle)
 *
 * Design doc: .limcode/design/multi-turn-conversation-design.md §6.4
 */

export type {
  CompressionConfig,
  ConversationDomainConfig,
  ConversationFormatConfig,
  MessageAssemblyConfig,
  MessageAssemblyInjection,
  MessageAssemblyInjectionField,
  MessageAssemblySlotMapping,
  RoleFormatConfig,
  SpeakerFormatConfig,
  TranscriptConfig
} from './format_config_schemas.js';
export {
  CompressionConfigSchema,
  ConversationDomainConfigSchema,
  ConversationFormatConfigSchema,
  DEFAULT_CONVERSATION_FORMAT_CONFIG,
  MessageAssemblyConfigSchema,
  MessageAssemblyInjectionFieldSchema,
  MessageAssemblyInjectionSchema,
  MessageAssemblySlotMappingSchema,
  RoleFormatConfigSchema,
  SpeakerFormatConfigSchema,
  TranscriptConfigSchema
} from './format_config_schemas.js';

import { getRuntimeConfig } from '../config/runtime_config.js';
import type { ConversationFormatConfig } from './format_config_schemas.js';
import { ConversationFormatConfigSchema,DEFAULT_CONVERSATION_FORMAT_CONFIG } from './format_config_schemas.js';
import type { AgentConversationMemory, ConversationMemoryMetadata } from './types.js';

// ── Resolution ──────────────────────────────────────────────

export function resolveConversationFormatConfig(
  profileName?: string | null
): ConversationFormatConfig {
  if (!profileName) {
    return DEFAULT_CONVERSATION_FORMAT_CONFIG;
  }
  try {
    const runtimeConfig = getRuntimeConfig();
    const profiles = runtimeConfig?.conversation?.profiles;
    if (profiles && profiles[profileName]) {
      // eslint-disable-next-line security/detect-object-injection
      return profiles[profileName];
    }
  } catch {
    // Fall through to default
  }
  return DEFAULT_CONVERSATION_FORMAT_CONFIG;
}

/** Phase 3: Resolve effective format config, incorporating per-conversation overrides (A+C hybrid). */
export function resolveEffectiveFormatConfig(
  memory: AgentConversationMemory,
  profileName?: string | null
): ConversationFormatConfig {
  const meta = memory.metadata as ConversationMemoryMetadata | undefined;

  // 方案 C: profile name override — highest priority
  const effectiveProfile = meta?.conversation_profile_override ?? profileName;

  // 方案 A: full config override
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
  const base = meta?.conversation_format_override as ConversationFormatConfig | undefined
    ?? resolveConversationFormatConfig(effectiveProfile);

  // Validate with Zod — missing required fields throw, no silent fallback
  return ConversationFormatConfigSchema.parse(base);
}
