/**
 * Compaction audit log — independent from InferenceTrace.
 * Records every AI summary compaction attempt (success or failure).
 * Design doc: .limcode/design/multi-turn-conversation-design.md §6.6
 */

import fs from 'node:fs/promises';
import path from 'node:path';

// ── Types ───────────────────────────────────────────────────

export interface CompactionAuditEntry {
  id: string;
  agent_id: string;
  conversation_id: string;
  triggered_at: number;
  source_entry_ids: string[];
  summary_entry_id: string;
  summary_model: string;
  summary_prompt_tokens: number;
  summary_completion_tokens: number;
  summary_duration_ms: number;
  status: 'success' | 'failed';
  error_message?: string;
}

// ── Store Interface ────────────────────────────────────────

export interface CompactionAuditStore {
  append(entry: CompactionAuditEntry): Promise<void>;
  getByConversation(conversationId: string): Promise<CompactionAuditEntry[]>;
  getByAgent(agentId: string): Promise<CompactionAuditEntry[]>;
}

// ── JSONL Implementation ───────────────────────────────────

const DEFAULT_AUDIT_DIR = 'data/compaction_audit';

export class JsonlCompactionAuditStore implements CompactionAuditStore {
  constructor(private readonly auditDir: string = DEFAULT_AUDIT_DIR) {}

  private filePath(conversationId: string): string {
    return path.join(this.auditDir, `${conversationId}.jsonl`);
  }

  async append(entry: CompactionAuditEntry): Promise<void> {
    const filePath = this.filePath(entry.conversation_id);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const line = JSON.stringify(entry) + '\n';
    await fs.appendFile(filePath, line, 'utf-8');
  }

  async getByConversation(conversationId: string): Promise<CompactionAuditEntry[]> {
    const filePath = this.filePath(conversationId);
    return this.readLines(filePath);
  }

  async getByAgent(_agentId: string): Promise<CompactionAuditEntry[]> {
    // Scan all JSONL files and filter by agent_id.
    // Inefficient for large numbers of conversations, but acceptable for Phase 2 volume.
    const results: CompactionAuditEntry[] = [];
    try {
      const files = await fs.readdir(this.auditDir);
      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue;
        const entries = await this.readLines(path.join(this.auditDir, file));
        for (const entry of entries) {
          if (entry.agent_id === _agentId) {
            results.push(entry);
          }
        }
      }
    } catch {
      // Directory doesn't exist or is empty
    }
    return results;
  }

  private async readLines(filePath: string): Promise<CompactionAuditEntry[]> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return content
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .reduce<CompactionAuditEntry[]>((acc, line) => {
          try {
            acc.push(JSON.parse(line) as CompactionAuditEntry);
          } catch {
            // Skip malformed lines
          }
          return acc;
        }, []);
    } catch {
      return [];
    }
  }
}
