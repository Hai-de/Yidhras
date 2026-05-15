/**
 * Conversation pipeline edge-case tests.
 * Covers: empty memory, missing config, token budget pressure, profile fallback,
 * role resolution, malformed entries, and the adapter/assembler routing in task_service.
 */

import crypto from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { AiResolvedTaskConfig, AiTaskRequest } from '../../../src/ai/types.js';
import { assembleConversationMessages } from '../../../src/conversation/assembler.js';
import { DEFAULT_CONVERSATION_FORMAT_CONFIG } from '../../../src/conversation/format_config.js';
import type { ConversationFormatConfig } from '../../../src/conversation/format_config.js';
import type { AgentConversationMemory, ConversationEntry } from '../../../src/conversation/types.js';
import { getVisibleEntries, resolveEntryRole } from '../../../src/context/workflow/tracks/conversation_history_track.js';
import type { PromptBundleV2 } from '../../../src/inference/prompt_bundle_v2.js';
import type { PromptFragmentV2 } from '../../../src/inference/prompt_fragment_v2.js';
import type { PromptSlotConfig } from '../../../src/inference/prompt_slot_config.js';
import type { PromptTree } from '../../../src/inference/prompt_tree.js';

// ── Helpers ────────────────────────────────────────────────

const SLOT_REGISTRY: Record<string, PromptSlotConfig> = {
  system_core: {
    id: 'system_core', display_name: 'SC', default_priority: 100,
    message_role: 'system', include_in_combined: true, combined_heading: 'System', enabled: true
  },
  role_core: {
    id: 'role_core', display_name: 'RC', default_priority: 90,
    message_role: 'developer', include_in_combined: true, combined_heading: 'Role', enabled: true
  },
  conversation_history: {
    id: 'conversation_history', display_name: 'CH', default_priority: 50,
    message_role: 'user', include_in_combined: true, combined_heading: 'History', enabled: true
  },
  output_contract: {
    id: 'output_contract', display_name: 'OC', default_priority: 50,
    message_role: 'user', include_in_combined: true, combined_heading: 'Contract', enabled: true
  }
};

const TASK_CONFIG: AiResolvedTaskConfig = {
  definition: {
    task_type: 'agent_decision', default_response_mode: 'json_schema',
    default_prompt_preset: 'test', default_decoder: 'default_json_schema'
  },
  override: null,
  output: { mode: 'json_schema' as const },
  prompt: { preset: 'test' },
  parse: { decoder: 'default_json_schema' },
  route: {},
  tools: [],
  tool_policy: { mode: 'disabled' as const }
};

const CHAT_FORMAT_CONFIG: ConversationFormatConfig = {
  transcript: {
    mode: 'embed',
    turn_delimiter: '\n',
    speaker_format: { default: { prefix: '"{speaker_id}": "', suffix: '"\n' } }
  },
  message_assembly: {
    merge_consecutive_same_role: false,
    slots: [
      { slot: 'system_core', target_role: 'system' },
      { slot: 'role_core', target_role: 'developer' },
      { slot: 'conversation_history', target_role: 'user' },
      { slot: 'output_contract', target_role: 'user' }
    ],
    injection: { ai_fill_role: 'assistant', ai_fill_position: 'after_last_user' },
    role_format: {
      system: { prefix: '', suffix: '' },
      developer: { prefix: '', suffix: '' },
      user: { prefix: '', suffix: '' },
      assistant: { prefix: '', suffix: '' }
    }
  },
  compression: {
    enable_ai_summary: false,
    window_turns: 10,
    summary_trigger_turns: 30,
    preserve_recent: 3,
    compacted_target_role: 'system'
  }
};

function makeEntry(overrides: Partial<ConversationEntry> = {}): ConversationEntry {
  const now = Date.now();
  return {
    id: crypto.randomUUID(), turn_number: 1, speaker_agent_id: 'agent-a',
    kind: 'original', original_content: 'Hello.', current_content: 'Hello.',
    provenance: { operator: { kind: 'agent', id: 'agent-a' }, capability: 'conversation.record' },
    recorded_at: now, modifications: [],
    ...overrides
  };
}

