import { beforeEach,describe, expect, it } from 'vitest';

import {
  getMetricsRegistry,
  initMetrics,
  recordActionIntentDispatched,
  recordInferenceCompleted,
  recordPluginWorkerActivationCompleted,
  recordPluginWorkerCrash,
  recordPluginWorkerInvocationCompleted,
  recordTickCompleted,
  setPluginsActive,
  setPluginWorkersActive,
  setSidecarHealth
} from '../../../src/observability/metrics.js';

describe('observability/metrics', () => {
  describe('getMetricsRegistry', () => {
    it('returns a registry object', () => {
      const registry = getMetricsRegistry();
      expect(registry).toBeDefined();
      expect(typeof registry).toBe('object');
    });
  });

  describe('initMetrics', () => {
    it('does not throw', () => {
      expect(() => initMetrics()).not.toThrow();
    });

    it('is idempotent', () => {
      initMetrics();
      expect(() => initMetrics()).not.toThrow();
    });
  });

  describe('recordTickCompleted', () => {
    it('does not throw', () => {
      expect(() => recordTickCompleted('pack-1', 'simulation', 100, 'success')).not.toThrow();
    });

    it('handles failed status', () => {
      expect(() => recordTickCompleted('pack-1', 'simulation', 200, 'failed')).not.toThrow();
    });
  });

  describe('recordInferenceCompleted', () => {
    it('does not throw', () => {
      expect(() => recordInferenceCompleted('pack-1', 'gpt-4', 'agent_decision', 500, 'success')).not.toThrow();
    });

    it('handles failed status', () => {
      expect(() => recordInferenceCompleted('pack-1', 'gpt-4', 'agent_decision', 500, 'failed')).not.toThrow();
    });
  });

  describe('recordActionIntentDispatched', () => {
    it('does not throw for completed outcome', () => {
      expect(() => recordActionIntentDispatched('pack-1', 'speak', 'completed')).not.toThrow();
    });

    it('does not throw for dropped outcome', () => {
      expect(() => recordActionIntentDispatched('pack-1', 'speak', 'dropped')).not.toThrow();
    });

    it('does not throw for failed outcome', () => {
      expect(() => recordActionIntentDispatched('pack-1', 'speak', 'failed')).not.toThrow();
    });
  });

  describe('setPluginsActive', () => {
    it('does not throw', () => {
      expect(() => setPluginsActive('pack-1', 3)).not.toThrow();
    });

    it('handles zero count', () => {
      expect(() => setPluginsActive('pack-1', 0)).not.toThrow();
    });
  });

  describe('setPluginWorkersActive', () => {
    it('does not throw', () => {
      expect(() => setPluginWorkersActive('pack-1', 2)).not.toThrow();
    });
  });

  describe('recordPluginWorkerCrash', () => {
    it('does not throw', () => {
      expect(() => recordPluginWorkerCrash('pack-1', 'plugin-a', 'inst-1')).not.toThrow();
    });
  });

  describe('recordPluginWorkerInvocationCompleted', () => {
    it('does not throw for success', () => {
      expect(() => recordPluginWorkerInvocationCompleted('pack-1', 'plugin-a', 'inst-1', 'data_cleaner', 50, 'success')).not.toThrow();
    });

    it('does not throw for failure', () => {
      expect(() => recordPluginWorkerInvocationCompleted('pack-1', 'plugin-a', 'inst-1', 'data_cleaner', 50, 'failed')).not.toThrow();
    });
  });

  describe('recordPluginWorkerActivationCompleted', () => {
    it('does not throw for success', () => {
      expect(() => recordPluginWorkerActivationCompleted('pack-1', 'plugin-a', 'inst-1', 100, 'success')).not.toThrow();
    });

    it('does not throw for failure', () => {
      expect(() => recordPluginWorkerActivationCompleted('pack-1', 'plugin-a', 'inst-1', 100, 'failed')).not.toThrow();
    });
  });

  describe('setSidecarHealth', () => {
    it('sets healthy status', () => {
      expect(() => setSidecarHealth('scheduler-sidecar', true)).not.toThrow();
    });

    it('sets unhealthy status', () => {
      expect(() => setSidecarHealth('scheduler-sidecar', false)).not.toThrow();
    });
  });
});
