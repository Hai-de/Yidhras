/**
 * D2 — End-to-end conversation flow integration tests.
 * Tests the full pipeline: memory → entries → track → assembly → AiMessage[].
 *
 * Design doc §D2: verifies first-turn, multi-turn, window truncation, write-back.
 */

import crypto from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { assembleConversationMessages } from '../../../src/conversation/assembler.js';
import { DEFAULT_CONVERSATION_FORMAT_CONFIG } from '../../../src/conversation/format_config.js';
import type { ConversationFormatConfig } from '../../../src/conversation/format_config.js';
import { PrismaConversationStore } from '../../../src/conversation/store_prisma.js';
import type { AgentConversationMemory, ConversationEntry } from '../../../src/conversation/types.js';
import { getVisibleEntries, runConversationHistoryTrack } from '../../../src/context/workflow/tracks/conversation_history_track.js';
import type { PromptBundleV2 } from '../../../src/inference/prompt_bundle_v2.js';
import type { PromptFragmentV2 } from '../../../src/inference/prompt_fragment_v2.js';
import type { PromptSlotConfig } from '../../../src/inference/prompt_slot_config.js';
import type { PromptTree } from '../../../src/inference/prompt_tree.js';
import type { AiResolvedTaskConfig } from '../../../src/ai/types.js';

// ── Test Helpers ───────────────────────────────────────────

const TEST_DB_URL = process.env.DATABASE_URL ?? 'file:../../../data/yidhras.sqlite';

const SLOT_REGISTRY: Record<string, PromptSlotConfig> = {
  system_core: {
    id: 'system_core',
    display_name: 'System Core',
    default_priority: 100,
    message_role: 'system',
    include_in_combined: true,
    combined_heading: 'System Prompt',
    enabled: true
  },
  role_core: {
    id: 'role_core',
    display_name: 'Role Core',
    default_priority: 90,
    message_role: 'developer',
    include_in_combined: true,
    combined_heading: 'Role Prompt',
    enabled: true
  },
  conversation_history: {
    id: 'conversation_history',
    display_name: 'Conversation History',
    default_priority: 50,
    message_role: 'user',
    include_in_combined: true,
    combined_heading: 'Conversation History',
    enabled: true
  },
  output_contract: {
    id: 'output_contract',
    display_name: 'Output Contract',
    default_priority: 50,
    message_role: 'user',
    include_in_combined: true,
    combined_heading: 'Output Contract',
    enabled: true
  }
};

const TASK_CONFIG: AiResolvedTaskConfig = {
  definition: {
    task_type: 'agent_decision',
    default_response_mode: 'json_schema',
    default_prompt_preset: 'test_preset',
    default_decoder: 'default_json_schema'
  },
  override: null,
  output: { mode: 'json_schema' as const },
  prompt: { preset: 'test_preset' },
  parse: { decoder: 'default_json_schema' },
  route: {}
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
    id: crypto.randomUUID(),
    turn_number: 1,
    speaker_agent_id: 'agent-a',
    kind: 'original',
    original_content: 'Hello.',
    current_content: 'Hello.',
    provenance: { operator: { kind: 'agent', id: 'agent-a' }, capability: 'conversation.record' },
    recorded_at: now,
    modifications: [],
    ...overrides
  };
}