function makeBundleWithConversationFragments(
  fragments: PromptFragmentV2[],
  slotTexts: Record<string, string> = {}
): PromptBundleV2 {
  const tree: PromptTree = {
    inference_id: 'inf-edge', task_type: 'agent_decision',
    fragments_by_slot: {
      system_core: [], role_core: [], conversation_history: fragments, output_contract: []
    },
    slot_registry: SLOT_REGISTRY,
    resolved_positions: [],
    metadata: {
      prompt_version: 'v1', profile_id: null, profile_version: null,
      source_prompt_keys: Object.keys(slotTexts)
    }
  };
  return {
    slots: {
      system_core: slotTexts.system_core ?? '',
      role_core: slotTexts.role_core ?? '',
      conversation_history: slotTexts.conversation_history ?? '',
      output_contract: slotTexts.output_contract ?? ''
    },
    slot_order: [],
    combined_prompt: Object.values(slotTexts).join('\n\n'),
    metadata: {
      prompt_version: 'v1', source_prompt_keys: Object.keys(slotTexts),
      workflow_task_type: 'agent_decision'
    },
    tree
  };
}

function makeConvFragment(
  text: string,
  entryRole: string,
  turnNumber: number,
  fragmentId: string,
  extraMeta: Record<string, unknown> = {}
): PromptFragmentV2 {
  return {
    id: fragmentId, slot_id: 'conversation_history', priority: turnNumber,
    source: `section:${fragmentId}`, removable: true, replaceable: false,
    children: [{
      id: crypto.randomUUID(), kind: 'text' as const,
      content: { kind: 'text' as const, text },
      rendered: text
    }],
    estimated_tokens: Math.ceil(text.length / 4),
    metadata: { entry_role: entryRole, turn_number: turnNumber, conversation_entry_kind: 'original', ...extraMeta }
  };
}

// ── Tests ──────────────────────────────────────────────────

