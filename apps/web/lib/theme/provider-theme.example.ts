import type { RuntimeWorldMetadata } from '../../composables/api/useSystemApi'
import type { WorldPackThemeConfig } from './tokens'

/**
 * Provider-owned theme payload example.
 *
 * Recommended usage:
 * - world-pack providers should place their custom theme under `presentation.theme`
 * - only provide the tokens you want to override
 * - platform will merge with DEFAULT_APP_THEME and only apply validate/clamp/fallback when necessary
 */
export const EXAMPLE_PROVIDER_THEME: WorldPackThemeConfig = {
  meta: {
    id: 'pack-example-theme',
    name: 'Pack Example Theme',
    colorScheme: 'dark'
  },
  core: {
    colors: {
      bg: {
        app: '#0f1115',
        panel: '#171a21',
        elevated: '#1d2330',
        overlay: 'rgba(7, 10, 14, 0.78)'
      },
      border: {
        strong: '#465267',
        muted: '#2f3745'
      },
      text: {
        primary: '#f3f4f6',
        secondary: '#cbd5e1',
        muted: '#8b9bb0',
        inverse: '#0b1020'
      },
      state: {
        success: '#4ade80',
        warning: '#fbbf24',
        danger: '#fb7185',
        info: '#38bdf8',
        accent: '#c084fc'
      },
      graph: {
        agent: '#c084fc',
        atmosphere: '#22d3ee',
        relay: '#f59e0b',
        container: '#94a3b8',
        edge: '#475569',
        selected: '#38bdf8'
      },
      grid: {
        line: 'rgba(192, 132, 252, 0.12)'
      }
    },
    typography: {
      fontSans: "'Inter', system-ui, sans-serif",
      fontMono: "'IBM Plex Mono', 'JetBrains Mono', monospace"
    },
    radius: {
      sm: '2px',
      md: '6px',
      lg: '10px'
    },
    border: {
      width: '1px'
    },
    shadow: {
      panel: 'inset 0 1px 0 rgba(255, 255, 255, 0.03)',
      elevated: '0 0 0 1px rgba(69, 82, 103, 0.32), 0 12px 28px rgba(0, 0, 0, 0.24)'
    }
  },
  layout: {
    app: {
      pagePaddingX: '24px',
      pagePaddingY: '20px',
      sectionGap: '14px',
      cardGap: '14px'
    },
    shell: {
      railWidth: '72px',
      sidebarWidth: '344px',
      dock: {
        minHeight: '160px',
        defaultHeight: '240px',
        maxHeight: '520px'
      }
    }
  },
  components: {
    panel: {
      backdropBlur: '12px'
    }
  }
}

export const EXAMPLE_PROVIDER_WORLD_PACK: RuntimeWorldMetadata = {
  id: 'pack-example',
  name: 'Pack Example',
  version: '1.0.0',
  description: 'Example runtime world metadata carrying a provider-owned theme payload.',
  presentation: {
    theme: EXAMPLE_PROVIDER_THEME
  }
}
