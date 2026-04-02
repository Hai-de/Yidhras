import type { AppThemeDefinition, ThemeValidationIssue } from './tokens'

export const isValidCssColor = (value: string): boolean => {
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') {
    return value.trim().length > 0
  }

  return CSS.supports('color', value)
}

export const isValidCssLength = (value: string): boolean => {
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') {
    return value.trim().length > 0
  }

  return CSS.supports('width', value)
}

export const validateResolvedTheme = (
  theme: AppThemeDefinition,
  fallbackTheme: AppThemeDefinition
): ThemeValidationIssue[] => {
  const issues: ThemeValidationIssue[] = []

  if (theme.meta.colorScheme !== 'dark' && theme.meta.colorScheme !== 'light') {
    issues.push({
      path: 'meta.colorScheme',
      severity: 'warning',
      message: `Invalid colorScheme '${theme.meta.colorScheme}', fallback applied.`,
      fallbackApplied: true
    })
    theme.meta.colorScheme = fallbackTheme.meta.colorScheme
  }

  const colorChecks: Array<[string, string, string, (nextValue: string) => void]> = [
    ['core.colors.bg.app', theme.core.colors.bg.app, fallbackTheme.core.colors.bg.app, nextValue => (theme.core.colors.bg.app = nextValue)],
    ['core.colors.bg.panel', theme.core.colors.bg.panel, fallbackTheme.core.colors.bg.panel, nextValue => (theme.core.colors.bg.panel = nextValue)],
    ['core.colors.bg.elevated', theme.core.colors.bg.elevated, fallbackTheme.core.colors.bg.elevated, nextValue => (theme.core.colors.bg.elevated = nextValue)],
    ['core.colors.bg.overlay', theme.core.colors.bg.overlay, fallbackTheme.core.colors.bg.overlay, nextValue => (theme.core.colors.bg.overlay = nextValue)],
    ['core.colors.border.strong', theme.core.colors.border.strong, fallbackTheme.core.colors.border.strong, nextValue => (theme.core.colors.border.strong = nextValue)],
    ['core.colors.border.muted', theme.core.colors.border.muted, fallbackTheme.core.colors.border.muted, nextValue => (theme.core.colors.border.muted = nextValue)],
    ['core.colors.text.primary', theme.core.colors.text.primary, fallbackTheme.core.colors.text.primary, nextValue => (theme.core.colors.text.primary = nextValue)],
    ['core.colors.text.secondary', theme.core.colors.text.secondary, fallbackTheme.core.colors.text.secondary, nextValue => (theme.core.colors.text.secondary = nextValue)],
    ['core.colors.text.muted', theme.core.colors.text.muted, fallbackTheme.core.colors.text.muted, nextValue => (theme.core.colors.text.muted = nextValue)],
    ['core.colors.text.inverse', theme.core.colors.text.inverse, fallbackTheme.core.colors.text.inverse, nextValue => (theme.core.colors.text.inverse = nextValue)],
    ['core.colors.state.success', theme.core.colors.state.success, fallbackTheme.core.colors.state.success, nextValue => (theme.core.colors.state.success = nextValue)],
    ['core.colors.state.warning', theme.core.colors.state.warning, fallbackTheme.core.colors.state.warning, nextValue => (theme.core.colors.state.warning = nextValue)],
    ['core.colors.state.danger', theme.core.colors.state.danger, fallbackTheme.core.colors.state.danger, nextValue => (theme.core.colors.state.danger = nextValue)],
    ['core.colors.state.info', theme.core.colors.state.info, fallbackTheme.core.colors.state.info, nextValue => (theme.core.colors.state.info = nextValue)],
    ['core.colors.state.accent', theme.core.colors.state.accent, fallbackTheme.core.colors.state.accent, nextValue => (theme.core.colors.state.accent = nextValue)],
    ['core.colors.graph.agent', theme.core.colors.graph.agent, fallbackTheme.core.colors.graph.agent, nextValue => (theme.core.colors.graph.agent = nextValue)],
    ['core.colors.graph.atmosphere', theme.core.colors.graph.atmosphere, fallbackTheme.core.colors.graph.atmosphere, nextValue => (theme.core.colors.graph.atmosphere = nextValue)],
    ['core.colors.graph.relay', theme.core.colors.graph.relay, fallbackTheme.core.colors.graph.relay, nextValue => (theme.core.colors.graph.relay = nextValue)],
    ['core.colors.graph.container', theme.core.colors.graph.container, fallbackTheme.core.colors.graph.container, nextValue => (theme.core.colors.graph.container = nextValue)],
    ['core.colors.graph.edge', theme.core.colors.graph.edge, fallbackTheme.core.colors.graph.edge, nextValue => (theme.core.colors.graph.edge = nextValue)],
    ['core.colors.graph.selected', theme.core.colors.graph.selected, fallbackTheme.core.colors.graph.selected, nextValue => (theme.core.colors.graph.selected = nextValue)],
    ['core.colors.grid.line', theme.core.colors.grid.line, fallbackTheme.core.colors.grid.line, nextValue => (theme.core.colors.grid.line = nextValue)]
  ]

  colorChecks.forEach(([path, value, fallback, applyFallback]) => {
    if (!isValidCssColor(value)) {
      issues.push({
        path,
        severity: 'warning',
        message: `Invalid CSS color '${value}', fallback applied.`,
        fallbackApplied: true
      })
      applyFallback(fallback)
    }
  })

  const lengthChecks: Array<[string, string, string, (nextValue: string) => void]> = [
    ['core.radius.sm', theme.core.radius.sm, fallbackTheme.core.radius.sm, nextValue => (theme.core.radius.sm = nextValue)],
    ['core.radius.md', theme.core.radius.md, fallbackTheme.core.radius.md, nextValue => (theme.core.radius.md = nextValue)],
    ['core.radius.lg', theme.core.radius.lg, fallbackTheme.core.radius.lg, nextValue => (theme.core.radius.lg = nextValue)],
    ['core.border.width', theme.core.border.width, fallbackTheme.core.border.width, nextValue => (theme.core.border.width = nextValue)],
    ['layout.app.minWidth', theme.layout.app.minWidth, fallbackTheme.layout.app.minWidth, nextValue => (theme.layout.app.minWidth = nextValue)],
    ['layout.app.maxContentWidth', theme.layout.app.maxContentWidth, fallbackTheme.layout.app.maxContentWidth, nextValue => (theme.layout.app.maxContentWidth = nextValue)],
    ['layout.app.pagePaddingX', theme.layout.app.pagePaddingX, fallbackTheme.layout.app.pagePaddingX, nextValue => (theme.layout.app.pagePaddingX = nextValue)],
    ['layout.app.pagePaddingY', theme.layout.app.pagePaddingY, fallbackTheme.layout.app.pagePaddingY, nextValue => (theme.layout.app.pagePaddingY = nextValue)],
    ['layout.app.sectionGap', theme.layout.app.sectionGap, fallbackTheme.layout.app.sectionGap, nextValue => (theme.layout.app.sectionGap = nextValue)],
    ['layout.app.cardGap', theme.layout.app.cardGap, fallbackTheme.layout.app.cardGap, nextValue => (theme.layout.app.cardGap = nextValue)],
    ['layout.shell.railWidth', theme.layout.shell.railWidth, fallbackTheme.layout.shell.railWidth, nextValue => (theme.layout.shell.railWidth = nextValue)],
    ['layout.shell.sidebarWidth', theme.layout.shell.sidebarWidth, fallbackTheme.layout.shell.sidebarWidth, nextValue => (theme.layout.shell.sidebarWidth = nextValue)],
    ['layout.shell.dock.minHeight', theme.layout.shell.dock.minHeight, fallbackTheme.layout.shell.dock.minHeight, nextValue => (theme.layout.shell.dock.minHeight = nextValue)],
    ['layout.shell.dock.defaultHeight', theme.layout.shell.dock.defaultHeight, fallbackTheme.layout.shell.dock.defaultHeight, nextValue => (theme.layout.shell.dock.defaultHeight = nextValue)],
    ['layout.shell.dock.maxHeight', theme.layout.shell.dock.maxHeight, fallbackTheme.layout.shell.dock.maxHeight, nextValue => (theme.layout.shell.dock.maxHeight = nextValue)],
    ['components.panel.backdropBlur', theme.components.panel.backdropBlur, fallbackTheme.components.panel.backdropBlur, nextValue => (theme.components.panel.backdropBlur = nextValue)]
  ]

  lengthChecks.forEach(([path, value, fallback, applyFallback]) => {
    if (!isValidCssLength(value)) {
      issues.push({
        path,
        severity: 'warning',
        message: `Invalid CSS length '${value}', fallback applied.`,
        fallbackApplied: true
      })
      applyFallback(fallback)
    }
  })

  return issues
}
