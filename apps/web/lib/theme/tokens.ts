export interface AppThemeTokens {
  meta: {
    id: string
    name: string
    colorScheme: 'dark'
  }
  colors: {
    bgApp: string
    bgPanel: string
    bgElevated: string
    bgOverlay: string
    borderStrong: string
    borderMuted: string
    textPrimary: string
    textSecondary: string
    textMuted: string
    textInverse: string
    stateSuccess: string
    stateWarning: string
    stateDanger: string
    stateInfo: string
    stateAccent: string
  }
  graph: {
    agent: string
    atmosphere: string
    relay: string
    container: string
    edge: string
    selected: string
  }
  grid: {
    lineColor: string
  }
  typography: {
    fontSans: string
    fontMono: string
  }
  radius: {
    sm: string
    md: string
    lg: string
  }
  border: {
    width: string
  }
  shadow: {
    panel: string
    elevated: string
  }
  layout: {
    minWidth: string
    maxContentWidth: string
  }
}

export const THEME_CSS_VARIABLES = {
  colorBgApp: '--yd-color-bg-app',
  colorBgPanel: '--yd-color-bg-panel',
  colorBgElevated: '--yd-color-bg-elevated',
  colorBgOverlay: '--yd-color-bg-overlay',
  colorBorderStrong: '--yd-color-border-strong',
  colorBorderMuted: '--yd-color-border-muted',
  colorTextPrimary: '--yd-color-text-primary',
  colorTextSecondary: '--yd-color-text-secondary',
  colorTextMuted: '--yd-color-text-muted',
  colorTextInverse: '--yd-color-text-inverse',
  colorStateSuccess: '--yd-color-state-success',
  colorStateWarning: '--yd-color-state-warning',
  colorStateDanger: '--yd-color-state-danger',
  colorStateInfo: '--yd-color-state-info',
  colorStateAccent: '--yd-color-state-accent',
  graphAgent: '--yd-graph-agent',
  graphAtmosphere: '--yd-graph-atmosphere',
  graphRelay: '--yd-graph-relay',
  graphContainer: '--yd-graph-container',
  graphEdge: '--yd-graph-edge',
  graphSelected: '--yd-graph-selected',
  gridLineColor: '--yd-grid-line-color',
  fontSans: '--yd-font-sans',
  fontMono: '--yd-font-mono',
  radiusSm: '--yd-radius-sm',
  radiusMd: '--yd-radius-md',
  radiusLg: '--yd-radius-lg',
  borderWidth: '--yd-border-width',
  shadowPanel: '--yd-shadow-panel',
  shadowElevated: '--yd-shadow-elevated',
  layoutMinWidth: '--yd-layout-min-width',
  layoutMaxContentWidth: '--yd-layout-max-content-width'
} as const
