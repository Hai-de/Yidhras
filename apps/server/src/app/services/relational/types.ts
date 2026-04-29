export interface ListAtmosphereNodesInput {
  owner_id?: string;
  include_expired?: boolean;
}

export interface ListRelationshipAdjustmentLogsInput {
  from_id?: string;
  to_id?: string;
  type?: string;
  limit?: number;
}

export interface GraphViewInput {
  view?: string;
  root_id?: string;
  depth?: number;
  kinds?: string[];
  include_inactive?: boolean;
  include_unresolved?: boolean;
  search?: string;
}

export interface GraphNodeView {
  id: string;
  kind: 'agent' | 'atmosphere' | 'relay' | 'container';
  label: string;
  render_type?: 'avatar' | 'chip' | 'relay' | 'blackbox';
  display?: {
    avatar_url?: string | null;
    image_url?: string | null;
    icon?: string | null;
    accent_token?: string | null;
  };
  state?: {
    is_pinned?: boolean;
    activity_status?: 'active' | 'inactive' | 'idle' | 'unknown';
    resolve_state?: 'open' | 'merged' | 'resolved' | 'sealed';
    lifecycle_status?: 'active' | 'idle' | 'gc_candidate' | 'recycled' | 'sealed';
  };
  refs?: {
    agent_id?: string | null;
    atmosphere_node_id?: string | null;
    source_action_intent_id?: string | null;
    source_event_id?: string | null;
    source_inference_id?: string | null;
    merged_into_node_id?: string | null;
  };
  metadata?: Record<string, unknown>;
}

export interface GraphEdgeView {
  id: string;
  source: string;
  target: string;
  kind: 'relationship' | 'ownership' | 'transmission' | 'derived_from';
  label?: string;
  weight?: number | null;
  refs?: {
    relationship_id?: string | null;
    action_intent_id?: string | null;
    event_id?: string | null;
  };
  metadata?: Record<string, unknown>;
}

export interface GraphViewSnapshot {
  schema_version: 'graph';
  view: 'mesh' | 'tree';
  nodes: GraphNodeView[];
  edges: GraphEdgeView[];
  summary: {
    counts_by_kind: Record<string, number>;
    active_root_ids: string[];
    returned_node_count: number;
    returned_edge_count: number;
    applied_filters: {
      kinds: string[] | null;
      root_id: string | null;
      depth: number;
      include_inactive: boolean;
      include_unresolved: boolean;
      search: string | null;
    };
  };
}

export const DEFAULT_RELATIONSHIP_LOG_LIMIT = 20;
export const MAX_RELATIONSHIP_LOG_LIMIT = 100;
export const DEFAULT_GRAPH_DEPTH = 1;
export const MAX_GRAPH_DEPTH = 3;
export const GRAPH_NODE_KINDS = ['agent', 'atmosphere', 'relay', 'container'] as const;

export const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};
