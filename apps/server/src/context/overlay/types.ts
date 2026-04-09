export type ContextOverlayType = 'self_note' | 'target_dossier' | 'system_summary';

export type ContextOverlayStatus = 'active' | 'archived' | 'deleted';

export type ContextOverlayPersistenceMode = 'run_local' | 'sticky' | 'persistent';

export type ContextOverlayCreatedBy = 'system' | 'agent';

export interface ContextOverlayEntry {
  id: string;
  actor_id: string;
  pack_id: string | null;
  overlay_type: ContextOverlayType;
  title: string | null;
  content_text: string;
  content_structured: Record<string, unknown> | null;
  tags: string[];
  status: ContextOverlayStatus;
  persistence_mode: ContextOverlayPersistenceMode;
  source_node_ids: string[];
  created_by: ContextOverlayCreatedBy;
  created_at_tick: string;
  updated_at_tick: string;
}

export interface ContextOverlayQuery {
  actor_id: string;
  pack_id?: string | null;
  statuses?: ContextOverlayStatus[];
  limit?: number;
}

export interface ContextOverlayCreateInput {
  id?: string;
  actor_id: string;
  pack_id?: string | null;
  overlay_type: ContextOverlayType;
  title?: string | null;
  content_text: string;
  content_structured?: Record<string, unknown> | null;
  tags?: string[];
  status?: ContextOverlayStatus;
  persistence_mode?: ContextOverlayPersistenceMode;
  source_node_ids?: string[];
  created_by: ContextOverlayCreatedBy;
  created_at_tick: string;
  updated_at_tick?: string;
}

export interface ContextOverlayStore {
  listEntries(input: ContextOverlayQuery): Promise<ContextOverlayEntry[]>;
  createEntry(input: ContextOverlayCreateInput): Promise<ContextOverlayEntry>;
}