function makeBundleWithConversationFragments(
  fragments: PromptFragmentV2[],
  slotTexts: Record<string, string> = {}
): PromptBundleV2 {
  const tree: PromptTree = {
    inference_id: 'inf-e2e',
    task_type: 'agent_decision',
    fragments_by_slot: {
      system_core: [],
      role_core: [],
      conversation_history: fragments,
      output_contract: []
    },
    slot_registry: SLOT_REGISTRY,
    metadata: {
      prompt_version: 'phase-c-v1',
      profile_id: null,
      profile_version: null,
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
    combined_prompt: Object.values(slotTexts).join('\n\n'),
    metadata: {
      prompt_version: 'phase-c-v1',
      source_prompt_keys: Object.keys(slotTexts),
      workflow_task_type: 'agent_decision'
    },
    tree
  };
}

// ── Tests ──────────────────────────────────────────────────

describe('D2 — Conversation flow integration', () => {
  let prisma: PrismaClient;
  let store: PrismaConversationStore;
  const runId = crypto.randomUUID().slice(0, 8);

  beforeAll(() => {
    prisma = new PrismaClient({
      datasources: { db: { url: TEST_DB_URL } }
    });
    store = new PrismaConversationStore(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('ConversationStore CRUD', () => {
    it('creates a new memory via getOrCreate', async () => {
      const cid = `agent-a:agent-b:${runId}-1`;
      const memory = await store.getOrCreate('agent-a', cid);
      expect(memory.id).toBeDefined();
      expect(memory.owner_agent_id).toBe('agent-a');
      expect(memory.conversation_id).toBe(cid);
      expect(memory.entries).toHaveLength(0);
    });

    it('returns existing memory on repeated getOrCreate', async () => {
      const cid = `agent-a:agent-b:${runId}-2`;
      const first = await store.getOrCreate('agent-b', cid);
      const second = await store.getOrCreate('agent-b', cid);
      expect(second.id).toBe(first.id);
    });

    it('appends and retrieves entries', async () => {
      const cid = `agent-c:agent-d:${runId}-3`;
      const memory = await store.getOrCreate('agent-c', cid);
      const entry = makeEntry({
        turn_number: 1,
        speaker_agent_id: 'agent-c',
        current_content: 'Hello from agent-c'
      });
      await store.appendEntry(memory.id, entry);

      const refreshed = await store.getOrCreate('agent-c', cid);
      expect(refreshed.entries).toHaveLength(1);
      expect(refreshed.entries[0].current_content).toBe('Hello from agent-c');
      expect(refreshed.entries[0].source_inference_id).toBeUndefined();
    });

    it('appends entries with source_inference_id', async () => {
      const cid = `agent-e:agent-f:${runId}-4`;
      const memory = await store.getOrCreate('agent-e', cid);
      const entry = makeEntry({
        turn_number: 1,
        speaker_agent_id: 'agent-e',
        current_content: 'Tracked inference.',
        source_inference_id: 'inf-12345'
      });
      await store.appendEntry(memory.id, entry);

      const refreshed = await store.getOrCreate('agent-e', cid);
      expect(refreshed.entries[0].source_inference_id).toBe('inf-12345');
    });

    it('modifies entry and preserves modification history', async () => {
      const cid = `agent-g:agent-h:${runId}-5`;
      const memory = await store.getOrCreate('agent-g', cid);
      const entry = makeEntry({
        turn_number: 1,
        speaker_agent_id: 'agent-g',
        original_content: 'Original.',
        current_content: 'Original.'
      });
      await store.appendEntry(memory.id, entry);

      const fresh = await store.getOrCreate('agent-g', cid);
      const entryId = fresh.entries[0].id;

      await store.modifyEntry(entryId, {
        modified_by: {
          operator: { kind: 'user', id: 'operator-1' },
          capability: 'conversation.modify'
        },
        modified_at: Date.now(),
        previous_content: 'Original.',
        new_content: 'Modified.',
        reason: 'test modification'
      });

      const afterMod = await store.getOrCreate('agent-g', cid);
      expect(afterMod.entries[0].current_content).toBe('Modified.');
      expect(afterMod.entries[0].original_content).toBe('Original.');
      expect(afterMod.entries[0].modifications).toHaveLength(1);
    });

    it('supports pagination via limit and before cursor', async () => {
      const cid = `agent-i:agent-j:${runId}-6`;
      const memory = await store.getOrCreate('agent-i', cid);
      for (let i = 1; i <= 5; i++) {
        await store.appendEntry(
          memory.id,
          makeEntry({ turn_number: i, speaker_agent_id: 'agent-i', current_content: `Turn ${i}` })
        );
      }

      const all = await store.getEntries(memory.id);
      expect(all).toHaveLength(5);

      const limited = await store.getEntries(memory.id, { limit: 3 });
      expect(limited).toHaveLength(3);

      const before = await store.getEntries(memory.id, { before: 3 });
      expect(before).toHaveLength(2);
    });
  });

  describe('Track + Assembly integration', () => {
    it('produces conversation_history drafts from memory entries', () => {
      const memory: AgentConversationMemory = {
        id: `mem-test-${runId}`,
        owner_agent_id: 'agent-a',
        conversation_id: `agent-a:agent-b:${runId}-track`,
        entries: [
          makeEntry({ turn_number: 1, speaker_agent_id: 'agent-a', current_content: 'Hi there.' }),
          makeEntry({ turn_number: 2, speaker_agent_id: 'agent-b', current_content: 'Hello!' }),
          makeEntry({ turn_number: 3, speaker_agent_id: 'agent-a', current_content: 'How are you?' })
        ]
      };

      const result = runConversationHistoryTrack({
        memory,
        slotRegistry: SLOT_REGISTRY,
        formatConfig: CHAT_FORMAT_CONFIG,
        currentAgentId: 'agent-a'
      });

      expect(result.result).toHaveLength(3);
      // embed mode: all entries map to 'transcript'
      expect(result.result[0].metadata!.entry_role).toBe('transcript');
      expect(result.result[1].metadata!.entry_role).toBe('transcript');
      expect(result.result[2].metadata!.entry_role).toBe('transcript');
      expect(result.result[0].removable).toBe(true);
    });

    it('assembles messages with conversation history correctly', () => {
      const memory: AgentConversationMemory = {
        id: `mem-test-2-${runId}`,
        owner_agent_id: 'agent-a',
        conversation_id: `agent-a:agent-b:${runId}-asm`,
        entries: [
          makeEntry({ turn_number: 1, speaker_agent_id: 'agent-a', current_content: 'Hi there.' }),
          makeEntry({ turn_number: 2, speaker_agent_id: 'agent-b', current_content: 'Hello!' })
        ]
      };

      const trackResult = runConversationHistoryTrack({
        memory,
        slotRegistry: SLOT_REGISTRY,
        formatConfig: CHAT_FORMAT_CONFIG,
        currentAgentId: 'agent-a'
      });

      const convFragments: PromptFragmentV2[] = trackResult.result.map((draft, idx) => ({
        id: `frag-${idx}`,
        slot_id: 'conversation_history',
        priority: draft.priority,
        source: `section:${draft.id}`,
        removable: true,
        replaceable: false,
        children: draft.content_blocks.map((block) => ({
          id: crypto.randomUUID(),
          kind: 'text' as const,
          content: { kind: 'text' as const, text: block.kind === 'text' ? block.text : '' },
          rendered: block.kind === 'text' ? block.text : ''
        })),
        estimated_tokens: draft.estimated_tokens,
        metadata: draft.metadata
      }));

      const bundle = makeBundleWithConversationFragments(convFragments, {
        system_core: 'System instruction.',
        output_contract: 'Return JSON.'
      });

      const messages = assembleConversationMessages({
        bundle,
        memory,
        formatConfig: CHAT_FORMAT_CONFIG,
        currentAgentId: 'agent-a',
        taskConfig: TASK_CONFIG
      });

      expect(messages.length).toBeGreaterThanOrEqual(2);

      const hasAssistant = messages.some((m) => m.role === 'assistant');
      expect(hasAssistant).toBe(true);

      const userMsg = messages.find((m) => m.role === 'user');
      expect(userMsg).toBeDefined();
      const userText = (userMsg!.parts[0] as { text: string }).text;
      expect(userText).toContain('Hello!');
    });
  });

  describe('Window truncation', () => {
    it('getVisibleEntries respects window_turns', () => {
      const memory: AgentConversationMemory = {
        id: `mem-window-${runId}`,
        owner_agent_id: 'agent-a',
        conversation_id: `agent-a:agent-b:${runId}-window`,
        entries: Array.from({ length: 15 }, (_, i) =>
          makeEntry({
            turn_number: i + 1,
            speaker_agent_id: i % 2 === 0 ? 'agent-a' : 'agent-b',
            current_content: `Turn ${i + 1}`
          })
        )
      };

      const result = runConversationHistoryTrack({
        memory,
        slotRegistry: SLOT_REGISTRY,
        formatConfig: {
          ...CHAT_FORMAT_CONFIG,
          compression: { window_turns: 5, summary_trigger_turns: 30, preserve_recent: 3 }
        },
        currentAgentId: 'agent-a'
      });

      expect(result.result).toHaveLength(5);
      expect(result.result[0].priority).toBe(11);
      expect(result.result[4].priority).toBe(15);
    });

    it('summary entries are always included regardless of window_turns', () => {
      const memory: AgentConversationMemory = {
        id: `mem-summary-${runId}`,
        owner_agent_id: 'agent-a',
        conversation_id: `agent-a:agent-b:${runId}-summary`,
        entries: [
          makeEntry({
            turn_number: 1,
            speaker_agent_id: 'agent-a',
            kind: 'summary',
            current_content: 'Summary of turns 1-10.',
            turn_range: { start: 1, end: 10 }
          }),
          ...Array.from({ length: 10 }, (_, i) =>
            makeEntry({
              turn_number: i + 2,
              speaker_agent_id: i % 2 === 0 ? 'agent-a' : 'agent-b',
              current_content: `Turn ${i + 2}`
            })
          )
        ]
      };

      const result = runConversationHistoryTrack({
        memory,
        slotRegistry: SLOT_REGISTRY,
        formatConfig: {
          ...CHAT_FORMAT_CONFIG,
          compression: { window_turns: 3, summary_trigger_turns: 30, preserve_recent: 3 }
        },
        currentAgentId: 'agent-a'
      });

      expect(result.result).toHaveLength(4);
      expect(result.result[0].metadata!.conversation_entry_kind).toBe('summary');
    });
  });

  describe('Write-back flow', () => {
    it('writes entries to both agent memories', async () => {
      const cid = `w-agent-a:w-agent-b:${runId}-wb`;
      const memoryA = await store.getOrCreate('w-agent-a', cid);
      const memoryB = await store.getOrCreate('w-agent-b', cid);

      const entryA = makeEntry({
        turn_number: 1,
        speaker_agent_id: 'w-agent-a',
        current_content: 'Message from A.',
        source_inference_id: 'inf-wb-001'
      });
      const entryB = makeEntry({
        turn_number: 1,
        speaker_agent_id: 'w-agent-a',
        current_content: 'Message from A.',
        source_inference_id: 'inf-wb-001'
      });

      await store.appendEntry(memoryA.id, entryA);
      await store.appendEntry(memoryB.id, entryB);

      const refreshedA = await store.getOrCreate('w-agent-a', cid);
      const refreshedB = await store.getOrCreate('w-agent-b', cid);

      expect(refreshedA.entries).toHaveLength(1);
      expect(refreshedB.entries).toHaveLength(1);
      expect(refreshedA.entries[0].source_inference_id).toBe('inf-wb-001');
      expect(refreshedB.entries[0].source_inference_id).toBe('inf-wb-001');
    });

    it('archiveEntries marks entries as archived', async () => {
      const cid = `agent-arch:agent-b:${runId}-archive`;
      const memory = await store.getOrCreate('agent-arch', cid);

      await store.appendEntry(
        memory.id,
        makeEntry({ turn_number: 1, current_content: 'To be archived.' })
      );
      await store.appendEntry(
        memory.id,
        makeEntry({ turn_number: 2, current_content: 'Also archived.' })
      );

      const memAfter = await store.getOrCreate('agent-arch', cid);
      expect(memAfter.entries).toHaveLength(2);

      const entryIds = memAfter.entries.map((e) => e.id);
      await store.archiveEntries(entryIds);

      const memAfterArchive = await store.getOrCreate('agent-arch', cid);
      expect(memAfterArchive.entries).toHaveLength(2);
      expect(memAfterArchive.entries[0].archived).toBe(true);
      expect(memAfterArchive.entries[1].archived).toBe(true);
    });

    it('archiveEntries with empty array is a no-op', async () => {
      await expect(store.archiveEntries([])).resolves.toBeUndefined();
    });
  });

  describe('Compaction scenarios', () => {
    it('getVisibleEntries with archived entries excludes them from view', () => {
      const memory: AgentConversationMemory = {
        id: 'mem-viz',
        owner_agent_id: 'agent-a',
        conversation_id: 'agent-a:agent-b:viz',
        entries: [
          makeEntry({ turn_number: 1, current_content: 'Archived', archived: true }),
          makeEntry({ turn_number: 2, kind: 'summary', current_content: 'Summary of turn 1', turn_range: { start: 1, end: 1 }, archived: false }),
          makeEntry({ turn_number: 3, current_content: 'Recent', archived: false }),
          makeEntry({ turn_number: 4, current_content: 'Latest', archived: false })
        ]
      };

      const result = getVisibleEntries(memory, {
        enable_ai_summary: false, window_turns: 10,
        summary_trigger_turns: 30, preserve_recent: 3, compacted_target_role: 'system'
      });

      // Summary entry (always visible) + 2 non-archived recent entries
      expect(result).toHaveLength(3);
      expect(result[0].kind).toBe('summary');
      expect(result[1].current_content).toBe('Recent');
      expect(result[2].current_content).toBe('Latest');
    });

    it('preserve_recent truncation applied when window is smaller', () => {
      const memory: AgentConversationMemory = {
        id: 'mem-pres',
        owner_agent_id: 'agent-a',
        conversation_id: 'agent-a:agent-b:pres',
        entries: Array.from({ length: 20 }, (_, i) =>
          makeEntry({ turn_number: i + 1, current_content: `Turn ${i + 1}` })
        )
      };

      const result = getVisibleEntries(memory, {
        enable_ai_summary: false, window_turns: 5,
        summary_trigger_turns: 30, preserve_recent: 3, compacted_target_role: 'system'
      });

      // No summary → window_turns used: last 5 entries
      expect(result).toHaveLength(5);
      expect(result[0].turn_number).toBe(16);
      expect(result[4].turn_number).toBe(20);
    });

    it('summary entry with compacted_target_role assembles into target role', () => {
      const makeFrag = (text: string, entryRole: string, turn: number, id: string, extra: Record<string, unknown> = {}): PromptFragmentV2 => ({
        id,
        slot_id: 'conversation_history',
        priority: turn,
        source: `section:${id}`,
        removable: true,
        replaceable: false,
        children: [{
          id: crypto.randomUUID(), kind: 'text' as const,
          content: { kind: 'text' as const, text },
          rendered: text
        }],
        estimated_tokens: Math.ceil(text.length / 4),
        metadata: { entry_role: entryRole, turn_number: turn, conversation_entry_kind: 'original', ...extra }
      });

      const summaryFrag = makeFrag('Summary: early discussion.', 'transcript', 0, 'f-sum', {
        conversation_entry_kind: 'summary'
      });
      const recentFrag = makeFrag('Agent A: latest message.', 'transcript', 1, 'f1', {
        conversation_entry_kind: 'original'
      });

      const compactedConfig: ConversationFormatConfig = {
        ...CHAT_FORMAT_CONFIG,
        compression: {
          enable_ai_summary: false, window_turns: 10,
          summary_trigger_turns: 30, preserve_recent: 3,
          compacted_target_role: 'developer'
        }
      };

      const bundle = makeBundleWithConversationFragments([summaryFrag, recentFrag], {
        system_core: 'System.',
        role_core: 'Role context.'
      });

      const messages = assembleConversationMessages({
        bundle, memory: null,
        formatConfig: compactedConfig,
        currentAgentId: 'agent-a', taskConfig: TASK_CONFIG
      });

      // Summary exists → all conversation text folded to developer
      const devMsg = messages.find((m) => m.role === 'developer')!;
      const devText = (devMsg.parts[0] as { text: string }).text;
      expect(devText).toContain('Summary: early discussion.');
      expect(devText).toContain('Agent A: latest message.');
    });
  });
});
