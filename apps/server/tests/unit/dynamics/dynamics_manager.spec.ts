import { describe, expect, it } from 'vitest';

import { ValueDynamicsManager } from '../../../src/dynamics/manager.js';
import type { NodeValueState } from '../../../src/dynamics/types.js';
import { ValueChangeReason } from '../../../src/dynamics/types.js';

describe('dynamics/dynamics_manager', () => {
  describe('constructor', () => {
    it('should initialize with empty states by default', () => {
      const manager = new ValueDynamicsManager();
      expect(manager.getAllStates()).toHaveLength(0);
    });

    it('should initialize with provided states', () => {
      const initial: NodeValueState[] = [
        { node_id: 'n1', snr: 0.7, is_pinned: false, last_updated_tick: 10n }
      ];
      const manager = new ValueDynamicsManager(initial);
      expect(manager.getAllStates()).toHaveLength(1);
      expect(manager.getAllStates()[0]!.node_id).toBe('n1');
    });
  });

  describe('getOrCreateState', () => {
    it('should create a new state with default snr=0.5', () => {
      const manager = new ValueDynamicsManager();
      const state = manager.getOrCreateState('node-1', 100n);
      expect(state.node_id).toBe('node-1');
      expect(state.snr).toBe(0.5);
      expect(state.is_pinned).toBe(false);
      expect(state.last_updated_tick).toBe(100n);
    });

    it('should return existing state if already created', () => {
      const initial: NodeValueState[] = [
        { node_id: 'n1', snr: 0.8, is_pinned: true, last_updated_tick: 50n }
      ];
      const manager = new ValueDynamicsManager(initial);
      const state = manager.getOrCreateState('n1', 100n);
      expect(state.snr).toBe(0.8);
      expect(state.is_pinned).toBe(true);
      expect(state.last_updated_tick).toBe(50n);
    });
  });

  describe('setPin', () => {
    it('should pin a node', () => {
      const manager = new ValueDynamicsManager();
      manager.getOrCreateState('n1', 10n);
      manager.setPin('n1', true);
      const states = manager.getAllStates();
      expect(states[0]!.is_pinned).toBe(true);
    });

    it('should unpin a node', () => {
      const manager = new ValueDynamicsManager([
        { node_id: 'n1', snr: 0.5, is_pinned: true, last_updated_tick: 10n }
      ]);
      manager.setPin('n1', false);
      expect(manager.getAllStates()[0]!.is_pinned).toBe(false);
    });

    it('should be a no-op for non-existent node', () => {
      const manager = new ValueDynamicsManager();
      expect(() => manager.setPin('missing', true)).not.toThrow();
    });
  });

  describe('applyChange', () => {
    it('should apply linear delta by default', () => {
      const manager = new ValueDynamicsManager();
      const result = manager.applyChange('n1', 0.2, ValueChangeReason.POST_ENGAGEMENT, 10n);
      expect(result.old_snr).toBe(0.5);
      expect(result.new_snr).toBeCloseTo(0.7);
      expect(result.delta).toBeCloseTo(0.2);
      expect(result.reason).toBe(ValueChangeReason.POST_ENGAGEMENT);
    });

    it('should clamp snr to [0.0, 1.0] upper bound', () => {
      const manager = new ValueDynamicsManager();
      manager.applyChange('n1', 0.3, ValueChangeReason.POST_ENGAGEMENT, 10n); // 0.5 → 0.8
      const result = manager.applyChange('n1', 0.5, ValueChangeReason.POST_ENGAGEMENT, 11n); // 0.8+0.5=1.3 → 1.0
      expect(result.new_snr).toBe(1.0);
    });

    it('should clamp snr to [0.0, 1.0] lower bound', () => {
      const manager = new ValueDynamicsManager();
      const result = manager.applyChange('n1', -1.0, ValueChangeReason.FAKE_NEWS_DETECTED, 10n);
      expect(result.new_snr).toBe(0.0);
    });

    it('should block depreciation for pinned node', () => {
      const manager = new ValueDynamicsManager([
        { node_id: 'n1', snr: 0.7, is_pinned: true, last_updated_tick: 10n }
      ]);
      const result = manager.applyChange('n1', -0.3, ValueChangeReason.NOISE_FLAGGED, 11n);
      expect(result.old_snr).toBe(0.7);
      expect(result.new_snr).toBe(0.7);
      expect(result.delta).toBe(0);
    });

    it('should allow appreciation for pinned node', () => {
      const manager = new ValueDynamicsManager([
        { node_id: 'n1', snr: 0.7, is_pinned: true, last_updated_tick: 10n }
      ]);
      const result = manager.applyChange('n1', 0.2, ValueChangeReason.POST_ENGAGEMENT, 11n);
      expect(result.new_snr).toBeCloseTo(0.9);
    });

    it('should update last_updated_tick', () => {
      const manager = new ValueDynamicsManager();
      manager.applyChange('n1', 0.1, ValueChangeReason.POST_ENGAGEMENT, 42n);
      expect(manager.getAllStates()[0]!.last_updated_tick).toBe(42n);
    });

    it('should use registered algorithm when available', () => {
      const manager = new ValueDynamicsManager();
      manager.registerAlgorithm(ValueChangeReason.NARRATIVE_ENDORSEMENT, {
        type: 'linear',
        params: { factor: 2.0 }
      });
      const result = manager.applyChange('n1', 0.1, ValueChangeReason.NARRATIVE_ENDORSEMENT, 10n);
      // default linear factor=1.0 for unregistered, registered factor=2.0
      expect(result.delta).toBeCloseTo(0.2);
    });

    it('should use exponential algorithm', () => {
      const manager = new ValueDynamicsManager();
      manager.registerAlgorithm(ValueChangeReason.POST_ENGAGEMENT, {
        type: 'exponential',
        params: { base: 2.0, scale: 1.0 }
      });
      const result = manager.applyChange('n1', 0.1, ValueChangeReason.POST_ENGAGEMENT, 10n);
      // snr=0.5, delta=0.1, calculated = 0.1 * 2^0.5 * 1.0 ≈ 0.0707
      expect(result.new_snr).toBeCloseTo(0.5 + 0.1 * Math.pow(2, 0.5));
    });

    it('should use sigmoid algorithm', () => {
      const manager = new ValueDynamicsManager();
      manager.registerAlgorithm(ValueChangeReason.POST_ENGAGEMENT, {
        type: 'sigmoid',
        params: { steepness: 10, midpoint: 0.5 }
      });
      const result = manager.applyChange('n1', 0.2, ValueChangeReason.POST_ENGAGEMENT, 10n);
      // sigmoid(0.5) with k=10, x0=0.5 = 1/(1+exp(0)) = 0.5
      // delta = 0.2 * 0.5 = 0.1
      expect(result.new_snr).toBeCloseTo(0.6);
    });

    it('should use clamped_linear algorithm', () => {
      const manager = new ValueDynamicsManager();
      manager.registerAlgorithm(ValueChangeReason.POST_ENGAGEMENT, {
        type: 'clamped_linear',
        params: { max_delta: 0.05, min_delta: -0.05 }
      });
      const result = manager.applyChange('n1', 1.0, ValueChangeReason.POST_ENGAGEMENT, 10n);
      expect(result.delta).toBeCloseTo(0.05);
    });
  });

  describe('registerAlgorithm', () => {
    it('should register and use algorithm for specific reason', () => {
      const manager = new ValueDynamicsManager();
      manager.registerAlgorithm(ValueChangeReason.FOLLOWED_BY_ELITE, {
        type: 'linear',
        params: { factor: 3.0 }
      });
      const result = manager.applyChange('n1', 0.1, ValueChangeReason.FOLLOWED_BY_ELITE, 10n);
      expect(result.delta).toBeCloseTo(0.3);
    });

    it('should use default linear for unregistered reasons', () => {
      const manager = new ValueDynamicsManager();
      manager.registerAlgorithm(ValueChangeReason.FOLLOWED_BY_ELITE, {
        type: 'linear',
        params: { factor: 3.0 }
      });
      const result = manager.applyChange('n1', 0.1, ValueChangeReason.POST_ENGAGEMENT, 10n);
      expect(result.delta).toBeCloseTo(0.1);
    });
  });

  describe('getAllStates', () => {
    it('should return all node states', () => {
      const manager = new ValueDynamicsManager();
      manager.applyChange('n1', 0.1, ValueChangeReason.POST_ENGAGEMENT, 10n);
      manager.applyChange('n2', 0.2, ValueChangeReason.POST_ENGAGEMENT, 10n);
      expect(manager.getAllStates()).toHaveLength(2);
    });
  });
});
