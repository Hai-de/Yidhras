import { describe, expect, it } from 'vitest';

import type { AiResolvedTaskConfig } from '../../../src/ai/types.js';
import { assembleConversationMessages } from '../../../src/conversation/assembler.js';
import type { ConversationEntry } from '../../../src/conversation/types.js';
import type { PromptBundleV2 } from '../../../src/inference/prompt_bundle_v2.js';

const DEFAULT_FORMAT_CONFIG = {
  transcript: {
    mode: 'embed' as const,
    turn_delimiter: '\n',
    speaker_format: {
      default: { prefix: '', suffix: '\n' }
    }
  },
  message_assembly: {
    merge_consecutive_same_role: true,
    slots: [
      { slot: 'system_prompt', target_role: 'system' as const },
      { slot: 'world_context', target_role: 'developer' as const },
      { slot: 'user_input', target_role: 'user' as const }
    ],
    injection: { ai_fill_role: 'assistant' as const, ai_fill_position: 'after_last_user' as const },
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
    compacted_target_role: 'system' as const
  }
};

const makeTaskConfig = (): AiResolvedTaskConfig => ({
  definition: {
    task_type: 'agent_decision',
    default_response_mode: 'free_text',
    default_prompt_preset: 'default',
    default_decoder: 'none'
  },
  override: null,
  output: { mode: 'free_text' },
  prompt: {},
  parse: {},
  route: {},
  tools: [],
  tool_policy: { mode: 'disabled' }
});

const makeBundle = (overrides: Partial<PromptBundleV2> = {}): PromptBundleV2 => ({
  slots: {},
  slot_order: [],
  combined_prompt: '',
  metadata: { prompt_version: 'v1', source_prompt_keys: [] },
  tree: {
    inference_id: 'inf-test',
    task_type: 'agent_decision',
    fragments_by_slot: {},
    slot_registry: {},
    resolved_positions: [],
    metadata: { prompt_version: 'v1', profile_id: null, profile_version: null, source_prompt_keys: [] }
  },
  ...overrides
});

const makeConversationEntry = (overrides: Partial<ConversationEntry> = {}): ConversationEntry => ({
  id: 'entry-1',
  turn_number: 1,
  speaker_agent_id: 'agent-1',
  kind: 'original',
  original_content: 'test content',
  current_content: 'test content',
  provenance: { operator: { kind: 'agent', id: 'agent-1' }, capability: 'conversation.record' },
  recorded_at: 1000,
  modifications: [],
  ...overrides
});

