import type { Config } from 'tailwindcss'

export default {
  content: [
    './app.vue',
    './components/**/*.{vue,js,ts}',
    './composables/**/*.{js,ts}',
    './features/**/*.{vue,js,ts}',
    './layouts/**/*.vue',
    './pages/**/*.vue',
    './plugins/**/*.{js,ts}'
  ],
  theme: {
    extend: {
      colors: {
        yd: {
          app: 'var(--yd-color-bg-app)',
          panel: 'var(--yd-color-bg-panel)',
          elevated: 'var(--yd-color-bg-elevated)',
          overlay: 'var(--yd-color-bg-overlay)',
          border: {
            strong: 'var(--yd-color-border-strong)',
            muted: 'var(--yd-color-border-muted)'
          },
          text: {
            primary: 'var(--yd-color-text-primary)',
            secondary: 'var(--yd-color-text-secondary)',
            muted: 'var(--yd-color-text-muted)',
            inverse: 'var(--yd-color-text-inverse)'
          },
          state: {
            success: 'var(--yd-color-state-success)',
            warning: 'var(--yd-color-state-warning)',
            danger: 'var(--yd-color-state-danger)',
            info: 'var(--yd-color-state-info)',
            accent: 'var(--yd-color-state-accent)'
          },
          graph: {
            agent: 'var(--yd-graph-agent)',
            atmosphere: 'var(--yd-graph-atmosphere)',
            relay: 'var(--yd-graph-relay)',
            container: 'var(--yd-graph-container)',
            edge: 'var(--yd-graph-edge)',
            selected: 'var(--yd-graph-selected)'
          }
        }
      },
      fontFamily: {
        sans: ['var(--yd-font-sans)'],
        mono: ['var(--yd-font-mono)']
      },
      borderRadius: {
        sm: 'var(--yd-radius-sm)',
        md: 'var(--yd-radius-md)',
        lg: 'var(--yd-radius-lg)'
      },
      boxShadow: {
        yd: 'var(--yd-shadow-panel)',
        'yd-elevated': 'var(--yd-shadow-elevated)'
      },
      minWidth: {
        operator: 'var(--yd-layout-min-width)'
      }
    }
  }
} satisfies Config
