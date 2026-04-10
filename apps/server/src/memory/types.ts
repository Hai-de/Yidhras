import type { InferenceActorRef } from '../inference/types.js';

export type MemoryScope = 'short_term' | 'long_term';
export type MemorySourceKind = 'trace' | 'intent' | 'job' | 'post' | 'event' | 'summary' | 'manual';

export interface MemorySourceRef {
  trace_id?: string;
  job_id?: string;
  intent_id?: string;
  post_id?: string;
  event_id?: string;
  source_message_id?: string;
}

export interface MemoryVisibility {
  min_level?: number;
  circle_id?: string | null;
  policy_gate?: string | null;
}

export interface MemoryContent {
  text: string;
  structured?: Record<string, unknown>;
}

export interface MemoryEntry {
  id: string;
  scope: MemoryScope;
  actor_ref?: InferenceActorRef | null;
  source_kind: MemorySourceKind;
  source_ref?: MemorySourceRef | null;
  content: MemoryContent;
  tags: string[];
  importance: number;
  salience: number;
  confidence?: number | null;
  visibility?: MemoryVisibility | null;
  created_at: string;
  occurred_at?: string | null;
  expires_at?: string | null;
  metadata?: Record<string, unknown>;
}

export interface MemoryDroppedEntry {
  entry_id: string;
  reason: string;
}

export interface MemorySelectionDiagnostics {
  selected_count: number;
  skipped_count: number;
  token_budget?: number;
  memory_selection?: {
    selected_entry_ids: string[];
    dropped: MemoryDroppedEntry[];
  };
  prompt_processing_trace?: unknown;
}

export interface MemorySelectionResult {
  short_term: MemoryEntry[];
  long_term: MemoryEntry[];
  summaries: MemoryEntry[];
  dropped: MemoryDroppedEntry[];
  diagnostics: MemorySelectionDiagnostics;
}

export interface MemoryContextPack {
  short_term: MemoryEntry[];
  long_term: MemoryEntry[];
  summaries: MemoryEntry[];
  diagnostics: MemorySelectionDiagnostics;
}

export interface LongTermMemorySearchInput {
  actor_ref: InferenceActorRef;
  query?: string;
  tags?: string[];
  limit: number;
}

export interface LongTermMemoryStore {
  search(input: LongTermMemorySearchInput): Promise<MemoryEntry[]>;
  save(entries: MemoryEntry[]): Promise<void>;
}

export * from './blocks/types.js';
