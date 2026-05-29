import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

import { useAuthStore } from '../../stores/auth';

describe('useAuthStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe('initial state', () => {
    it('starts unauthenticated when no persisted token', () => {
      const auth = useAuthStore();
      // In node environment, readPersistedToken returns null
      expect(auth.token).toBeNull();
      expect(auth.isAuthenticated).toBe(false);
    });
  });

  describe('setToken', () => {
    it('sets token and marks as authenticated', () => {
      const auth = useAuthStore();
      auth.setToken('my-token', true);
      expect(auth.token).toBe('my-token');
      expect(auth.isAuthenticated).toBe(true);
    });

    it('supports remember=false without error', () => {
      const auth = useAuthStore();
      // persistToken is a no-op when window is undefined (node env)
      expect(() => auth.setToken('my-token', false)).not.toThrow();
      expect(auth.token).toBe('my-token');
    });
  });

  describe('clearToken', () => {
    it('clears token and authentication state', () => {
      const auth = useAuthStore();
      auth.setToken('my-token', true);
      expect(auth.isAuthenticated).toBe(true);
      auth.clearToken();
      expect(auth.token).toBeNull();
      expect(auth.isAuthenticated).toBe(false);
    });

    it('can be called on already-unauthenticated store', () => {
      const auth = useAuthStore();
      expect(auth.isAuthenticated).toBe(false);
      expect(() => auth.clearToken()).not.toThrow();
      expect(auth.token).toBeNull();
    });
  });
});
