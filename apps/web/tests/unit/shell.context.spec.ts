import { describe, expect, it } from 'vitest'

import {
  buildShellQuickActions,
  resolveShellFocusLabel,
  resolveShellFocusMeta
} from '../../features/shell/composables/useShellContext'

describe('shell context helpers', () => {
  it('resolves focus labels for key workspaces', () => {
    expect(resolveShellFocusLabel('/packs/test-pack/workflow')).toBe('Current focus: workflow records')
    expect(resolveShellFocusLabel('/packs/test-pack/scheduler')).toBe('Current focus: scheduler operations')
    expect(resolveShellFocusLabel('/packs/test-pack/graph')).toBe('Current focus: graph projection')
    expect(resolveShellFocusLabel('/packs/test-pack/social')).toBe('Current focus: public signal stream')
    expect(resolveShellFocusLabel('/packs/test-pack/timeline')).toBe('Current focus: narrative event stream')
    expect(resolveShellFocusLabel('/packs/test-pack/agents/agent-1')).toBe('Current focus: agent projection')
    expect(resolveShellFocusLabel('/packs/test-pack/overview')).toBe('Current focus: operator overview')
  })

  it('resolves focus meta from route path and query-like path', () => {
    expect(resolveShellFocusMeta('/packs/test-pack/workflow', 'job_id=job-1')).toBe('Focused from workflow job selection.')
    expect(resolveShellFocusMeta('/packs/test-pack/workflow', 'trace_id=trace-1')).toBe('Focused from workflow trace selection.')
    expect(resolveShellFocusMeta('/packs/test-pack/scheduler', 'run_id=run-1')).toBe('Scheduler workspace is focused on a specific run.')
    expect(resolveShellFocusMeta('/packs/test-pack/scheduler', 'decision_id=decision-1')).toBe(
      'Scheduler workspace is focused on a specific decision.'
    )
    expect(resolveShellFocusMeta('/packs/test-pack/graph', 'root_id=node-1')).toBe('Graph root is pinned via route state.')
    expect(resolveShellFocusMeta('/packs/test-pack/social', 'post_id=post-1')).toBe('A social post is currently selected.')
    expect(resolveShellFocusMeta('/packs/test-pack/timeline', 'event_id=event-1')).toBe('A timeline event is currently selected.')
    expect(resolveShellFocusMeta('/packs/test-pack/agents/agent-1', '')).toBe('Agent detail route is active.')
  })

  it('builds quick actions based on workspace and source availability', () => {
    expect(
      buildShellQuickActions({
        activeWorkspaceId: 'overview',
        hasSource: false
      })
    ).toEqual([
      {
        id: 'go_overview',
        label: 'Go to overview',
        enabled: false
      },
      {
        id: 'return_to_source',
        label: 'Return to source',
        enabled: false
      },
      {
        id: 'open_notifications',
        label: 'Open notifications dock',
        enabled: true
      }
    ])

    expect(
      buildShellQuickActions({
        activeWorkspaceId: 'scheduler',
        hasSource: true
      })
    ).toEqual([
      {
        id: 'go_overview',
        label: 'Go to overview',
        enabled: true
      },
      {
        id: 'return_to_source',
        label: 'Return to source',
        enabled: true
      },
      {
        id: 'open_notifications',
        label: 'Open notifications dock',
        enabled: true
      }
    ])
  })
})
