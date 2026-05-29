import { describe, expect, it, vi } from 'vitest';

import type { ConversationStore } from '../../../src/conversation/store.js';
import type { ConversationFormatConfig } from '../../../src/conversation/format_config_schemas.js';
import { DEFAULT_CONVERSATION_FORMAT_CONFIG } from '../../../src/conversation/format_config_schemas.js';
import { DefaultConversationCompactionService } from '../../../src/conversation/compaction_service.js';
import type { AgentConversationMemory, ConversationEntry } from '../../../src/conversation/types.js';
import type { CompactionAuditStore } from '../../../src/conversation/compaction_audit.js';
import type { ModelGateway } from '../../../src/ai/gateway.js';
import type { AiResolvedTaskConfig, AiTaskDefinition } from '../../../src/ai/types.js';

function makeEntry(overrides: Partial<ConversationEntry> = {}): ConversationEntry {
  return {
    id: `entry-${Math.random().toString(36).slice(2, 8)}`,
    turn_number: 1,
    speaker_agent_id: 'agent-a',
    kind: 'original',
    original_content: 'Hello.',
    current_content: 'Hello.',
    provenance: { operator: { kind: 'agent', id: 'agent-a' }, capability: 'conversation.record' },
    recorded_at: Date.now(),
    modifications: [],
    ...overrides
  };
}

function makeMemory(overrides: Partial<AgentConversationMemory> = {}): AgentConversationMemory {
  return {
    id: 'mem-1',
    owner_agent_id: 'agent-a',
    conversation_id: 'conv-1',
    entries: [],
    ...overrides
  };
}

function makeFormatConfig(overrides: Partial<ConversationFormatConfig> = {}): ConversationFormatConfig {
  return {
    ...DEFAULT_CONVERSATION_FORMAT_CONFIG,
    compression: {
      ...DEFAULT_CONVERSATION_FORMAT_CONFIG.compression,
      enable_ai_summary: true,
      summary_trigger_turns: 3,
      preserve_recent: 1
    },
    ...overrides
  };
}

function makeTaskConfig(): AiResolvedTaskConfig {
  return {
    definition: {
      task_type: 'context_summary',
      category: 'server',
      description: 'test',
      default_prompt_preset: 'compaction',
      default_response_mode: 'free_text',
      timeout_ms: 60000,
      retry_limit: 1,
      allow_fallback: true
    } as unknown as AiTaskDefinition,
    override: null,
    output: { mode: 'free_text' },
    prompt: {},
    parse: {},
    route: {},
    tools: [],
    tool_policy: { mode: 'allowed' }
  };
}

