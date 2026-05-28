import { describe, expect, it } from 'vitest'

import { DEFAULT_APP_THEME } from '../../lib/theme/default-theme'
import { mergeThemeSection } from '../../lib/theme/merge'
import { resolveThemeWithDiagnostics } from '../../lib/theme/resolver'
import {
  clearRegisteredWorldPackThemeConfig,
  registerWorldPackThemeConfig
} from '../../lib/theme/source'

describe('theme resolver pipeline', () => {
  it('deep merges partial world pack overrides into theme sections', () => {
    const merged = mergeThemeSection(DEFAULT_APP_THEME.core, {
      colors: {
        bg: {
          app: '#101010'
        },
        state: {
          accent: '#abcdef'
        }
      }
    })

    expect(merged.colors.bg.app).toBe('#101010')
    expect(merged.colors.bg.panel).toBe(DEFAULT_APP_THEME.core.colors.bg.panel)
    expect(merged.colors.state.accent).toBe('#abcdef')
  })

  it('falls back invalid color and invalid length overrides while reporting diagnostics', () => {
    const result = resolveThemeWithDiagnostics({
      meta: {
        colorScheme: 'dark'
      },
      core: {
        colors: {
          bg: {
            app: ''
          }
        },
        radius: {
          sm: ''
        }
      },
      components: {
        panel: {
          backdropBlur: ''
        }
      }
    })

    expect(result.theme.core.colors.bg.app).toBe(DEFAULT_APP_THEME.core.colors.bg.app)
    expect(result.theme.core.radius.sm).toBe(DEFAULT_APP_THEME.core.radius.sm)
    expect(result.theme.components.panel.backdropBlur).toBe(DEFAULT_APP_THEME.components.panel.backdropBlur)
    expect(result.source.kind).toBe('explicit-override')
    expect(result.issues.map(issue => issue.path)).toEqual([
      'core.colors.bg.app',
      'core.radius.sm',
      'components.panel.backdropBlur'
    ])
  })

  it('clamps out-of-range layout values and records warnings', () => {
    const result = resolveThemeWithDiagnostics({
      layout: {
        app: {
          minWidth: '320px'
        },
        shell: {
          railWidth: '20px',
          sidebarWidth: '999px',
          dock: {
            minHeight: '80px',
            defaultHeight: '999px',
            maxHeight: '9999px'
          }
        }
      }
    })

    expect(result.theme.layout.app.minWidth).toBe('960px')
    expect(result.theme.layout.shell.railWidth).toBe('56px')
    expect(result.theme.layout.shell.sidebarWidth).toBe('480px')
    expect(result.theme.layout.shell.dock.minHeight).toBe('120px')
    expect(result.theme.layout.shell.dock.defaultHeight).toBe('480px')
    expect(result.theme.layout.shell.dock.maxHeight).toBe('720px')
    expect(result.source.kind).toBe('explicit-override')
    expect(result.issues.map(issue => issue.path)).toEqual([
      'layout.app.minWidth',
      'layout.shell.railWidth',
      'layout.shell.sidebarWidth',
      'layout.shell.dock.minHeight',
      'layout.shell.dock.defaultHeight',
      'layout.shell.dock.maxHeight'
    ])
  })

  it('resolves theme from registered world pack config by worldPackId', () => {
    registerWorldPackThemeConfig('pack-alpha', {
      core: {
        colors: {
          state: {
            accent: '#22c55e'
          }
        }
      },
      layout: {
        shell: {
          sidebarWidth: '360px'
        }
      }
    })

    const result = resolveThemeWithDiagnostics(undefined, {
      worldPackId: 'pack-alpha',
      worldPack: {
        id: 'pack-alpha',
        name: 'Pack Alpha',
        version: '1.0.0'
      }
    })

    expect(result.theme.core.colors.state.accent).toBe('#22c55e')
    expect(result.theme.layout.shell.sidebarWidth).toBe('360px')
    expect(result.source.kind).toBe('registry')
    expect(result.source.worldPackId).toBe('pack-alpha')
    expect(result.issues).toEqual([])

    clearRegisteredWorldPackThemeConfig('pack-alpha')
  })

  it('resolves provider-owned theme only from presentation.theme', () => {
    const result = resolveThemeWithDiagnostics(undefined, {
      worldPackId: 'pack-provider',
      worldPack: {
        id: 'pack-provider',
        name: 'Pack Provider',
        version: '1.0.0',
        presentation: {
          theme: {
            core: {
              colors: {
                state: {
                  accent: '#22c55e'
                }
              }
            },
            layout: {
              shell: {
                sidebarWidth: '344px'
              }
            }
          }
        }
      }
    })

    expect(result.theme.core.colors.state.accent).toBe('#22c55e')
    expect(result.theme.layout.shell.sidebarWidth).toBe('344px')
    expect(result.source.kind).toBe('provider-metadata')
    expect(result.source.path).toBe('presentation.theme')
    expect(result.issues).toEqual([])
  })

  it('falls back to platform default theme when no provider or registry theme exists', () => {
    const result = resolveThemeWithDiagnostics(undefined, {
      worldPackId: 'pack-default',
      worldPack: {
        id: 'pack-default',
        name: 'Pack Default',
        version: '1.0.0'
      }
    })

    expect(result.theme).toEqual(DEFAULT_APP_THEME)
    expect(result.source.kind).toBe('default')
    expect(result.issues).toEqual([])
  })
})