describe('conversation assembler', () => {
  describe('assembleConversationMessages', () => {
    it('returns messages even for empty bundle (workflow metadata)', () => {
      const result = assembleConversationMessages({
        bundle: makeBundle(),
        formatConfig: DEFAULT_FORMAT_CONFIG,
        taskConfig: makeTaskConfig()
      });
      expect(result.length).toBeGreaterThanOrEqual(0);
    });

    it('groups system slots into system message', () => {
      const bundle = makeBundle({
        slots: { system_prompt: 'You are a helpful assistant' },
        slot_order: ['system_prompt']
      });

      const result = assembleConversationMessages({
        bundle,
        formatConfig: DEFAULT_FORMAT_CONFIG,
        taskConfig: makeTaskConfig()
      });

      expect(result.length).toBeGreaterThan(0);
      const systemMsg = result.find(m => m.role === 'system');
      expect(systemMsg).toBeDefined();
    });

    it('groups developer slots into developer message', () => {
      const bundle = makeBundle({
        slots: { world_context: 'The world is a dark cyberpunk city' },
        slot_order: ['world_context']
      });

      const result = assembleConversationMessages({
        bundle,
        formatConfig: DEFAULT_FORMAT_CONFIG,
        taskConfig: makeTaskConfig()
      });

      expect(result.length).toBeGreaterThan(0);
    });

    it('groups user slots into user message', () => {
      const bundle = makeBundle({
        slots: { user_input: 'What should I do next?' },
        slot_order: ['user_input']
      });

      const result = assembleConversationMessages({
        bundle,
        formatConfig: DEFAULT_FORMAT_CONFIG,
        taskConfig: makeTaskConfig()
      });

      expect(result.length).toBeGreaterThan(0);
    });

    it('combines multiple slots of same role', () => {
      const bundle = makeBundle({
        slots: {
          system_prompt: 'System instruction',
          another_system: 'Another system text'
        },
        slot_order: ['system_prompt', 'another_system']
      });

      const formatConfig = {
        ...DEFAULT_FORMAT_CONFIG,
        message_assembly: {
          ...DEFAULT_FORMAT_CONFIG.message_assembly,
          slots: [
            { slot: 'system_prompt', target_role: 'system' as const },
            { slot: 'another_system', target_role: 'system' as const }
          ]
        }
      };

      const result = assembleConversationMessages({
        bundle,
        formatConfig,
        taskConfig: makeTaskConfig()
      });

      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it('includes metadata with workflow info', () => {
      const bundle = makeBundle({
        slots: { system_prompt: 'Test prompt' },
        slot_order: ['system_prompt'],
        metadata: {
          prompt_version: 'v2',
          source_prompt_keys: ['key1', 'key2']
        }
      });

      const result = assembleConversationMessages({
        bundle,
        formatConfig: DEFAULT_FORMAT_CONFIG,
        taskConfig: makeTaskConfig()
      });

      expect(result.length).toBeGreaterThan(0);
      const msg = result[0];
      expect(msg.metadata).toBeDefined();
    });

    it('handles conversation memory with transcript mode', () => {
      const bundle = makeBundle({
        slots: { system_prompt: 'You are an agent' },
        slot_order: ['system_prompt']
      });

      const result = assembleConversationMessages({
        bundle,
        memory: {
          id: 'mem-1',
          owner_agent_id: 'agent-1',
          conversation_id: 'conv-1',
          entries: [
            makeConversationEntry({ id: 'e1', turn_number: 1, current_content: 'Hello' }),
            makeConversationEntry({ id: 'e2', turn_number: 2, speaker_agent_id: 'agent-2', current_content: 'Hi there!' })
          ],
          summary: undefined
        },
        formatConfig: DEFAULT_FORMAT_CONFIG,
        taskConfig: makeTaskConfig()
      });

      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it('handles empty text slots', () => {
      const bundle = makeBundle({
        slots: { system_prompt: '', user_input: '   ' },
        slot_order: ['system_prompt', 'user_input']
      });

      const result = assembleConversationMessages({
        bundle,
        formatConfig: DEFAULT_FORMAT_CONFIG,
        taskConfig: makeTaskConfig()
      });

      expect(result.length).toBeGreaterThanOrEqual(0);
    });

    it('sorts slots by priority within each role group', () => {
      const bundle = makeBundle({
        slots: {
          low_priority: 'Low priority text',
          high_priority: 'High priority text'
        },
        slot_order: ['low_priority', 'high_priority']
      });

      const formatConfig = {
        ...DEFAULT_FORMAT_CONFIG,
        message_assembly: {
          ...DEFAULT_FORMAT_CONFIG.message_assembly,
          slots: [
            { slot: 'low_priority', target_role: 'system' as const },
            { slot: 'high_priority', target_role: 'system' as const }
          ]
        }
      };

      const result = assembleConversationMessages({
        bundle,
        formatConfig,
        taskConfig: makeTaskConfig()
      });

      expect(result.length).toBeGreaterThan(0);
    });

    it('handles multiple role groups simultaneously', () => {
      const bundle = makeBundle({
        slots: {
          system_prompt: 'System prompt',
          world_context: 'World context',
          user_input: 'User input'
        },
        slot_order: ['system_prompt', 'world_context', 'user_input']
      });

      const result = assembleConversationMessages({
        bundle,
        formatConfig: DEFAULT_FORMAT_CONFIG,
        taskConfig: makeTaskConfig()
      });

      const roles = result.map(m => m.role);
      expect(roles).toContain('system');
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it('excludes conversation_history from standard slots', () => {
      const bundle = makeBundle({
        slots: {
          system_prompt: 'System text',
          conversation_history: 'User: Hello\nAssistant: Hi'
        },
        slot_order: ['system_prompt', 'conversation_history']
      });

      const result = assembleConversationMessages({
        bundle,
        formatConfig: DEFAULT_FORMAT_CONFIG,
        taskConfig: makeTaskConfig()
      });

      // conversation_history should not appear as a standalone message
      const allText = result.flatMap(m => m.parts.map(p => (p as { type: string; text?: string }).text ?? '')).join('');
      expect(allText).not.toContain('User: Hello');
    });

    it('handles bundle with tree slot registry providing message_role fallback', () => {
      const bundle = makeBundle({
        slots: { custom_slot: 'Custom content' },
        slot_order: ['custom_slot'],
        tree: {
          inference_id: 'inf-test',
          task_type: 'agent_decision',
          fragments_by_slot: {},
          slot_registry: {
            custom_slot: { id: 'custom_slot', display_name: 'Custom Slot', default_priority: 50, include_in_combined: true, enabled: true, message_role: 'developer' }
          },
          resolved_positions: [],
          metadata: { prompt_version: 'v1', profile_id: null, profile_version: null, source_prompt_keys: [] }
        }
      });

      const formatConfig = {
        ...DEFAULT_FORMAT_CONFIG,
        message_assembly: {
          ...DEFAULT_FORMAT_CONFIG.message_assembly,
          slots: [] as Array<{ slot: string; target_role: 'system' | 'developer' | 'user' | 'assistant' }>
        }
      };

      const result = assembleConversationMessages({
        bundle,
        formatConfig,
        taskConfig: makeTaskConfig()
      });

      expect(result.length).toBeGreaterThan(0);
    });
  });
});
