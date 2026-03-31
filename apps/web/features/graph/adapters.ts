import type { GraphEdgeView, GraphNodeView, GraphViewSnapshot } from '../../composables/api/useGraphApi'

export interface GraphMetricViewModel {
  id: string
  label: string
  value: string
  subtitle: string
}

export interface GraphInspectorField {
  label: string
  value: string
}

export interface GraphInspectorViewModel {
  id: string
  title: string
  subtitle: string
  fields: GraphInspectorField[]
  refs: GraphInspectorField[]
  metadata: GraphInspectorField[]
}

const stringifyValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '—'
  }

  if (typeof value === 'string') {
    return value
  }

  return JSON.stringify(value)
}

const toFieldEntries = (record: Record<string, unknown> | undefined): GraphInspectorField[] => {
  if (!record) {
    return []
  }

  return Object.entries(record).map(([key, value]) => ({
    label: key,
    value: stringifyValue(value)
  }))
}

export const buildGraphMetricItems = (snapshot: GraphViewSnapshot | null): GraphMetricViewModel[] => {
  if (!snapshot) {
    return []
  }

  return [
    {
      id: 'node-count',
      label: 'Nodes',
      value: String(snapshot.summary.returned_node_count),
      subtitle: 'Returned in current graph projection'
    },
    {
      id: 'edge-count',
      label: 'Edges',
      value: String(snapshot.summary.returned_edge_count),
      subtitle: 'Visible relation / transmission links'
    },
    {
      id: 'active-roots',
      label: 'Active Roots',
      value: String(snapshot.summary.active_root_ids.length),
      subtitle: 'Root-capable active binding references'
    },
    {
      id: 'schema-version',
      label: 'Schema',
      value: snapshot.schema_version,
      subtitle: `view=${snapshot.view}`
    }
  ]
}

export const buildGraphSummaryFields = (snapshot: GraphViewSnapshot | null): GraphInspectorField[] => {
  if (!snapshot) {
    return []
  }

  return [
    { label: 'view', value: snapshot.view },
    { label: 'root_id', value: snapshot.summary.applied_filters.root_id ?? '—' },
    { label: 'depth', value: String(snapshot.summary.applied_filters.depth) },
    {
      label: 'include_inactive',
      value: String(snapshot.summary.applied_filters.include_inactive)
    },
    {
      label: 'include_unresolved',
      value: String(snapshot.summary.applied_filters.include_unresolved)
    },
    {
      label: 'search',
      value: snapshot.summary.applied_filters.search ?? '—'
    }
  ]
}

export const findGraphNodeById = (
  snapshot: GraphViewSnapshot | null,
  nodeId: string | null
): GraphNodeView | null => {
  if (!snapshot || !nodeId) {
    return null
  }

  return snapshot.nodes.find(node => node.id === nodeId) ?? null
}

export const buildGraphInspectorViewModel = (
  node: GraphNodeView | null,
  connectedEdges: GraphEdgeView[]
): GraphInspectorViewModel | null => {
  if (!node) {
    return null
  }

  return {
    id: node.id,
    title: node.label,
    subtitle: `${node.kind} · ${node.render_type ?? 'default'}`,
    fields: [
      { label: 'kind', value: node.kind },
      { label: 'render_type', value: node.render_type ?? '—' },
      { label: 'activity_status', value: node.state?.activity_status ?? '—' },
      { label: 'lifecycle_status', value: node.state?.lifecycle_status ?? '—' },
      { label: 'is_pinned', value: String(node.state?.is_pinned ?? false) },
      { label: 'connected_edges', value: String(connectedEdges.length) }
    ],
    refs: toFieldEntries(node.refs),
    metadata: toFieldEntries(node.metadata)
  }
}

export const getConnectedEdges = (snapshot: GraphViewSnapshot | null, nodeId: string | null): GraphEdgeView[] => {
  if (!snapshot || !nodeId) {
    return []
  }

  return snapshot.edges.filter(edge => edge.source === nodeId || edge.target === nodeId)
}
