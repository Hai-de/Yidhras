import { describe, expect, it, vi } from 'vitest';

import type { ConversationStore } from '../../../src/conversation/store.js';
import type { AgentConversationMemory, ConversationEntry } from '../../../src/conversation/types.js';
import { writeConversationEntries } from '../../../src/conversation/writeback.js';

function makeMemory(overrides: Partial<AgentConversationMemory> = {}): AgentConversationMemory {
  return {
    id: 'mem-1',
    owner_agent_id: 'agent-a',
    conversation_id: 'conv-1',
    entries: [],
    ...overrides
  };
}

function makeEntry(overrides: Partial<ConversationEntry> = {}): ConversationEntry {
  return {
    id: 'entry-1',
    turn_number: 1,
    speaker_agent_id: 'agent-a',
    kind: 'original',
    original_content: 'Hello.',
    current_content: 'Hello.',
    provenance: { operator: { kind: 'agent', id: 'agent-a' }, capability: 'conversation.record' },
    recorded_at: 1000,
    modifications: [],
    ...overrides
  };
}

describe('conversation/writeback', () => {
  describe('writeConversationEntries', () => {
    it('should write two entries to store in a transaction', async () => {
      const store = {
        appendEntriesInTransaction: vi.fn().mockResolvedValue(undefined)
      } as unknown as ConversationStore;

      const speakerMemory = makeMemory({ id: 'speaker-mem', entries: [] });
      const listenerMemory = makeMemory({ id: 'listener-mem', entries: [] });

      const result = await writeConversationEntries({
        store,
        speakerMemory,
        listenerMemory,
        speakerAgentId: 'agent-a',
        listenerAgentId: 'agent-b',
        responseContent: 'Hello from A',
        inferenceId: 'inf-1',
        now: () => 5000
      });

      expect(result.speakerEntry).toBeDefined();
      expect(result.listenerEntry).toBeDefined();
      expect(result.speakerEntry.speaker_agent_id).toBe('agent-a');
      expect(result.speakerEntry.current_content).toBe('Hello from A');
      expect(result.speakerEntry.kind).toBe('original');
      expect(result.speakerEntry.source_inference_id).toBe('inf-1');
      expect(result.speakerEntry.recorded_at).toBe(5000);

      expect(store.appendEntriesInTransaction).toHaveBeenCalledOnce();
      const callArgs = (store.appendEntriesInTransaction as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(callArgs).toHaveLength(2);
      expect(callArgs[0].memoryId).toBe('speaker-mem');
      expect(callArgs[1].memoryId).toBe('listener-mem');
    });

    it('should compute turn_number from max existing turn + 1', async () => {
      const store = {
        appendEntriesInTransaction: vi.fn().mockResolvedValue(undefined)
      } as unknown as ConversationStore;

      const speakerMemory = makeMemory({
        entries: [makeEntry({ turn_number: 3 }), makeEntry({ turn_number: 7 })]
      });
      const listenerMemory = makeMemory({
        entries: [makeEntry({ turn_number: 5 })]
      });

      const result = await writeConversationEntries({
        store,
        speakerMemory,
        listenerMemory,
        speakerAgentId: 'agent-a',
        listenerAgentId: 'agent-b',
        responseContent: 'Response',
        inferenceId: 'inf-2',
        now: () => 9999
      });

      expect(result.speakerEntry.turn_number).toBe(8); // max(3,7)+1
      expect(result.listenerEntry.turn_number).toBe(6); // max(5)+1
    });

    it('should start from turn_number 1 when memory has no entries', async () => {
      const store = {
        appendEntriesInTransaction: vi.fn().mockResolvedValue(undefined)
      } as unknown as ConversationStore;

      const result = await writeConversationEntries({
        store,
        speakerMemory: makeMemory({ entries: [] }),
        listenerMemory: makeMemory({ entries: [] }),
        speakerAgentId: 'agent-a',
        listenerAgentId: 'agent-b',
        responseContent: 'First message',
        inferenceId: 'inf-3',
        now: () => 1000
      });

      expect(result.speakerEntry.turn_number).toBe(1);
      expect(result.listenerEntry.turn_number).toBe(1);
    });

    it('should include tool trace when provided', async () => {
      const store = {
        appendEntriesInTransaction: vi.fn().mockResolvedValue(undefined)
      } as unknown as ConversationStore;

      const toolTrace = { tools_called: ['search', 'calculate'], total_rounds: 2, total_tool_calls: 3 };

      const result = await writeConversationEntries({
        store,
        speakerMemory: makeMemory(),
        listenerMemory: makeMemory(),
        speakerAgentId: 'agent-a',
        listenerAgentId: 'agent-b',
        responseContent: 'Used tools',
        inferenceId: 'inf-4',
        toolTrace,
        now: () => 2000
      });

      expect(result.speakerEntry.tool_trace).toEqual(toolTrace);
      expect(result.listenerEntry.tool_trace).toEqual(toolTrace);
    });

    it('should not include tool trace when not provided', async () => {
      const store = {
        appendEntriesInTransaction: vi.fn().mockResolvedValue(undefined)
      } as unknown as ConversationStore;

      const result = await writeConversationEntries({
        store,
        speakerMemory: makeMemory(),
        listenerMemory: makeMemory(),
        speakerAgentId: 'agent-a',
        listenerAgentId: 'agent-b',
        responseContent: 'No tools',
        inferenceId: 'inf-5',
        now: () => 3000
      });

      expect(result.speakerEntry.tool_trace).toBeUndefined();
    });

    it('should use Date.now when no now provider given', async () => {
      const store = {
        appendEntriesInTransaction: vi.fn().mockResolvedValue(undefined)
      } as unknown as ConversationStore;

      const before = Date.now();
      const result = await writeConversationEntries({
        store,
        speakerMemory: makeMemory(),
        listenerMemory: makeMemory(),
        speakerAgentId: 'agent-a',
        listenerAgentId: 'agent-b',
        responseContent: 'Timestamped',
        inferenceId: 'inf-6'
      });
      const after = Date.now();

      expect(result.speakerEntry.recorded_at).toBeGreaterThanOrEqual(before);
      expect(result.speakerEntry.recorded_at).toBeLessThanOrEqual(after);
    });

    it('should set provenance with speaker agent id', async () => {
      const store = {
        appendEntriesInTransaction: vi.fn().mockResolvedValue(undefined)
      } as unknown as ConversationStore;

      const result = await writeConversationEntries({
        store,
        speakerMemory: makeMemory(),
        listenerMemory: makeMemory(),
        speakerAgentId: 'speaker-id',
        listenerAgentId: 'listener-id',
        responseContent: 'Provenance test',
        inferenceId: 'inf-7',
        now: () => 4000
      });

      expect(result.speakerEntry.provenance.operator.id).toBe('speaker-id');
      expect(result.speakerEntry.provenance.operator.kind).toBe('agent');
      expect(result.speakerEntry.provenance.capability).toBe('conversation.record');
    });

    it('should set modifications to empty array', async () => {
      const store = {
        appendEntriesInTransaction: vi.fn().mockResolvedValue(undefined)
      } as unknown as ConversationStore;

      const result = await writeConversationEntries({
        store,
        speakerMemory: makeMemory(),
        listenerMemory: makeMemory(),
        speakerAgentId: 'agent-a',
        listenerAgentId: 'agent-b',
        responseContent: 'Clean entry',
        inferenceId: 'inf-8',
        now: () => 5000
      });

      expect(result.speakerEntry.modifications).toEqual([]);
      expect(result.listenerEntry.modifications).toEqual([]);
    });
  });
});
