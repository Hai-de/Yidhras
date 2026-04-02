export type PartialDeep<T> = {
  [K in keyof T]?: T[K] extends Record<string, unknown>
    ? PartialDeep<T[K]>
    : T[K]
}

export interface AppThemeMeta {
  id: string
  name: string
  colorScheme: 'dark' | 'light'
}

export interface AppThemeCoreTokens {
  colors: {
    bg: {
      app: string
      panel: string
      elevated: string
      overlay: string
    }
    border: {
      strong: string
      muted: string
    }
    text: {
      primary: string
      secondary: string
      muted: string
      inverse: string
    }
    state: {
      success: string
      warning: string
      danger: string
      info: string
      accent: string
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
      line: string
    }
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
}

export interface AppLayoutTokens {
  app: {
    minWidth: string
    maxContentWidth: string
    pagePaddingX: string
    pagePaddingY: string
    sectionGap: string
    cardGap: string
  }
  shell: {
    railWidth: string
    sidebarWidth: string
    dock: {
      minHeight: string
      defaultHeight: string
      maxHeight: string
    }
  }
}

export interface AppComponentTokens {
  panel: {
    backdropBlur: string
  }
}

export interface AppThemeDefinition {
  meta: AppThemeMeta
  core: AppThemeCoreTokens
  layout: AppLayoutTokens
  components: AppComponentTokens
}

export interface WorldPackThemeConfig {
  meta?: Partial<AppThemeMeta>
  core?: PartialDeep<AppThemeCoreTokens>
  layout?: PartialDeep<AppLayoutTokens>
  components?: PartialDeep<AppComponentTokens>
}

export interface ThemeValidationIssue {
  path: string
  severity: 'warning' | 'error'
  message: string
  fallbackApplied: boolean
}

export type ThemeSourceKind = 'default' | 'registry' | 'provider-metadata' | 'explicit-override'

export interface ThemeSourceDescriptor {
  kind: ThemeSourceKind
  worldPackId?: string | null
  path?: string | null
  label: string
}

export interface ResolvedThemeDiagnostics {
  source: ThemeSourceDescriptor
  issues: ThemeValidationIssue[]
}

export const CORE_THEME_CSS_VARIABLES = {
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
  shadowElevated: '--yd-shadow-elevated'
} as const

export const LAYOUT_THEME_CSS_VARIABLES = {
  appMinWidth: '--yd-layout-min-width',
  appMaxContentWidth: '--yd-layout-max-content-width',
  pagePaddingX: '--yd-layout-page-padding-x',
  pagePaddingY: '--yd-layout-page-padding-y',
  sectionGap: '--yd-layout-section-gap',
  cardGap: '--yd-layout-card-gap',
  shellRailWidth: '--yd-layout-shell-rail-width',
  shellSidebarWidth: '--yd-layout-shell-sidebar-width',
  shellDockMinHeight: '--yd-layout-shell-dock-min-height',
  shellDockDefaultHeight: '--yd-layout-shell-dock-default-height',
  shellDockMaxHeight: '--yd-layout-shell-dock-max-height'
} as const

export const COMPONENT_THEME_CSS_VARIABLES = {
  panelBackdropBlur: '--yd-panel-backdrop-blur'
} as const
