import type { AppThemeTokens } from './tokens'
import { THEME_CSS_VARIABLES } from './tokens'

export const createThemeCssVariableEntries = (tokens: AppThemeTokens): Record<string, string> => {
  return {
    [THEME_CSS_VARIABLES.colorBgApp]: tokens.colors.bgApp,
    [THEME_CSS_VARIABLES.colorBgPanel]: tokens.colors.bgPanel,
    [THEME_CSS_VARIABLES.colorBgElevated]: tokens.colors.bgElevated,
    [THEME_CSS_VARIABLES.colorBgOverlay]: tokens.colors.bgOverlay,
    [THEME_CSS_VARIABLES.colorBorderStrong]: tokens.colors.borderStrong,
    [THEME_CSS_VARIABLES.colorBorderMuted]: tokens.colors.borderMuted,
    [THEME_CSS_VARIABLES.colorTextPrimary]: tokens.colors.textPrimary,
    [THEME_CSS_VARIABLES.colorTextSecondary]: tokens.colors.textSecondary,
    [THEME_CSS_VARIABLES.colorTextMuted]: tokens.colors.textMuted,
    [THEME_CSS_VARIABLES.colorTextInverse]: tokens.colors.textInverse,
    [THEME_CSS_VARIABLES.colorStateSuccess]: tokens.colors.stateSuccess,
    [THEME_CSS_VARIABLES.colorStateWarning]: tokens.colors.stateWarning,
    [THEME_CSS_VARIABLES.colorStateDanger]: tokens.colors.stateDanger,
    [THEME_CSS_VARIABLES.colorStateInfo]: tokens.colors.stateInfo,
    [THEME_CSS_VARIABLES.colorStateAccent]: tokens.colors.stateAccent,
    [THEME_CSS_VARIABLES.graphAgent]: tokens.graph.agent,
    [THEME_CSS_VARIABLES.graphAtmosphere]: tokens.graph.atmosphere,
    [THEME_CSS_VARIABLES.graphRelay]: tokens.graph.relay,
    [THEME_CSS_VARIABLES.graphContainer]: tokens.graph.container,
    [THEME_CSS_VARIABLES.graphEdge]: tokens.graph.edge,
    [THEME_CSS_VARIABLES.graphSelected]: tokens.graph.selected,
    [THEME_CSS_VARIABLES.gridLineColor]: tokens.grid.lineColor,
    [THEME_CSS_VARIABLES.fontSans]: tokens.typography.fontSans,
    [THEME_CSS_VARIABLES.fontMono]: tokens.typography.fontMono,
    [THEME_CSS_VARIABLES.radiusSm]: tokens.radius.sm,
    [THEME_CSS_VARIABLES.radiusMd]: tokens.radius.md,
    [THEME_CSS_VARIABLES.radiusLg]: tokens.radius.lg,
    [THEME_CSS_VARIABLES.borderWidth]: tokens.border.width,
    [THEME_CSS_VARIABLES.shadowPanel]: tokens.shadow.panel,
    [THEME_CSS_VARIABLES.shadowElevated]: tokens.shadow.elevated,
    [THEME_CSS_VARIABLES.layoutMinWidth]: tokens.layout.minWidth,
    [THEME_CSS_VARIABLES.layoutMaxContentWidth]: tokens.layout.maxContentWidth
  }
}

export const applyThemeCssVariables = (
  tokens: AppThemeTokens,
  target: HTMLElement = document.documentElement
): void => {
  const entries = createThemeCssVariableEntries(tokens)

  Object.entries(entries).forEach(([variableName, value]) => {
    target.style.setProperty(variableName, value)
  })
}
