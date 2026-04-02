import type { AppThemeDefinition, ThemeSourceDescriptor } from './tokens'
import {
  COMPONENT_THEME_CSS_VARIABLES,
  CORE_THEME_CSS_VARIABLES,
  LAYOUT_THEME_CSS_VARIABLES
} from './tokens'

export const createThemeCssVariableEntries = (theme: AppThemeDefinition): Record<string, string> => {
  return {
    [CORE_THEME_CSS_VARIABLES.colorBgApp]: theme.core.colors.bg.app,
    [CORE_THEME_CSS_VARIABLES.colorBgPanel]: theme.core.colors.bg.panel,
    [CORE_THEME_CSS_VARIABLES.colorBgElevated]: theme.core.colors.bg.elevated,
    [CORE_THEME_CSS_VARIABLES.colorBgOverlay]: theme.core.colors.bg.overlay,
    [CORE_THEME_CSS_VARIABLES.colorBorderStrong]: theme.core.colors.border.strong,
    [CORE_THEME_CSS_VARIABLES.colorBorderMuted]: theme.core.colors.border.muted,
    [CORE_THEME_CSS_VARIABLES.colorTextPrimary]: theme.core.colors.text.primary,
    [CORE_THEME_CSS_VARIABLES.colorTextSecondary]: theme.core.colors.text.secondary,
    [CORE_THEME_CSS_VARIABLES.colorTextMuted]: theme.core.colors.text.muted,
    [CORE_THEME_CSS_VARIABLES.colorTextInverse]: theme.core.colors.text.inverse,
    [CORE_THEME_CSS_VARIABLES.colorStateSuccess]: theme.core.colors.state.success,
    [CORE_THEME_CSS_VARIABLES.colorStateWarning]: theme.core.colors.state.warning,
    [CORE_THEME_CSS_VARIABLES.colorStateDanger]: theme.core.colors.state.danger,
    [CORE_THEME_CSS_VARIABLES.colorStateInfo]: theme.core.colors.state.info,
    [CORE_THEME_CSS_VARIABLES.colorStateAccent]: theme.core.colors.state.accent,
    [CORE_THEME_CSS_VARIABLES.graphAgent]: theme.core.colors.graph.agent,
    [CORE_THEME_CSS_VARIABLES.graphAtmosphere]: theme.core.colors.graph.atmosphere,
    [CORE_THEME_CSS_VARIABLES.graphRelay]: theme.core.colors.graph.relay,
    [CORE_THEME_CSS_VARIABLES.graphContainer]: theme.core.colors.graph.container,
    [CORE_THEME_CSS_VARIABLES.graphEdge]: theme.core.colors.graph.edge,
    [CORE_THEME_CSS_VARIABLES.graphSelected]: theme.core.colors.graph.selected,
    [CORE_THEME_CSS_VARIABLES.gridLineColor]: theme.core.colors.grid.line,
    [CORE_THEME_CSS_VARIABLES.fontSans]: theme.core.typography.fontSans,
    [CORE_THEME_CSS_VARIABLES.fontMono]: theme.core.typography.fontMono,
    [CORE_THEME_CSS_VARIABLES.radiusSm]: theme.core.radius.sm,
    [CORE_THEME_CSS_VARIABLES.radiusMd]: theme.core.radius.md,
    [CORE_THEME_CSS_VARIABLES.radiusLg]: theme.core.radius.lg,
    [CORE_THEME_CSS_VARIABLES.borderWidth]: theme.core.border.width,
    [CORE_THEME_CSS_VARIABLES.shadowPanel]: theme.core.shadow.panel,
    [CORE_THEME_CSS_VARIABLES.shadowElevated]: theme.core.shadow.elevated,
    [LAYOUT_THEME_CSS_VARIABLES.appMinWidth]: theme.layout.app.minWidth,
    [LAYOUT_THEME_CSS_VARIABLES.appMaxContentWidth]: theme.layout.app.maxContentWidth,
    [LAYOUT_THEME_CSS_VARIABLES.pagePaddingX]: theme.layout.app.pagePaddingX,
    [LAYOUT_THEME_CSS_VARIABLES.pagePaddingY]: theme.layout.app.pagePaddingY,
    [LAYOUT_THEME_CSS_VARIABLES.sectionGap]: theme.layout.app.sectionGap,
    [LAYOUT_THEME_CSS_VARIABLES.cardGap]: theme.layout.app.cardGap,
    [LAYOUT_THEME_CSS_VARIABLES.shellRailWidth]: theme.layout.shell.railWidth,
    [LAYOUT_THEME_CSS_VARIABLES.shellSidebarWidth]: theme.layout.shell.sidebarWidth,
    [LAYOUT_THEME_CSS_VARIABLES.shellDockMinHeight]: theme.layout.shell.dock.minHeight,
    [LAYOUT_THEME_CSS_VARIABLES.shellDockDefaultHeight]: theme.layout.shell.dock.defaultHeight,
    [LAYOUT_THEME_CSS_VARIABLES.shellDockMaxHeight]: theme.layout.shell.dock.maxHeight,
    [COMPONENT_THEME_CSS_VARIABLES.panelBackdropBlur]: theme.components.panel.backdropBlur
  }
}

export const applyResolvedTheme = (
  theme: AppThemeDefinition,
  options?: {
    source?: ThemeSourceDescriptor
    target?: HTMLElement
  }
): void => {
  const target = options?.target ?? document.documentElement
  const entries = createThemeCssVariableEntries(theme)

  Object.entries(entries).forEach(([variableName, value]) => {
    target.style.setProperty(variableName, value)
  })

  target.style.setProperty('color-scheme', theme.meta.colorScheme)
  target.dataset.themeId = theme.meta.id
  target.dataset.themeScheme = theme.meta.colorScheme

  if (options?.source) {
    target.dataset.themeSource = options.source.kind
    target.dataset.themeSourceLabel = options.source.label

    if (options.source.worldPackId) {
      target.dataset.themeWorldPackId = options.source.worldPackId
    } else {
      delete target.dataset.themeWorldPackId
    }

    if (options.source.path) {
      target.dataset.themeSourcePath = options.source.path
    } else {
      delete target.dataset.themeSourcePath
    }
  }
}
