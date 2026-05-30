import type { InferenceActorRef } from '../inference/types.js';

export type MemoryScope = 'short_term' | 'long_term';
export type MemorySourceKind = 'trace' | 'intent' | 'job' | 'post' | 'event' | 'summary' | 'manual';

export interface MemorySourceRef {
  trace_id?: string | undefined;
  job_id?: string | undefined;
  intent_id?: string | undefined;
  post_id?: string | undefined;
  event_id?: string | undefined;
  source_message_id?: string | undefined;
}

export interface MemoryVisibility {
  min_level?: number | undefined;
  circle_id?: string | null | undefined;
  policy_gate?: string | null | undefined;
}

export interface MemoryContent {
  text: string;
  structured?: Record<string, unknown> | undefined;
}

export interface MemoryEntry {
  id: string;
  scope: MemoryScope;
  actor_ref?: InferenceActorRef | null | undefined;
  source_kind: MemorySourceKind;
  source_ref?: MemorySourceRef | null | undefined;
  content: MemoryContent;
  tags: string[];
  importance: number;
  salience: number;
  confidence?: number | null | undefined;
  visibility?: MemoryVisibility | null | undefined;
  created_at: string;
  occurred_at?: string | null | undefined;
  expires_at?: string | null | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface MemoryDroppedEntry {
  entry_id: string;
  reason: string;
}

export interface MemorySelectionDiagnostics {
  selected_count: number;
  skipped_count: number;
  token_budget?: number | undefined;
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
  query?: string | undefined;
  query_embedding?: number[] | undefined;
  tags?: string[] | undefined;
  limit: number;
}

export interface LongTermMemoryStore {
  search(input: LongTermMemorySearchInput): Promise<MemoryEntry[]>;
  save(entries: MemoryEntry[]): Promise<void>;
}

export * from './blocks/types.js';
