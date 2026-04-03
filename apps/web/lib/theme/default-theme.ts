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
        app: '#1e1e1e',
        panel: '#252526',
        elevated: '#2d2d30',
        overlay: 'rgba(30, 30, 30, 0.78)'
      },
      border: {
        strong: '#383838',
        muted: '#2a2a2a'
      },
      text: {
        primary: '#cccccc',
        secondary: '#9da1a6',
        muted: '#6c737f',
        inverse: '#ffffff'
      },
      state: {
        success: '#89d185',
        warning: '#cca700',
        danger: '#f14c4c',
        info: '#4fc1ff',
        accent: '#3794ff'
      },
      graph: {
        agent: '#3794ff',
        atmosphere: '#4ec9b0',
        relay: '#d7ba7d',
        container: '#8b949e',
        edge: '#3d434a',
        selected: '#4fc1ff'
      },
      grid: {
        line: 'rgba(121, 121, 121, 0.06)'
      }
    },
    typography: {
      fontSans: "'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      fontMono: "'IBM Plex Mono', 'JetBrains Mono', 'Fira Code', ui-monospace, monospace"
    },
    radius: {
      sm: '2px',
      md: '3px',
      lg: '4px'
    },
    border: {
      width: '1px'
    },
    shadow: {
      panel: 'none',
      elevated: '0 0 0 1px rgba(255, 255, 255, 0.02), 0 8px 24px rgba(0, 0, 0, 0.14)'
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
