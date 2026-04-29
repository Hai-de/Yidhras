import { requestApiData } from '../../lib/http/client'
import { normalizeOptionalString } from '../../lib/route/query'

export type GraphViewMode = 'mesh' | 'tree'
export type GraphNodeKind = 'agent' | 'atmosphere' | 'relay' | 'container'
export type GraphRenderType = 'avatar' | 'chip' | 'relay' | 'blackbox'
export type GraphEdgeKind = 'relationship' | 'ownership' | 'transmission' | 'derived_from'

export interface GraphNodeView {
  id: string
  kind: GraphNodeKind
  label: string
  render_type?: GraphRenderType
  display?: {
    avatar_url?: string | null
    image_url?: string | null
    icon?: string | null
    accent_token?: string | null
  }
  state?: {
    is_pinned?: boolean
    activity_status?: 'active' | 'inactive' | 'idle' | 'unknown'
    resolve_state?: 'open' | 'merged' | 'resolved' | 'sealed'
    lifecycle_status?: 'active' | 'idle' | 'gc_candidate' | 'recycled' | 'sealed'
  }
  refs?: {
    agent_id?: string | null
    atmosphere_node_id?: string | null
    source_action_intent_id?: string | null
    source_event_id?: string | null
    source_inference_id?: string | null
    merged_into_node_id?: string | null
  }
  metadata?: Record<string, unknown>
}

export interface GraphEdgeView {
  id: string
  source: string
  target: string
  kind: GraphEdgeKind
  label?: string
  weight?: number | null
  refs?: {
    relationship_id?: string | null
    action_intent_id?: string | null
    event_id?: string | null
  }
  metadata?: Record<string, unknown>
}

export interface GraphViewSnapshot {
  schema_version: 'graph'
  view: GraphViewMode
  nodes: GraphNodeView[]
  edges: GraphEdgeView[]
  summary: {
    counts_by_kind: Record<string, number>
    active_root_ids: string[]
    returned_node_count: number
    returned_edge_count: number
    applied_filters: {
      kinds: string[] | null
      root_id: string | null
      depth: number
      include_inactive: boolean
      include_unresolved: boolean
      search: string | null
    }
  }
}

export interface GraphViewQueryInput {
  view?: GraphViewMode
  rootId?: string | null
  depth?: number
  kinds?: string | null
  includeInactive?: boolean
  includeUnresolved?: boolean
  search?: string | null
}

const buildGraphQueryString = (input: GraphViewQueryInput): string => {
  const searchParams = new URLSearchParams()

  if (input.view && input.view !== 'mesh') {
    searchParams.set('view', input.view)
  }

  if (typeof input.depth === 'number' && Number.isFinite(input.depth)) {
    searchParams.set('depth', String(Math.min(3, Math.max(0, Math.trunc(input.depth)))))
  }

  const rootId = normalizeOptionalString(input.rootId)
  const kinds = normalizeOptionalString(input.kinds)
  const search = normalizeOptionalString(input.search)

  if (rootId) {
    searchParams.set('root_id', rootId)
  }

  if (kinds) {
    searchParams.set('kinds', kinds)
  }

  if (typeof input.includeInactive === 'boolean' && input.includeInactive) {
    searchParams.set('include_inactive', 'true')
  }

  if (typeof input.includeUnresolved === 'boolean' && input.includeUnresolved === false) {
    searchParams.set('include_unresolved', 'false')
  }

  if (search) {
    searchParams.set('search', search)
  }

  const queryString = searchParams.toString()
  return queryString.length > 0 ? `?${queryString}` : ''
}

export const useGraphApi = () => {
  return {
    getView: (input: GraphViewQueryInput = {}) =>
      requestApiData<GraphViewSnapshot>(`/api/graph/view${buildGraphQueryString(input)}`)
  }
}
