export interface ListAtmosphereNodesInput {
  owner_id?: string | undefined;
  include_expired?: boolean | undefined;
}

export interface ListRelationshipAdjustmentLogsInput {
  from_id?: string | undefined;
  to_id?: string | undefined;
  type?: string | undefined;
  limit?: number | undefined;
}

export interface GraphViewInput {
  view?: string | undefined;
  root_id?: string | undefined;
  depth?: number | undefined;
  kinds?: string[] | undefined;
  include_inactive?: boolean | undefined;
  include_unresolved?: boolean | undefined;
  search?: string | undefined;
}

export interface GraphNodeView {
  id: string;
  kind: 'agent' | 'atmosphere' | 'relay' | 'container';
  label: string;
  render_type?: 'avatar' | 'chip' | 'relay' | 'blackbox' | undefined;
  display?: {
    avatar_url?: string | null | undefined;
    image_url?: string | null | undefined;
    icon?: string | null | undefined;
    accent_token?: string | null | undefined;
  };
  state?: {
    is_pinned?: boolean | undefined;
    activity_status?: 'active' | 'inactive' | 'idle' | 'unknown' | undefined;
    resolve_state?: 'open' | 'merged' | 'resolved' | 'sealed' | undefined;
    lifecycle_status?: 'active' | 'idle' | 'gc_candidate' | 'recycled' | 'sealed' | undefined;
  };
  refs?: {
    agent_id?: string | null | undefined;
    atmosphere_node_id?: string | null | undefined;
    source_action_intent_id?: string | null | undefined;
    source_event_id?: string | null | undefined;
    source_inference_id?: string | null | undefined;
    merged_into_node_id?: string | null | undefined;
  };
  metadata?: Record<string, unknown> | undefined;
}

export interface GraphEdgeView {
  id: string;
  source: string;
  target: string;
  kind: 'relationship' | 'ownership' | 'transmission' | 'derived_from';
  label?: string | undefined;
  weight?: number | null | undefined;
  refs?: {
    relationship_id?: string | null | undefined;
    action_intent_id?: string | null | undefined;
    event_id?: string | null | undefined;
  };
  metadata?: Record<string, unknown> | undefined;
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

export { isRecord } from '../../../utils/type_guards.js';
