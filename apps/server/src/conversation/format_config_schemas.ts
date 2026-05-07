/**
 * Schema-only exports for ConversationFormatConfig.
 * Split from format_config.ts to break a circular dependency:
 * format_config.ts → runtime_config.ts → domains/index.ts → domains/conversation.ts → format_config.ts
 *
 * By keeping schemas in this file (which does NOT import getRuntimeConfig),
 * domains/conversation.ts can import them without creating a cycle.
 *
 * Design doc: .limcode/design/multi-turn-conversation-design.md §6.4
 */

import { z } from 'zod';

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
    mode: z.enum(['embed', 'role_map']).default('embed'),
    turn_delimiter: z.string().default('\n'),
    speaker_format: z
      .object({
        default: SpeakerFormatConfigSchema
      })
      .catchall(SpeakerFormatConfigSchema)
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
      .union([
        z.enum(['after_last_user', 'after_last_system', 'at_end']),
        z.number().int().nonnegative()
      ])
      .default('after_last_user')
  })
  .strict();

export type MessageAssemblyInjection = z.infer<typeof MessageAssemblyInjectionSchema>;

/** Accepts a single injection config or an array (multi-injection). */
export const MessageAssemblyInjectionFieldSchema = z.union([
  MessageAssemblyInjectionSchema,
  z.array(MessageAssemblyInjectionSchema)
]);

export type MessageAssemblyInjectionField = z.infer<typeof MessageAssemblyInjectionFieldSchema>;

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
    injection: MessageAssemblyInjectionFieldSchema,
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
    enable_ai_summary: z.boolean().default(false),
    window_turns: z.number().int().nonnegative().default(20),
    summary_trigger_turns: z.number().int().nonnegative().default(30),
    preserve_recent: z.number().int().nonnegative().default(5),
    compacted_target_role: z.enum(['system', 'developer', 'user']).default('system')
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
    mode: 'embed',
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
    enable_ai_summary: false,
    window_turns: 20,
    summary_trigger_turns: 30,
    preserve_recent: 5,
    compacted_target_role: 'system'
  }
};