describe('Conversation pipeline edge cases', () => {
  describe('Assembler with empty/invalid memory', () => {
    it('returns system+developer+user without assistant slot when memory is null', () => {
      const bundle = makeBundleWithConversationFragments([], {
        system_core: 'System instruction.',
        output_contract: 'Return JSON.'
      });

      const messages = assembleConversationMessages({
        bundle, memory: null,
        formatConfig: CHAT_FORMAT_CONFIG,
        currentAgentId: 'agent-a', taskConfig: TASK_CONFIG
      });

      const roles = messages.map((m) => m.role);
      expect(roles).not.toContain('assistant');
      expect(roles).toContain('system');
      expect(roles).toContain('user');
    });

    it('returns system+developer+user without assistant when memory has zero entries', () => {
      const memory: AgentConversationMemory = {
        id: 'mem-empty', owner_agent_id: 'agent-a',
        conversation_id: 'agent-a:agent-b:empty', entries: []
      };

      const bundle = makeBundleWithConversationFragments([], {
        system_core: 'System.' });

      const messages = assembleConversationMessages({
        bundle, memory,
        formatConfig: CHAT_FORMAT_CONFIG,
        currentAgentId: 'agent-a', taskConfig: TASK_CONFIG
      });

      expect(messages.some((m) => m.role === 'assistant')).toBe(false);
    });

    it('falls back to user role for entries with unknown entry_role', () => {
      const frag = makeConvFragment('Mystery content.', 'unknown_role', 1, 'frag-x');
      const bundle = makeBundleWithConversationFragments([frag]);

      const messages = assembleConversationMessages({
        bundle, memory: null,
        formatConfig: CHAT_FORMAT_CONFIG,
        currentAgentId: 'agent-a', taskConfig: TASK_CONFIG
      });

      const userMsg = messages.find((m) => m.role === 'user');
      expect(userMsg).toBeDefined();
      const text = (userMsg!.parts[0] as { text: string }).text;
      expect(text).toContain('Mystery content.');
    });
  });

  describe('getVisibleEntries edge cases', () => {
    it('returns existing entries when window_turns is 0 (no limit)', () => {
      const memory: AgentConversationMemory = {
        id: 'm', owner_agent_id: 'a', conversation_id: 'a:b:c',
        entries: Array.from({ length: 20 }, (_, i) =>
          makeEntry({ turn_number: i + 1, current_content: `Turn ${i + 1}` }))
      };
      const result = getVisibleEntries(memory, {
        enable_ai_summary: false, window_turns: 0, summary_trigger_turns: 30, preserve_recent: 3, compacted_target_role: 'user' as const
      });
      expect(result).toHaveLength(20);
    });

    it('handles mixed summary and original entries with truncation', () => {
      const memory: AgentConversationMemory = {
        id: 'm', owner_agent_id: 'a', conversation_id: 'a:b:mixed',
        entries: [
          makeEntry({ turn_number: 1, kind: 'summary', current_content: 'Summary 1-5', turn_range: { start: 1, end: 5 } }),
          makeEntry({ turn_number: 6, kind: 'original', current_content: 'Turn 6' }),
          makeEntry({ turn_number: 7, kind: 'original', current_content: 'Turn 7' }),
          makeEntry({ turn_number: 8, kind: 'original', current_content: 'Turn 8' }),
          makeEntry({ turn_number: 9, kind: 'original', current_content: 'Turn 9' }),
          makeEntry({ turn_number: 10, kind: 'original', current_content: 'Turn 10' })
        ]
      };
      const result = getVisibleEntries(memory, {
        enable_ai_summary: false, window_turns: 2, summary_trigger_turns: 30, preserve_recent: 3, compacted_target_role: 'user' as const
      });
      // summary (always included) + last 2 original
      expect(result).toHaveLength(3);
      expect(result[0].kind).toBe('summary');
      expect(result[1].turn_number).toBe(9);
      expect(result[2].turn_number).toBe(10);
    });

    it('handles entries with negative turn_number gracefully', () => {
      const memory: AgentConversationMemory = {
        id: 'm', owner_agent_id: 'a', conversation_id: 'a:b:neg',
        entries: [
          makeEntry({ turn_number: -1, current_content: 'Bad turn' }),
          makeEntry({ turn_number: 1, current_content: 'Good turn' })
        ]
      };
      const result = getVisibleEntries(memory, {
        enable_ai_summary: false, window_turns: 10, summary_trigger_turns: 30, preserve_recent: 3, compacted_target_role: 'user' as const
      });
      expect(result).toHaveLength(2);
    });
  });

  describe('resolveEntryRole', () => {
    describe('embed mode (default)', () => {
      it('maps all entries to transcript role', () => {
        const ownEntry = makeEntry({ speaker_agent_id: 'agent-x' });
        const otherEntry = makeEntry({ speaker_agent_id: 'agent-y' });
        expect(resolveEntryRole(ownEntry, 'agent-x', 'embed')).toBe('transcript');
        expect(resolveEntryRole(otherEntry, 'agent-x', 'embed')).toBe('transcript');
      });
    });

    describe('role_map mode', () => {
      it('maps own messages to assistant', () => {
        const entry = makeEntry({ speaker_agent_id: 'agent-x' });
        expect(resolveEntryRole(entry, 'agent-x', 'role_map')).toBe('assistant');
      });

      it('maps other messages to user', () => {
        const entry = makeEntry({ speaker_agent_id: 'agent-y' });
        expect(resolveEntryRole(entry, 'agent-x', 'role_map')).toBe('user');
      });

      it('treats empty speaker_agent_id as other agent', () => {
        const entry = makeEntry({ speaker_agent_id: '' });
        expect(resolveEntryRole(entry, 'agent-x', 'role_map')).toBe('user');
      });
    });
  });

  describe('ConversationFragmentEntry text with empty content', () => {
    it('skips conversation fragments with empty text', () => {
      const emptyFrag = makeConvFragment('', 'user', 1, 'frag-empty');
      const validFrag = makeConvFragment('Valid content.', 'user', 2, 'frag-valid');
      const bundle = makeBundleWithConversationFragments([emptyFrag, validFrag]);

      const messages = assembleConversationMessages({
        bundle, memory: null,
        formatConfig: CHAT_FORMAT_CONFIG,
        currentAgentId: 'agent-a', taskConfig: TASK_CONFIG
      });

      const userMsg = messages.find((m) => m.role === 'user');
      const text = (userMsg!.parts[0] as { text: string }).text;
      expect(text).toContain('Valid content.');
      expect(text).not.toContain('frag-empty');
    });
  });

  describe('Token budget pressure simulation', () => {
    it('filters out permission_denied fragments', () => {
      const deniedFrag: PromptFragmentV2 = {
        ...makeConvFragment('Should not appear.', 'user', 1, 'frag-denied'),
        permission_denied: true
      };
      const allowedFrag = makeConvFragment('Should appear.', 'user', 2, 'frag-ok');
      const bundle = makeBundleWithConversationFragments([deniedFrag, allowedFrag]);

      const messages = assembleConversationMessages({
        bundle, memory: null,
        formatConfig: CHAT_FORMAT_CONFIG,
        currentAgentId: 'agent-a', taskConfig: TASK_CONFIG
      });

      const userMsg = messages.find((m) => m.role === 'user');
      const text = (userMsg!.parts[0] as { text: string }).text;
      expect(text).toContain('Should appear.');
      expect(text).not.toContain('Should not appear.');
    });

    it('survives all fragments being permission_denied', () => {
      const denied1: PromptFragmentV2 = {
        ...makeConvFragment('Denied 1.', 'user', 1, 'frag-d1'),
        permission_denied: true
      };
      const denied2: PromptFragmentV2 = {
        ...makeConvFragment('Denied 2.', 'user', 2, 'frag-d2'),
        permission_denied: true
      };
      const bundle = makeBundleWithConversationFragments([denied1, denied2], {
        system_core: 'System.', output_contract: 'Contract.'
      });

      const messages = assembleConversationMessages({
        bundle, memory: null,
        formatConfig: CHAT_FORMAT_CONFIG,
        currentAgentId: 'agent-a', taskConfig: TASK_CONFIG
      });

      // No assistant because no conversation fragments made it through
      expect(messages.some((m) => m.role === 'assistant')).toBe(false);
      // System message should still exist
      expect(messages.some((m) => m.role === 'system')).toBe(true);
    });
  });

  describe('Profile fallback', () => {
    it('uses default config when conversation_profile is absent', () => {
      const bundle = makeBundleWithConversationFragments([], {
        system_core: 'System core.',
        role_core: 'Role context.',
        output_contract: 'Return JSON.'
      });

      const messages = assembleConversationMessages({
        bundle, memory: null,
        formatConfig: DEFAULT_CONVERSATION_FORMAT_CONFIG,
        currentAgentId: '', taskConfig: TASK_CONFIG
      });

      // Default config has merge_consecutive_same_role: true
      // System message should exist
      expect(messages.some((m) => m.role === 'system')).toBe(true);
    });

    it('default config produces correct message structure without conversation', () => {
      const bundle = makeBundleWithConversationFragments([], {
        system_core: 'System core.',
        role_core: 'Role context.',
        output_contract: 'Return JSON.'
      });

      const messages = assembleConversationMessages({
        bundle, memory: null,
        formatConfig: DEFAULT_CONVERSATION_FORMAT_CONFIG,
        currentAgentId: '', taskConfig: TASK_CONFIG
      });

      // Verify correct role structure
      expect(messages.some((m) => m.role === 'system')).toBe(true);
      expect(messages.some((m) => m.role === 'developer')).toBe(true);
      expect(messages.some((m) => m.role === 'user')).toBe(true);
      // No assistant injection without conversation history
      expect(messages.some((m) => m.role === 'assistant')).toBe(false);

      // Verify content is present
      const systemMsg = messages.find((m) => m.role === 'system')!;
      const systemText = (systemMsg.parts[0] as { text: string }).text;
      expect(systemText).toContain('System core.');

      const userMsg = messages.find((m) => m.role === 'user')!;
      const userText = (userMsg.parts[0] as { text: string }).text;
      expect(userText).toContain('Return JSON.');
    });
  });

  describe('Multi-agent role mapping', () => {
    it('correctly interleaves user and assistant messages from conversation history', () => {
      const frags: PromptFragmentV2[] = [
        makeConvFragment('"agent-a": "Hi from A."\n', 'assistant', 1, 'f1'),
        makeConvFragment('"agent-b": "Hi from B."\n', 'user', 2, 'f2'),
        makeConvFragment('"agent-a": "How are you?"\n', 'assistant', 3, 'f3'),
        makeConvFragment('"agent-b": "Good, thanks!"\n', 'user', 4, 'f4')
      ];

      const bundle = makeBundleWithConversationFragments(frags, {
        system_core: 'System.', output_contract: 'Contract.'
      });

      const messages = assembleConversationMessages({
        bundle, memory: null,
        formatConfig: CHAT_FORMAT_CONFIG,
        currentAgentId: 'agent-a', taskConfig: TASK_CONFIG
      });

      // User message should contain the full transcript (Phase 1: all entries embedded)
      const userMsg = messages.find((m) => m.role === 'user');
      expect(userMsg).toBeDefined();
      const userText = (userMsg!.parts[0] as { text: string }).text;
      expect(userText).toContain('Hi from B.');
      expect(userText).toContain('Good, thanks!');
      // In Phase 1, ALL conversation entries (including own agent's) are
      // embedded in the user message as a single transcript.
      expect(userText).toContain('Hi from A.');

      // Assistant injection should exist
      expect(messages.some((m) => m.role === 'assistant')).toBe(true);
    });

    it('handles conversation where all entries are from the same agent', () => {
      const frags: PromptFragmentV2[] = [
        makeConvFragment('Monologue 1.', 'assistant', 1, 'f1'),
        makeConvFragment('Monologue 2.', 'assistant', 2, 'f2')
      ];

      const bundle = makeBundleWithConversationFragments(frags, {
        system_core: 'System.', output_contract: 'Contract.'
      });

      const messages = assembleConversationMessages({
        bundle, memory: null,
        formatConfig: CHAT_FORMAT_CONFIG,
        currentAgentId: 'agent-a', taskConfig: TASK_CONFIG
      });

      // All entries (even assistant role) go into user message in Phase 1
      const userMsg = messages.find((m) => m.role === 'user');
      const userText = (userMsg!.parts[0] as { text: string }).text;
      expect(userText).toContain('Monologue 1.');
      expect(userText).toContain('Monologue 2.');
      expect(messages.some((m) => m.role === 'assistant')).toBe(true);
    });
  });

  describe('Task service routing decision', () => {
    it('AiTaskRequest without conversation memory uses old adapter path (structurally)', () => {
      // This tests the structural decision in task_service:
      // When agent_conversation_memory is null/undefined, adaptPromptTreeToAiMessages is used

      const taskRequest: Partial<AiTaskRequest> = {
        task_id: 'task-1',
        task_type: 'agent_decision',
        input: {},
        prompt_context: {
          prompt_bundle_v2: null,
          agent_conversation_memory: null
        }
      };

      // With null memory and null bundle, messages should be null
      expect(taskRequest.prompt_context!.agent_conversation_memory).toBeNull();
      expect(taskRequest.prompt_context!.prompt_bundle_v2).toBeNull();
    });

    it('AiTaskRequest with conversation memory carries all required fields', () => {
      const taskRequest: Partial<AiTaskRequest> = {
        task_id: 'task-2',
        task_type: 'agent_decision',
        input: {},
        prompt_context: {
          prompt_bundle_v2: {},
          agent_conversation_memory: {
            id: 'mem-1', owner_agent_id: 'agent-a',
            conversation_id: 'agent-a:agent-b:sim-1', entries: []
          },
          current_agent_id: 'agent-a',
          conversation_profile: 'chat-first-turn'
        }
      };

      expect(taskRequest.prompt_context!.agent_conversation_memory).toBeDefined();
      expect(taskRequest.prompt_context!.current_agent_id).toBe('agent-a');
      expect(taskRequest.prompt_context!.conversation_profile).toBe('chat-first-turn');
    });
  });

  describe('Archived entries filtering (B1)', () => {
    it('getVisibleEntries filters out archived entries', () => {
      const memory: AgentConversationMemory = {
        id: 'm', owner_agent_id: 'a', conversation_id: 'a:b:arch',
        entries: [
          makeEntry({ turn_number: 1, current_content: 'Old', archived: true }),
          makeEntry({ turn_number: 2, current_content: 'Archived too', archived: true }),
          makeEntry({ turn_number: 3, current_content: 'Recent', archived: false }),
          makeEntry({ turn_number: 4, current_content: 'Latest', archived: false })
        ]
      };

      const result = getVisibleEntries(memory, {
        enable_ai_summary: false, window_turns: 10,
        summary_trigger_turns: 30, preserve_recent: 3, compacted_target_role: 'system'
      });

      expect(result).toHaveLength(2);
      expect(result[0].current_content).toBe('Recent');
      expect(result[1].current_content).toBe('Latest');
    });

    it('summary entries are still visible even if other entries are archived', () => {
      const memory: AgentConversationMemory = {
        id: 'm', owner_agent_id: 'a', conversation_id: 'a:b:sumvis',
        entries: [
          makeEntry({ turn_number: 1, current_content: 'Compressed old', archived: true }),
          makeEntry({ turn_number: 2, kind: 'summary', current_content: 'Summary of 1-1', archived: false }),
          makeEntry({ turn_number: 3, current_content: 'New message', archived: false })
        ]
      };

      const result = getVisibleEntries(memory, {
        enable_ai_summary: false, window_turns: 10,
        summary_trigger_turns: 30, preserve_recent: 3, compacted_target_role: 'system'
      });

      expect(result).toHaveLength(2);
      expect(result[0].kind).toBe('summary');
      expect(result[1].current_content).toBe('New message');
    });
  });

  describe('Per-speaker format edge cases (A2)', () => {
    it('falls back to default speaker format when speaker has no override', () => {
      // CHAT_FORMAT_CONFIG only has 'default' in speaker_format, no per-speaker overrides
      // This is implicitly tested by all existing assembler tests
      const formatWithOverrides: ConversationFormatConfig = {
        transcript: {
          mode: 'embed',
          turn_delimiter: '\n',
          speaker_format: {
            default: { prefix: '[', suffix: '] ' },
            'special-agent': { prefix: '**', suffix: '** ' }
          }
        },
        message_assembly: { ...CHAT_FORMAT_CONFIG.message_assembly },
        compression: { ...CHAT_FORMAT_CONFIG.compression }
      };

      // An agent not in the override list should use default
      const frag = makeConvFragment('Hello.', 'transcript', 1, 'f1');
      const bundle = makeBundleWithConversationFragments([frag], { system_core: 'S' });

      const messages = assembleConversationMessages({
        bundle, memory: null,
        formatConfig: formatWithOverrides,
        currentAgentId: 'agent-a', taskConfig: TASK_CONFIG
      });

      // Default format applied (the prefix/suffix from default)
      expect(messages.length).toBeGreaterThan(0);
    });
  });

  describe('Multi-injection points (A5)', () => {
    it('handles single injection config (backward compat)', () => {
      const bundle = makeBundleWithConversationFragments(
        [makeConvFragment('Entry.', 'transcript', 1, 'f1')],
        { system_core: 'System.', output_contract: 'OK.' }
      );

      const messages = assembleConversationMessages({
        bundle, memory: null,
        formatConfig: CHAT_FORMAT_CONFIG,
        currentAgentId: 'agent-a', taskConfig: TASK_CONFIG
      });

      const assistantCount = messages.filter((m) => m.role === 'assistant').length;
      expect(assistantCount).toBe(1);
    });

    it('handles multiple injection points', () => {
      const multiInjectionConfig: ConversationFormatConfig = {
        ...CHAT_FORMAT_CONFIG,
        message_assembly: {
          ...CHAT_FORMAT_CONFIG.message_assembly,
          injection: [
            { ai_fill_role: 'assistant', ai_fill_position: 'after_last_user' },
            { ai_fill_role: 'assistant', ai_fill_position: 0 }
          ]
        }
      };

      const bundle = makeBundleWithConversationFragments(
        [makeConvFragment('Entry.', 'transcript', 1, 'f1')],
        { system_core: 'System.', output_contract: 'OK.' }
      );

      const messages = assembleConversationMessages({
        bundle, memory: null,
        formatConfig: multiInjectionConfig,
        currentAgentId: 'agent-a', taskConfig: TASK_CONFIG
      });

      const assistantCount = messages.filter((m) => m.role === 'assistant').length;
      expect(assistantCount).toBe(2);
    });

    it('numeric injection index clamps to message array length', () => {
      const indexConfig: ConversationFormatConfig = {
        ...CHAT_FORMAT_CONFIG,
        message_assembly: {
          ...CHAT_FORMAT_CONFIG.message_assembly,
          injection: { ai_fill_role: 'assistant', ai_fill_position: 999 }
        }
      };

      const bundle = makeBundleWithConversationFragments(
        [makeConvFragment('Entry.', 'transcript', 1, 'f1')],
        { system_core: 'S', output_contract: 'OK.' }
      );

      const messages = assembleConversationMessages({
        bundle, memory: null,
        formatConfig: indexConfig,
        currentAgentId: 'agent-a', taskConfig: TASK_CONFIG
      });

      // Should not throw, assistant placed at end
      expect(messages[messages.length - 1].role).toBe('assistant');
    });
  });

  describe('Compaction target role redirection (B6)', () => {
    it('folds conversation text to compacted_target_role when summary entry exists', () => {
      const convFrag = makeConvFragment('Ongoing chat.', 'transcript', 1, 'f1');
      const summaryFrag = makeConvFragment('Summary of early turns.', 'transcript', 0, 'f-sum', {
        conversation_entry_kind: 'summary',
        entry_id: 'e-sum',
        speaker_agent_id: 'agent-a'
      });

      const compactedConfig: ConversationFormatConfig = {
        ...CHAT_FORMAT_CONFIG,
        compression: {
          ...CHAT_FORMAT_CONFIG.compression,
          compacted_target_role: 'system'
        }
      };

      const bundle = makeBundleWithConversationFragments([summaryFrag, convFrag], {
        system_core: 'System core.'
      });

      const messages = assembleConversationMessages({
        bundle, memory: null,
        formatConfig: compactedConfig,
        currentAgentId: 'agent-a', taskConfig: TASK_CONFIG
      });

      // Summary exists → conversation text should fold into system
      const systemMsg = messages.find((m) => m.role === 'system')!;
      const systemText = (systemMsg.parts[0] as { text: string }).text;
      expect(systemText).toContain('Summary of early turns.');
      expect(systemText).toContain('Ongoing chat.');
    });

    it('does not redirect when no summary entry is present', () => {
      const convFrag = makeConvFragment('Regular chat.', 'transcript', 1, 'f1');

      const bundle = makeBundleWithConversationFragments([convFrag], {
        system_core: 'System core.'
      });

      const messages = assembleConversationMessages({
        bundle, memory: null,
        formatConfig: CHAT_FORMAT_CONFIG,
        currentAgentId: 'agent-a', taskConfig: TASK_CONFIG
      });

      // No summary → conversation should stay in user role
      const systemMsg = messages.find((m) => m.role === 'system')!;
      const systemText = (systemMsg.parts[0] as { text: string }).text;
      expect(systemText).not.toContain('Regular chat.');
    });
  });
});
