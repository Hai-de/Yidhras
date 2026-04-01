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

export interface GraphInspectorSectionViewModel {
  id: string
  title: string
  subtitle: string
  fields: GraphInspectorField[]
  emptyMessage: string
}

export interface GraphInspectorActionViewModel {
  id: 'agent' | 'workflow'
  label: string
  disabled: boolean
  helper: string
}

export interface GraphInspectorViewModel {
  id: string
  title: string
  subtitle: string
  fields: GraphInspectorField[]
  refs: GraphInspectorField[]
  metadata: GraphInspectorField[]
  sections: GraphInspectorSectionViewModel[]
  actions: GraphInspectorActionViewModel[]
}

export interface GraphQuickRootViewModel {
  id: string
  label: string
  subtitle: string
  isActive: boolean
}

export interface GraphFocusSummaryViewModel {
  selectedNodeId: string | null
  selectedNodeLabel: string | null
  rootId: string | null
  rootLabel: string | null
  resultSummary: string
  filterSummary: string
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

  const fields: GraphInspectorField[] = [
    { label: 'kind', value: node.kind },
    { label: 'render_type', value: node.render_type ?? '—' },
    { label: 'activity_status', value: node.state?.activity_status ?? '—' },
    { label: 'lifecycle_status', value: node.state?.lifecycle_status ?? '—' },
    { label: 'is_pinned', value: String(node.state?.is_pinned ?? false) },
    { label: 'connected_edges', value: String(connectedEdges.length) }
  ]
  const refs = toFieldEntries(node.refs)
  const metadata = toFieldEntries(node.metadata)
  const actions: GraphInspectorActionViewModel[] = [
    {
      id: 'agent',
      label: 'Open Agent',
      disabled: !refs.some(field => field.label === 'agent_id' && field.value !== '—'),
      helper: refs.some(field => field.label === 'agent_id' && field.value !== '—')
        ? 'Continue to agent detail using current graph source context.'
        : 'No agent ref available for the selected node.'
    },
    {
      id: 'workflow',
      label: 'Open Workflow',
      disabled: !refs.some(field => field.label === 'source_action_intent_id' && field.value !== '—'),
      helper: refs.some(field => field.label === 'source_action_intent_id' && field.value !== '—')
        ? 'Continue to workflow intent detail using graph source context.'
        : 'No workflow intent ref available for the selected node.'
    }
  ]

  return {
    id: node.id,
    title: node.label,
    subtitle: `${node.kind} · ${node.render_type ?? 'default'}`,
    fields,
    refs,
    metadata,
    sections: [
      {
        id: 'fields',
        title: 'Core Fields',
        subtitle: 'Renderable node semantics and current graph state.',
        fields,
        emptyMessage: 'No core fields available.'
      },
      {
        id: 'refs',
        title: 'Refs',
        subtitle: 'Business identifiers and cross-workspace linkage hints.',
        fields: refs,
        emptyMessage: 'No refs available.'
      },
      {
        id: 'metadata',
        title: 'Metadata / Provenance',
        subtitle: 'Additional payload attached to the node read model.',
        fields: metadata,
        emptyMessage: 'No metadata available.'
      }
    ],
    actions
  }
}

export const getConnectedEdges = (snapshot: GraphViewSnapshot | null, nodeId: string | null): GraphEdgeView[] => {
  if (!snapshot || !nodeId) {
    return []
  }

  return snapshot.edges.filter(edge => edge.source === nodeId || edge.target === nodeId)
}

export const buildGraphQuickRoots = (
  snapshot: GraphViewSnapshot | null,
  activeRootId: string | null
): GraphQuickRootViewModel[] => {
  if (!snapshot) {
    return []
  }

  return snapshot.summary.active_root_ids.slice(0, 6).map(rootId => {
    const node = findGraphNodeById(snapshot, rootId)

    return {
      id: rootId,
      label: node?.label ?? rootId,
      subtitle: node ? `${node.kind} · ${node.render_type ?? 'default'}` : 'root candidate',
      isActive: rootId === activeRootId
    }
  })
}

export const buildGraphFocusSummary = (
  snapshot: GraphViewSnapshot | null,
  selectedNode: GraphNodeView | null
): GraphFocusSummaryViewModel => {
  const rootNode = findGraphNodeById(snapshot, snapshot?.summary.applied_filters.root_id ?? null)
  const kinds = snapshot?.summary.applied_filters.kinds?.join(', ') ?? 'all kinds'
  const search = snapshot?.summary.applied_filters.search ?? 'no keyword'

  return {
    selectedNodeId: selectedNode?.id ?? null,
    selectedNodeLabel: selectedNode?.label ?? null,
    rootId: snapshot?.summary.applied_filters.root_id ?? null,
    rootLabel: rootNode?.label ?? null,
    resultSummary: snapshot
      ? `${snapshot.summary.returned_node_count} node(s) · ${snapshot.summary.returned_edge_count} edge(s)`
      : 'No graph projection loaded',
    filterSummary: snapshot
      ? `depth ${snapshot.summary.applied_filters.depth} · ${kinds} · ${search}`
      : 'No graph filters applied'
  }
}

export const buildGraphSearchExplainer = (snapshot: GraphViewSnapshot | null): string => {
  if (!snapshot) {
    return 'Load a graph projection to inspect current search scope and filter impact.'
  }

  const search = snapshot.summary.applied_filters.search
  const kinds = snapshot.summary.applied_filters.kinds?.join(', ') ?? 'all kinds'

  if (!search && snapshot.summary.returned_node_count === 0) {
    return 'No keyword is active. Current structural filters removed all nodes from the projection.'
  }

  if (!search) {
    return `Showing ${snapshot.summary.returned_node_count} node(s) across ${kinds} without a keyword filter.`
  }

  if (snapshot.summary.returned_node_count === 0) {
    return `Keyword “${search}” returned no nodes in ${kinds}. Clear search or broaden kinds/depth to recover context.`
  }

  return `Keyword “${search}” matched within ${kinds}; ${snapshot.summary.returned_node_count} node(s) remain in the current projection.`
}
