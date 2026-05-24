import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type CompactionAuditEntry,
  JsonlCompactionAuditStore} from '../../../src/conversation/compaction_audit.js';

function makeAuditEntry(overrides: Partial<CompactionAuditEntry> = {}): CompactionAuditEntry {
  return {
    id: 'audit-1',
    agent_id: 'agent-a',
    conversation_id: 'conv-1',
    triggered_at: Date.now(),
    source_entry_ids: ['entry-1', 'entry-2'],
    summary_entry_id: 'summary-1',
    summary_model: 'test-model',
    summary_prompt_tokens: 100,
    summary_completion_tokens: 50,
    summary_duration_ms: 3000,
    status: 'success',
    ...overrides
  };
}

describe('JsonlCompactionAuditStore', () => {
  let tmpDir: string;
  let store: JsonlCompactionAuditStore;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `compaction-audit-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    store = new JsonlCompactionAuditStore(tmpDir);
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe('append', () => {
    it('writes a JSONL line to the conversation file', async () => {
      const entry = makeAuditEntry({ conversation_id: 'conv-test' });
      await store.append(entry);

      const filePath = path.join(tmpDir, 'conv-test.jsonl');
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content.trim()).toBe(JSON.stringify(entry));
    });

    it('creates parent directory if not exists', async () => {
      const entry = makeAuditEntry();
      await store.append(entry);

      await expect(fs.access(tmpDir)).resolves.toBeUndefined();
    });

    it('appends multiple entries to the same file', async () => {
      const e1 = makeAuditEntry({ id: 'audit-1', conversation_id: 'conv-multi' });
      const e2 = makeAuditEntry({ id: 'audit-2', conversation_id: 'conv-multi' });

      await store.append(e1);
      await store.append(e2);

      const entries = await store.getByConversation('conv-multi');
      expect(entries).toHaveLength(2);
      expect(entries[0].id).toBe('audit-1');
      expect(entries[1].id).toBe('audit-2');
    });
  });

  describe('getByConversation', () => {
    it('returns all entries for a conversation', async () => {
      await store.append(makeAuditEntry({ id: 'a1', conversation_id: 'conv-a' }));
      await store.append(makeAuditEntry({ id: 'a2', conversation_id: 'conv-a' }));
      await store.append(makeAuditEntry({ id: 'b1', conversation_id: 'conv-b' }));

      const entries = await store.getByConversation('conv-a');
      expect(entries).toHaveLength(2);
    });

    it('returns empty array for non-existent conversation', async () => {
      const entries = await store.getByConversation('nonexistent');
      expect(entries).toHaveLength(0);
    });

    it('handles empty JSONL file', async () => {
      const filePath = path.join(tmpDir, 'conv-empty.jsonl');
      await fs.mkdir(tmpDir, { recursive: true });
      await fs.writeFile(filePath, '', 'utf-8');

      const entries = await store.getByConversation('conv-empty');
      expect(entries).toHaveLength(0);
    });

    it('handles corrupted JSONL file gracefully (skips malformed lines)', async () => {
      const filePath = path.join(tmpDir, 'conv-corrupt.jsonl');
      await fs.mkdir(tmpDir, { recursive: true });
      // Write a valid line, then malformed line, then blank line
      const validEntry = makeAuditEntry({ id: 'ok', conversation_id: 'conv-corrupt' });
      await fs.writeFile(
        filePath,
        `${JSON.stringify(validEntry)}\n{not valid json}\n\n`,
        'utf-8'
      );

      const entries = await store.getByConversation('conv-corrupt');
      expect(entries).toHaveLength(1);
      expect(entries[0].id).toBe('ok');
    });

    it('handles directory that does not exist', async () => {
      const freshStore = new JsonlCompactionAuditStore(path.join(tmpDir, 'nonexistent-dir'));
      const entries = await freshStore.getByConversation('any');
      expect(entries).toHaveLength(0);
    });
  });

  describe('getByAgent', () => {
    it('returns entries matching the agent across all conversations', async () => {
      await store.append(makeAuditEntry({ id: 'a1', agent_id: 'agent-x', conversation_id: 'conv-1' }));
      await store.append(makeAuditEntry({ id: 'a2', agent_id: 'agent-x', conversation_id: 'conv-2' }));
      await store.append(makeAuditEntry({ id: 'b1', agent_id: 'agent-y', conversation_id: 'conv-1' }));

      const entries = await store.getByAgent('agent-x');
      expect(entries).toHaveLength(2);
    });

    it('returns empty array when no entries match agent', async () => {
      await store.append(makeAuditEntry({ agent_id: 'agent-a' }));
      const entries = await store.getByAgent('agent-z');
      expect(entries).toHaveLength(0);
    });

    it('handles non-existent audit directory', async () => {
      const freshStore = new JsonlCompactionAuditStore(path.join(tmpDir, 'no-dir'));
      const entries = await freshStore.getByAgent('any');
      expect(entries).toHaveLength(0);
    });
  });

  describe('failed compaction entries', () => {
    it('stores failed compaction with error message', async () => {
      const entry = makeAuditEntry({
        status: 'failed',
        summary_entry_id: '',
        error_message: 'AI Gateway timeout after 60s'
      });

      await store.append(entry);
      const entries = await store.getByConversation(entry.conversation_id);
      expect(entries).toHaveLength(1);
      expect(entries[0].status).toBe('failed');
      expect(entries[0].error_message).toBe('AI Gateway timeout after 60s');
    });
  });
});
