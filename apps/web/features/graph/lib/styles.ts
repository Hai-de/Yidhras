import type cytoscape from 'cytoscape'

const resolveNodeBackgroundColor = (ele: cytoscape.NodeSingular): string => {
  const kind = ele.data('kind') as string | undefined

  switch (kind) {
    case 'agent':
      return 'var(--yd-graph-agent)'
    case 'atmosphere':
      return 'var(--yd-graph-atmosphere)'
    case 'relay':
      return 'var(--yd-graph-relay)'
    case 'container':
      return 'var(--yd-graph-container)'
    default:
      return 'var(--yd-color-state-accent)'
  }
}

const resolveNodeShape = (ele: cytoscape.NodeSingular): string => {
  const kind = ele.data('kind') as string | undefined

  switch (kind) {
    case 'relay':
      return 'round-diamond'
    case 'container':
      return 'round-rectangle'
    case 'atmosphere':
      return 'ellipse'
    default:
      return 'round-hexagon'
  }
}

const resolveNodeBorderColor = (ele: cytoscape.NodeSingular): string => {
  const isPinned = Boolean(ele.data('state')?.is_pinned)
  return isPinned ? 'var(--yd-color-state-warning)' : 'var(--yd-color-border-strong)'
}

const resolveNodeBorderStyle = (ele: cytoscape.NodeSingular): string => {
  const kind = ele.data('kind') as string | undefined
  return kind === 'container' ? 'dashed' : 'solid'
}

const resolveNodeSize = (ele: cytoscape.NodeSingular): number => {
  const metadata = ele.data('metadata') as Record<string, unknown> | undefined
  const snr = typeof metadata?.snr === 'number' ? metadata.snr : 0.2
  return Math.max(26, Math.min(72, 28 + snr * 36))
}

const resolveEdgeColor = (ele: cytoscape.EdgeSingular): string => {
  const kind = ele.data('kind') as string | undefined

  switch (kind) {
    case 'transmission':
      return 'var(--yd-graph-relay)'
    case 'derived_from':
      return 'var(--yd-color-state-danger)'
    case 'ownership':
      return 'var(--yd-graph-atmosphere)'
    default:
      return 'var(--yd-graph-edge)'
  }
}

const resolveEdgeWidth = (ele: cytoscape.EdgeSingular): number => {
  const weight = ele.data('weight')
  return typeof weight === 'number' ? Math.min(6, Math.max(1, weight)) : 2
}

export const buildGraphStylesheet = () => {
  return [
    {
      selector: 'node',
      style: {
        label: 'data(title)',
        'background-color': resolveNodeBackgroundColor,
        shape: resolveNodeShape,
        width: resolveNodeSize,
        height: resolveNodeSize,
        color: 'var(--yd-color-text-primary)',
        'font-size': '10px',
        'font-family': 'var(--yd-font-mono)',
        'border-width': 2,
        'border-color': resolveNodeBorderColor,
        'border-style': resolveNodeBorderStyle,
        'text-wrap': 'wrap',
        'text-max-width': 120,
        'text-valign': 'bottom',
        'text-margin-y': 6,
        'overlay-opacity': 0
      }
    },
    {
      selector: 'edge',
      style: {
        width: resolveEdgeWidth,
        'line-color': resolveEdgeColor,
        'target-arrow-color': resolveEdgeColor,
        'target-arrow-shape': 'triangle',
        'curve-style': 'bezier',
        opacity: 0.72,
        label: 'data(title)',
        color: 'var(--yd-color-text-muted)',
        'font-size': '9px',
        'font-family': 'var(--yd-font-mono)',
        'text-background-color': 'var(--yd-color-bg-app)',
        'text-background-opacity': 0.85,
        'text-background-padding': 2
      }
    },
    {
      selector: 'node:selected',
      style: {
        'border-color': 'var(--yd-graph-selected)',
        'border-width': 3,
        'overlay-color': 'var(--yd-graph-selected)',
        'overlay-opacity': 0.12,
        'overlay-padding': 6
      }
    },
    {
      selector: 'edge:selected',
      style: {
        'line-color': 'var(--yd-graph-selected)',
        'target-arrow-color': 'var(--yd-graph-selected)',
        width: 4
      }
    }
  ]
}
