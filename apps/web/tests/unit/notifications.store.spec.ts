import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

import { useNotificationsStore } from '../../stores/notifications';
import type { SystemNotificationSnapshot } from '../../composables/api/useSystemApi';

function expectDefined<T>(value: T): asserts value is NonNullable<T> {
  expect(value).toBeDefined();
}

const makeNotification = (overrides: Partial<SystemNotificationSnapshot> = {}): SystemNotificationSnapshot => ({
  id: 'notif-1',
  level: 'info',
  content: 'Test notification',
  timestamp: '1000',
  ...overrides
});

describe('useNotificationsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe('initial state', () => {
    it('starts with empty items', () => {
      const store = useNotificationsStore();
      expect(store.items).toEqual([]);
      expect(store.unreadCount).toBe(0);
      expect(store.isFetching).toBe(false);
      expect(store.lastSyncedAt).toBeNull();
      expect(store.lastError).toBeNull();
    });
  });

  describe('replaceItems', () => {
    it('replaces remote items and updates lastSyncedAt', () => {
      const store = useNotificationsStore();
      const items = [makeNotification({ id: 'n1' }), makeNotification({ id: 'n2', level: 'warning' })];
      store.replaceItems(items);
      expect(store.remoteItems).toHaveLength(2);
      expect(store.lastSyncedAt).toBeGreaterThan(0);
    });
  });

  describe('pushLocalItem', () => {
    it('adds local notification to front of list', () => {
      const store = useNotificationsStore();
      store.pushLocalItem({ content: 'Local alert', level: 'error' });
      expect(store.localItems).toHaveLength(1);
      expectDefined(store.localItems[0]);
      expect(store.localItems[0].content).toBe('Local alert');
      expect(store.localItems[0].level).toBe('error');
    });

    it('caps local items at 20', () => {
      const store = useNotificationsStore();
      for (let i = 0; i < 25; i++) {
        store.pushLocalItem({ content: `Item ${i}`, level: 'info' });
      }
      expect(store.localItems).toHaveLength(20);
      expectDefined(store.localItems[0]);
      expect(store.localItems[0].content).toBe('Item 24');
    });
  });

  describe('getters', () => {
    it('items combines local and remote', () => {
      const store = useNotificationsStore();
      store.replaceItems([makeNotification({ id: 'remote' })]);
      store.pushLocalItem({ content: 'local', level: 'info' });
      expect(store.items).toHaveLength(2);
    });

    it('latestItems returns first 50 (max)', () => {
      const store = useNotificationsStore();
      for (let i = 0; i < 10; i++) {
        store.replaceItems([...store.remoteItems, makeNotification({ id: `n${i}` })]);
      }
      expect(store.latestItems).toHaveLength(10);
    });

    it('hasErrors returns true when error items exist', () => {
      const store = useNotificationsStore();
      expect(store.hasErrors).toBe(false);
      store.pushLocalItem({ content: 'err', level: 'error' });
      expect(store.hasErrors).toBe(true);
    });

    it('errorCount counts errors', () => {
      const store = useNotificationsStore();
      store.pushLocalItem({ content: 'e1', level: 'error' });
      store.pushLocalItem({ content: 'e2', level: 'error' });
      store.pushLocalItem({ content: 'w1', level: 'warning' });
      expect(store.errorCount).toBe(2);
    });

    it('warningCount counts warnings', () => {
      const store = useNotificationsStore();
      store.pushLocalItem({ content: 'w1', level: 'warning' });
      store.pushLocalItem({ content: 'i1', level: 'info' });
      expect(store.warningCount).toBe(1);
    });

    it('latestError returns first error', () => {
      const store = useNotificationsStore();
      store.pushLocalItem({ content: 'info', level: 'info' });
      store.pushLocalItem({ content: 'the error', level: 'error' });
      expect(store.latestError?.content).toBe('the error');
    });

    it('latestWarnings returns first 3 warnings', () => {
      const store = useNotificationsStore();
      for (let i = 0; i < 5; i++) {
        store.pushLocalItem({ content: `w${i}`, level: 'warning' });
      }
      expect(store.latestWarnings).toHaveLength(3);
    });
  });

  describe('clear actions', () => {
    it('clearLocalItems clears only local', () => {
      const store = useNotificationsStore();
      store.replaceItems([makeNotification({ id: 'remote' })]);
      store.pushLocalItem({ content: 'local', level: 'info' });
      store.clearLocalItems();
      expect(store.localItems).toEqual([]);
      expect(store.remoteItems).toHaveLength(1);
    });

    it('clearAllItems clears both', () => {
      const store = useNotificationsStore();
      store.replaceItems([makeNotification({ id: 'remote' })]);
      store.pushLocalItem({ content: 'local', level: 'info' });
      store.clearAllItems();
      expect(store.items).toEqual([]);
    });
  });
});
