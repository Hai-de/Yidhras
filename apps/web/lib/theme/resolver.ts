import {
  clampAppMinWidth,
  clampShellDockDefaultHeight,
  clampShellDockMaxHeight,
  clampShellDockMinHeight,
  clampShellRailWidth,
  clampShellSidebarWidth
} from './clamp'
import { DEFAULT_APP_THEME } from './default-theme'
import { mergeThemeSection } from './merge'
import { resolveWorldPackThemeConfig } from './source'
import type {
  AppThemeDefinition,
  ThemeSourceDescriptor,
  ThemeValidationIssue,
  WorldPackThemeConfig
} from './tokens'
import { validateResolvedTheme } from './validate'

export interface ResolvedThemeResult {
  theme: AppThemeDefinition
  issues: ThemeValidationIssue[]
  source: ThemeSourceDescriptor
}

const DEFAULT_THEME_SOURCE: ThemeSourceDescriptor = {
  kind: 'default',
  worldPackId: null,
  path: null,
  label: 'platform default theme'
}

const maybePushClampIssue = (
  issues: ThemeValidationIssue[],
  path: string,
  previousValue: string,
  nextValue: string
) => {
  if (previousValue === nextValue) {
    return
  }

  issues.push({
    path,
    severity: 'warning',
    message: `Invalid or out-of-range value '${previousValue}'; fallback/clamp applied.`,
    fallbackApplied: true
  })
}

export const resolveTheme = (worldPackTheme?: WorldPackThemeConfig): AppThemeDefinition => {
  return resolveThemeWithDiagnostics(worldPackTheme).theme
}

export const resolveThemeWithDiagnostics = (
  worldPackTheme?: WorldPackThemeConfig,
  options?: {
    worldPackId?: string | null
    worldPack?: import('../../composables/api/useSystemApi').RuntimeWorldMetadata | null
  }
): ResolvedThemeResult => {
  const baseTheme = structuredClone(DEFAULT_APP_THEME)
  const runtimeWorldPackTheme = resolveWorldPackThemeConfig(options?.worldPackId, options?.worldPack ?? null)
  const effectiveWorldPackTheme = worldPackTheme ?? runtimeWorldPackTheme?.config
  const source: ThemeSourceDescriptor = worldPackTheme
    ? {
        kind: 'explicit-override',
        worldPackId: options?.worldPackId ?? options?.worldPack?.id ?? null,
        path: 'explicit-override',
        label: 'explicit theme override'
      }
    : runtimeWorldPackTheme?.source ?? DEFAULT_THEME_SOURCE

  if (!effectiveWorldPackTheme) {
    return {
      theme: baseTheme,
      issues: [],
      source
    }
  }

  const mergedTheme: AppThemeDefinition = {
    meta: {
      ...baseTheme.meta,
      ...effectiveWorldPackTheme.meta
    },
    core: mergeThemeSection(baseTheme.core, effectiveWorldPackTheme.core),
    layout: mergeThemeSection(baseTheme.layout, effectiveWorldPackTheme.layout),
    components: mergeThemeSection(baseTheme.components, effectiveWorldPackTheme.components)
  }

  const issues = validateResolvedTheme(mergedTheme, baseTheme)

  const nextMinWidth = clampAppMinWidth(mergedTheme.layout.app.minWidth, baseTheme.layout.app.minWidth)
  maybePushClampIssue(issues, 'layout.app.minWidth', mergedTheme.layout.app.minWidth, nextMinWidth)
  mergedTheme.layout.app.minWidth = nextMinWidth

  const nextRailWidth = clampShellRailWidth(mergedTheme.layout.shell.railWidth, baseTheme.layout.shell.railWidth)
  maybePushClampIssue(issues, 'layout.shell.railWidth', mergedTheme.layout.shell.railWidth, nextRailWidth)
  mergedTheme.layout.shell.railWidth = nextRailWidth

  const nextSidebarWidth = clampShellSidebarWidth(
    mergedTheme.layout.shell.sidebarWidth,
    baseTheme.layout.shell.sidebarWidth
  )
  maybePushClampIssue(issues, 'layout.shell.sidebarWidth', mergedTheme.layout.shell.sidebarWidth, nextSidebarWidth)
  mergedTheme.layout.shell.sidebarWidth = nextSidebarWidth

  const nextDockMinHeight = clampShellDockMinHeight(
    mergedTheme.layout.shell.dock.minHeight,
    baseTheme.layout.shell.dock.minHeight
  )
  maybePushClampIssue(issues, 'layout.shell.dock.minHeight', mergedTheme.layout.shell.dock.minHeight, nextDockMinHeight)
  mergedTheme.layout.shell.dock.minHeight = nextDockMinHeight

  const nextDockDefaultHeight = clampShellDockDefaultHeight(
    mergedTheme.layout.shell.dock.defaultHeight,
    baseTheme.layout.shell.dock.defaultHeight
  )
  maybePushClampIssue(
    issues,
    'layout.shell.dock.defaultHeight',
    mergedTheme.layout.shell.dock.defaultHeight,
    nextDockDefaultHeight
  )
  mergedTheme.layout.shell.dock.defaultHeight = nextDockDefaultHeight

  const nextDockMaxHeight = clampShellDockMaxHeight(
    mergedTheme.layout.shell.dock.maxHeight,
    baseTheme.layout.shell.dock.maxHeight
  )
  maybePushClampIssue(issues, 'layout.shell.dock.maxHeight', mergedTheme.layout.shell.dock.maxHeight, nextDockMaxHeight)
  mergedTheme.layout.shell.dock.maxHeight = nextDockMaxHeight

  return {
    theme: mergedTheme,
    issues,
    source
  }
}
