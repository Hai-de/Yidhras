import type { AppThemeDefinition } from './tokens'

export const DEFAULT_APP_THEME: AppThemeDefinition = {
  meta: {
    id: 'operator-intel-default',
    name: 'Operator Intel Default',
    colorScheme: 'dark'
  },
  core: {
    colors: {
      bg: {
        app: '#111418',
        panel: '#181c22',
        elevated: '#20252d',
        overlay: 'rgba(11, 14, 18, 0.82)'
      },
      border: {
        strong: '#3b4350',
        muted: '#2a313c'
      },
      text: {
        primary: '#e6edf3',
        secondary: '#a9b4c2',
        muted: '#7d8897',
        inverse: '#0b0f14'
      },
      state: {
        success: '#35d07f',
        warning: '#f1c453',
        danger: '#ff6e7c',
        info: '#57b8ff',
        accent: '#6ea8fe'
      },
      graph: {
        agent: '#6ea8fe',
        atmosphere: '#3cc4aa',
        relay: '#f1c453',
        container: '#8a93a3',
        edge: '#394252',
        selected: '#57b8ff'
      },
      grid: {
        line: 'rgba(110, 168, 254, 0.1)'
      }
    },
    typography: {
      fontSans: "'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      fontMono: "'IBM Plex Mono', 'JetBrains Mono', 'Fira Code', ui-monospace, monospace"
    },
    radius: {
      sm: '2px',
      md: '4px',
      lg: '6px'
    },
    border: {
      width: '1px'
    },
    shadow: {
      panel: 'inset 0 1px 0 rgba(255, 255, 255, 0.02)',
      elevated: '0 0 0 1px rgba(59, 67, 80, 0.4), 0 8px 24px rgba(0, 0, 0, 0.2)'
    }
  },
  layout: {
    app: {
      minWidth: '1280px',
      maxContentWidth: '1920px',
      pagePaddingX: '20px',
      pagePaddingY: '20px',
      sectionGap: '12px',
      cardGap: '12px'
    },
    shell: {
      railWidth: '76px',
      sidebarWidth: '300px',
      dock: {
        minHeight: '160px',
        defaultHeight: '224px',
        maxHeight: '480px'
      }
    }
  },
  components: {
    panel: {
      backdropBlur: '10px'
    }
  }
}
