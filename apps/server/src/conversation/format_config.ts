/**
 * ConversationFormatConfig — Zod schemas and TypeScript types.
 * Phase 1: transcript, message_assembly (slot mapping + injection + role format), compression.
 * Phase 2/3 fields (nesting, jailbreak_patterns, compacted_target_role) are intentionally excluded.
 *
 * Design doc: .limcode/design/multi-turn-conversation-design.md §6.4
 */

import { z } from 'zod';

import { getRuntimeConfig } from '../config/runtime_config.js';

// ── Speaker Format ─────────────────────────────────────────

export const SpeakerFormatConfigSchema = z
  .object({
    prefix: z.string().default(''),
    suffix: z.string().default('\n')
  })
  .strict();

export type SpeakerFormatConfig = z.infer<typeof SpeakerFormatConfigSchema>;

// ── Transcript ─────────────────────────────────────────────

export const TranscriptConfigSchema = z
  .object({
    turn_delimiter: z.string().default('\n'),
    speaker_format: z
      .object({
        default: SpeakerFormatConfigSchema
      })
      .strict()
  })
  .strict();

export type TranscriptConfig = z.infer<typeof TranscriptConfigSchema>;

// ── Message Assembly ───────────────────────────────────────

export const MessageAssemblySlotMappingSchema = z
  .object({
    slot: z.string(),
    target_role: z.enum(['system', 'developer', 'user', 'assistant'])
  })
  .strict();

export type MessageAssemblySlotMapping = z.infer<typeof MessageAssemblySlotMappingSchema>;

export const MessageAssemblyInjectionSchema = z
  .object({
    ai_fill_role: z.enum(['assistant']).default('assistant'),
    ai_fill_position: z
      .enum(['after_last_user', 'after_last_system', 'at_end'])
      .default('after_last_user')
  })
  .strict();

export type MessageAssemblyInjection = z.infer<typeof MessageAssemblyInjectionSchema>;

export const RoleFormatConfigSchema = z
  .object({
    prefix: z.string().default(''),
    suffix: z.string().default('')
  })
  .strict();

export type RoleFormatConfig = z.infer<typeof RoleFormatConfigSchema>;

export const MessageAssemblyConfigSchema = z
  .object({
    merge_consecutive_same_role: z.boolean().default(true),
    slots: z.array(MessageAssemblySlotMappingSchema),
    injection: MessageAssemblyInjectionSchema,
    role_format: z
      .object({
        system: RoleFormatConfigSchema,
        developer: RoleFormatConfigSchema,
        user: RoleFormatConfigSchema,
        assistant: RoleFormatConfigSchema
      })
      .strict()
  })
  .strict();

export type MessageAssemblyConfig = z.infer<typeof MessageAssemblyConfigSchema>;

// ── Compression ────────────────────────────────────────────

export const CompressionConfigSchema = z
  .object({
    window_turns: z.number().int().nonnegative().default(20),
    summary_trigger_turns: z.number().int().nonnegative().default(30),
    preserve_recent: z.number().int().nonnegative().default(5)
  })
  .strict();

export type CompressionConfig = z.infer<typeof CompressionConfigSchema>;

// ── Top-Level Format Config ────────────────────────────────

export const ConversationFormatConfigSchema = z
  .object({
    transcript: TranscriptConfigSchema,
    message_assembly: MessageAssemblyConfigSchema,
    compression: CompressionConfigSchema
  })
  .passthrough();

export type ConversationFormatConfig = z.infer<typeof ConversationFormatConfigSchema>;

// ── Profile Wrapper (for RuntimeConfig.conversation) ───────

export const ConversationDomainConfigSchema = z
  .object({
    profiles: z.record(z.string(), ConversationFormatConfigSchema)
  })
  .passthrough();

export type ConversationDomainConfig = z.infer<typeof ConversationDomainConfigSchema>;

// ── Default Config (backward-compatible with current 3-message behavior) ──

export const DEFAULT_CONVERSATION_FORMAT_CONFIG: ConversationFormatConfig = {
  transcript: {
    turn_delimiter: '\n',
    speaker_format: {
      default: {
        prefix: '',
        suffix: '\n'
      }
    }
  },
  message_assembly: {
    merge_consecutive_same_role: true,
    slots: [
      { slot: 'system_core', target_role: 'system' },
      { slot: 'system_policy', target_role: 'system' },
      { slot: 'role_core', target_role: 'developer' },
      { slot: 'world_context', target_role: 'developer' },
      { slot: 'memory_short_term', target_role: 'developer' },
      { slot: 'memory_long_term', target_role: 'developer' },
      { slot: 'memory_summary', target_role: 'developer' },
      { slot: 'output_contract', target_role: 'user' },
      { slot: 'conversation_history', target_role: 'user' },
      { slot: 'post_process', target_role: 'user' }
    ],
    injection: {
      ai_fill_role: 'assistant',
      ai_fill_position: 'after_last_user'
    },
    role_format: {
      system: { prefix: '', suffix: '' },
      developer: { prefix: '', suffix: '' },
      user: { prefix: '', suffix: '' },
      assistant: { prefix: '', suffix: '' }
    }
  },
  compression: {
    window_turns: 20,
    summary_trigger_turns: 30,
    preserve_recent: 5
  }
};

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
