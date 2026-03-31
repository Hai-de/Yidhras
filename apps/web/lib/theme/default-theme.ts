import type { AppThemeTokens } from './tokens'

export const DEFAULT_APP_THEME_TOKENS: AppThemeTokens = {
  meta: {
    id: 'operator-intel-default',
    name: 'Operator Intel Default',
    colorScheme: 'dark'
  },
  colors: {
    bgApp: '#0d0f14',
    bgPanel: '#151b24',
    bgElevated: '#1c2430',
    bgOverlay: 'rgba(9, 12, 18, 0.82)',
    borderStrong: '#3a4658',
    borderMuted: '#273140',
    textPrimary: '#eef4ff',
    textSecondary: '#adb9cf',
    textMuted: '#728099',
    textInverse: '#06080d',
    stateSuccess: '#35d07f',
    stateWarning: '#f1c453',
    stateDanger: '#ff6e7c',
    stateInfo: '#57b8ff',
    stateAccent: '#7e8fff'
  },
  graph: {
    agent: '#7e8fff',
    atmosphere: '#3cc4aa',
    relay: '#f1c453',
    container: '#7a7f8d',
    edge: '#334155',
    selected: '#57b8ff'
  },
  grid: {
    lineColor: 'rgba(118, 139, 177, 0.14)'
  },
  typography: {
    fontSans: "'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontMono: "'IBM Plex Mono', 'JetBrains Mono', 'Fira Code', ui-monospace, monospace"
  },
  radius: {
    sm: '4px',
    md: '8px',
    lg: '12px'
  },
  border: {
    width: '1px'
  },
  shadow: {
    panel: '0 0 0 1px rgba(58, 70, 88, 0.55), 0 18px 40px rgba(0, 0, 0, 0.24)',
    elevated: '0 0 0 1px rgba(58, 70, 88, 0.65), 0 24px 56px rgba(0, 0, 0, 0.32)'
  },
  layout: {
    minWidth: '1280px',
    maxContentWidth: '1920px'
  }
}
