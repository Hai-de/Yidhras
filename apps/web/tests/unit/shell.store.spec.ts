import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

import { useShellStore } from '../../stores/shell';

function expectDefined<T>(value: T): asserts value is NonNullable<T> {
  expect(value).toBeDefined();
}

describe('useShellStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe('initial state', () => {
    it('starts with overview workspace', () => {
      const shell = useShellStore();
      expect(shell.activeWorkspaceId).toBe('overview');
    });

    it('starts with jobs dock tab', () => {
      const shell = useShellStore();
      expect(shell.activeDockTabId).toBe('jobs');
    });

    it('starts with dock collapsed', () => {
      const shell = useShellStore();
      expect(shell.isDockExpanded).toBe(false);
    });

    it('starts with empty recent targets', () => {
      const shell = useShellStore();
      expect(shell.recentTargets).toEqual([]);
    });

    it('starts with default dock height', () => {
      const shell = useShellStore();
      expect(shell.dockHeight).toBe(224);
    });
  });

  describe('setActiveWorkspace', () => {
    it('changes active workspace', () => {
      const shell = useShellStore();
      shell.setActiveWorkspace('scheduler');
      expect(shell.activeWorkspaceId).toBe('scheduler');
    });
  });

  describe('setActiveDockTab', () => {
    it('changes active dock tab', () => {
      const shell = useShellStore();
      shell.setActiveDockTab('traces');
      expect(shell.activeDockTabId).toBe('traces');
    });
  });

  describe('setDockExpanded', () => {
    it('sets dock expanded state', () => {
      const shell = useShellStore();
      shell.setDockExpanded(true);
      expect(shell.isDockExpanded).toBe(true);
      shell.setDockExpanded(false);
      expect(shell.isDockExpanded).toBe(false);
    });
  });

  describe('toggleDockExpanded', () => {
    it('toggles dock expanded state', () => {
      const shell = useShellStore();
      expect(shell.isDockExpanded).toBe(false);
      shell.toggleDockExpanded();
      expect(shell.isDockExpanded).toBe(true);
      shell.toggleDockExpanded();
      expect(shell.isDockExpanded).toBe(false);
    });
  });

  describe('setDockHeight', () => {
    it('sets dock height', () => {
      const shell = useShellStore();
      shell.setDockHeight(400);
      expect(shell.dockHeight).toBe(400);
    });

    it('enforces minimum dock height', () => {
      const shell = useShellStore();
      shell.setDockHeight(100);
      expect(shell.dockHeight).toBe(160);
    });
  });

  describe('recordRecentTarget', () => {
    const makeTarget = (id: string, label = `Label ${id}`) => ({
      id,
      label,
      meta: 'meta',
      workspaceId: 'overview' as const,
      routePath: `/target/${id}`
    });

    it('adds target to recent list', () => {
      const shell = useShellStore();
      shell.recordRecentTarget(makeTarget('t1'));
      expect(shell.recentTargets).toHaveLength(1);
      expectDefined(shell.recentTargets[0]);
      expect(shell.recentTargets[0].id).toBe('t1');
    });

    it('deduplicates targets by id', () => {
      const shell = useShellStore();
      shell.recordRecentTarget(makeTarget('t1', 'First'));
      shell.recordRecentTarget(makeTarget('t2'));
      shell.recordRecentTarget(makeTarget('t1', 'Updated'));
      expect(shell.recentTargets).toHaveLength(2);
      expectDefined(shell.recentTargets[0]);
      expect(shell.recentTargets[0].id).toBe('t1');
      expect(shell.recentTargets[0].label).toBe('Updated');
    });

    it('caps at 8 targets', () => {
      const shell = useShellStore();
      for (let i = 0; i < 10; i++) {
        shell.recordRecentTarget(makeTarget(`t${i}`));
      }
      expect(shell.recentTargets).toHaveLength(8);
      expectDefined(shell.recentTargets[0]);
      expectDefined(shell.recentTargets[7]);
      expect(shell.recentTargets[0].id).toBe('t9');
      expect(shell.recentTargets[7].id).toBe('t2');
    });
  });
});
