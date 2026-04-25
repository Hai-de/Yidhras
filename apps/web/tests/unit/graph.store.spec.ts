import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

import { useGraphStore } from '../../features/graph/store';

describe('useGraphStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe('initial state', () => {
    it('starts with isFetching false, no lastSyncedAt, autoRefreshMode manual', () => {
      const graph = useGraphStore();
      expect(graph.isFetching).toBe(false);
      expect(graph.lastSyncedAt).toBeNull();
      expect(graph.autoRefreshMode).toBe('manual');
    });
  });

  describe('setFetching', () => {
    it('transitions isFetching to true', () => {
      const graph = useGraphStore();
      graph.setFetching(true);
      expect(graph.isFetching).toBe(true);
    });

    it('transitions back to false', () => {
      const graph = useGraphStore();
      graph.setFetching(true);
      graph.setFetching(false);
      expect(graph.isFetching).toBe(false);
    });
  });

  describe('markSynced', () => {
    it('sets lastSyncedAt to current timestamp', () => {
      const graph = useGraphStore();
      const before = Date.now();
      graph.markSynced();
      expect(graph.lastSyncedAt).toBeGreaterThanOrEqual(before);
    });
  });

  describe('setAutoRefreshMode', () => {
    it('sets to visible-polling', () => {
      const graph = useGraphStore();
      graph.setAutoRefreshMode('visible-polling');
      expect(graph.autoRefreshMode).toBe('visible-polling');
    });

    it('sets back to manual', () => {
      const graph = useGraphStore();
      graph.setAutoRefreshMode('visible-polling');
      graph.setAutoRefreshMode('manual');
      expect(graph.autoRefreshMode).toBe('manual');
    });
  });
});