describe('conversation/compaction_service', () => {
  describe('DefaultConversationCompactionService', () => {
    it('should return false when AI summary disabled', async () => {
      const service = new DefaultConversationCompactionService();
      const formatConfig = makeFormatConfig({
        compression: { ...DEFAULT_CONVERSATION_FORMAT_CONFIG.compression, enable_ai_summary: false, summary_trigger_turns: 3, preserve_recent: 1 }
      });
      const memory = makeMemory({ entries: [makeEntry(), makeEntry(), makeEntry(), makeEntry()] });

      const result = await service.maybeCompact({
        memory,
        formatConfig,
        store: {} as ConversationStore,
        gateway: {} as ModelGateway,
        taskConfig: makeTaskConfig(),
        auditStore: {} as CompactionAuditStore
      });
      expect(result).toBe(false);
    });

    it('should return false when entry count <= threshold', async () => {
      const service = new DefaultConversationCompactionService();
      const formatConfig = makeFormatConfig({
        compression: { ...DEFAULT_CONVERSATION_FORMAT_CONFIG.compression, enable_ai_summary: true, summary_trigger_turns: 5, preserve_recent: 1 }
      });
      const memory = makeMemory({ entries: [makeEntry(), makeEntry(), makeEntry()] });

      const result = await service.maybeCompact({
        memory,
        formatConfig,
        store: {} as ConversationStore,
        gateway: {} as ModelGateway,
        taskConfig: makeTaskConfig(),
        auditStore: {} as CompactionAuditStore
      });
      expect(result).toBe(false);
    });

    it('should return false when all entries are preserved (preserve_recent >= entries.length)', async () => {
      const service = new DefaultConversationCompactionService();
      const formatConfig = makeFormatConfig({
        compression: { ...DEFAULT_CONVERSATION_FORMAT_CONFIG.compression, enable_ai_summary: true, summary_trigger_turns: 1, preserve_recent: 10 }
      });
      const memory = makeMemory({ entries: [makeEntry(), makeEntry(), makeEntry()] });

      const result = await service.maybeCompact({
        memory,
        formatConfig,
        store: {} as ConversationStore,
        gateway: {} as ModelGateway,
        taskConfig: makeTaskConfig(),
        auditStore: {} as CompactionAuditStore
      });
      expect(result).toBe(false);
    });

    it('should return true and call compaction when above threshold', async () => {
      const service = new DefaultConversationCompactionService();
      const formatConfig = makeFormatConfig({
        compression: { ...DEFAULT_CONVERSATION_FORMAT_CONFIG.compression, enable_ai_summary: true, summary_trigger_turns: 2, preserve_recent: 1 }
      });
      const entries = [
        makeEntry({ turn_number: 1, id: 'e1' }),
        makeEntry({ turn_number: 2, id: 'e2' }),
        makeEntry({ turn_number: 3, id: 'e3' }),
        makeEntry({ turn_number: 4, id: 'e4' })
      ];
      const memory = makeMemory({ entries });

      const store = {
        archiveEntries: vi.fn().mockResolvedValue(undefined),
        appendEntry: vi.fn().mockResolvedValue(undefined)
      } as unknown as ConversationStore;

      const gateway = {
        execute: vi.fn().mockResolvedValue({
          text: 'Summary of conversation',
          usage: { prompt_tokens: 10, completion_tokens: 5 }
        })
      } as unknown as ModelGateway;

      const auditStore = {
        append: vi.fn().mockResolvedValue(undefined)
      } as unknown as CompactionAuditStore;

      // Mock runCompactionInference
      vi.doMock('../../../src/conversation/compaction_inference.js', () => ({
        runCompactionInference: vi.fn().mockResolvedValue({ summaryText: 'Summary text' })
      }));

      const result = await service.maybeCompact({
        memory,
        formatConfig,
        store,
        gateway,
        taskConfig: makeTaskConfig(),
        auditStore
      });
      expect(result).toBe(true);
    });

    it('should use per-agent override for enable_ai_summary', async () => {
      const service = new DefaultConversationCompactionService();
      const formatConfig = makeFormatConfig({
        compression: { ...DEFAULT_CONVERSATION_FORMAT_CONFIG.compression, enable_ai_summary: true, summary_trigger_turns: 1, preserve_recent: 1 }
      });
      const memory = makeMemory({
        entries: [makeEntry(), makeEntry(), makeEntry()],
        metadata: { enable_ai_summary: false }
      });

      const result = await service.maybeCompact({
        memory,
        formatConfig,
        store: {} as ConversationStore,
        gateway: {} as ModelGateway,
        taskConfig: makeTaskConfig(),
        auditStore: {} as CompactionAuditStore
      });
      expect(result).toBe(false);
    });

    it('should use per-agent override for summary_trigger_turns', async () => {
      const service = new DefaultConversationCompactionService();
      const formatConfig = makeFormatConfig({
        compression: { ...DEFAULT_CONVERSATION_FORMAT_CONFIG.compression, enable_ai_summary: true, summary_trigger_turns: 1, preserve_recent: 1 }
      });
      const memory = makeMemory({
        entries: [makeEntry(), makeEntry(), makeEntry()],
        metadata: { summary_trigger_turns: 10 }
      });

      const result = await service.maybeCompact({
        memory,
        formatConfig,
        store: {} as ConversationStore,
        gateway: {} as ModelGateway,
        taskConfig: makeTaskConfig(),
        auditStore: {} as CompactionAuditStore
      });
      expect(result).toBe(false);
    });
  });
});
