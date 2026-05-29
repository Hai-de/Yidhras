import { describe, expect, it } from 'vitest';

import {
  applyStateTransitions,
  createInitialBehaviorState,
  type SlotBehaviorState,
  type StateTransitionInput
} from '../../../src/inference/slot_behavior_state.js';

describe('createInitialBehaviorState', () => {
  it('creates a Pending state with trigger_count 0', () => {
    const state = createInitialBehaviorState('test_slot');
    expect(state.slot_id).toBe('test_slot');
    expect(state.status).toBe('Pending');
    expect(state.trigger_count).toBe(0);
  });
});

describe('applyStateTransitions — Pending state', () => {
  const baseInput: StateTransitionInput = { conditionMet: false, currentTick: 1 };

  it('stays Pending when condition not met', () => {
    const state = createInitialBehaviorState('s');
    const next = applyStateTransitions(state, baseInput);
    expect(next.status).toBe('Pending');
  });

  it('Pending → Active when condition met (no delay)', () => {
    const state = createInitialBehaviorState('s');
    const next = applyStateTransitions(state, { ...baseInput, conditionMet: true });
    expect(next.status).toBe('Active');
    expect(next.last_activated_tick).toBe(1);
    expect(next.trigger_count).toBe(1);
  });

  it('Pending → Delayed when condition met + delay_ticks > 0', () => {
    const state = createInitialBehaviorState('s');
    const next = applyStateTransitions(state, { ...baseInput, conditionMet: true, delayTicks: 5 });
    expect(next.status).toBe('Delayed');
    expect(next.delay_until_tick).toBe(6); // currentTick + delayTicks
  });

  it('Pending → Active with sticky_remaining when stickyMaxActivations > 1', () => {
    const state = createInitialBehaviorState('s');
    const next = applyStateTransitions(state, { ...baseInput, conditionMet: true, stickyMaxActivations: 5 });
    expect(next.status).toBe('Active');
    expect(next.sticky_remaining).toBe(4);
  });

  it('Pending → Active with sticky_remaining = undefined when stickyMaxActivations = 1', () => {
    const state = createInitialBehaviorState('s');
    const next = applyStateTransitions(state, { ...baseInput, conditionMet: true, stickyMaxActivations: 1 });
    expect(next.status).toBe('Active');
    expect(next.sticky_remaining).toBeUndefined();
  });
});

describe('applyStateTransitions — Delayed state', () => {
  const makeDelayed = (delayUntil: number): SlotBehaviorState => ({
    slot_id: 's',
    status: 'Delayed',
    delay_until_tick: delayUntil,
    trigger_count: 0
  });

  it('stays Delayed when delay not elapsed', () => {
    const state = makeDelayed(10);
    const next = applyStateTransitions(state, { conditionMet: false, currentTick: 5 });
    expect(next.status).toBe('Delayed');
  });

  it('Delayed → Active when delay elapsed', () => {
    const state = makeDelayed(10);
    const next = applyStateTransitions(state, { conditionMet: false, currentTick: 10 });
    expect(next.status).toBe('Active');
    expect(next.delay_until_tick).toBeUndefined();
    expect(next.trigger_count).toBe(1);
  });

  it('Delayed → Active when past delay', () => {
    const state = makeDelayed(10);
    const next = applyStateTransitions(state, { conditionMet: false, currentTick: 15 });
    expect(next.status).toBe('Active');
  });

  it('Delayed → Active with sticky', () => {
    const state = makeDelayed(10);
    const next = applyStateTransitions(state, {
      conditionMet: false,
      currentTick: 10,
      stickyMaxActivations: 3
    });
    expect(next.status).toBe('Active');
    expect(next.sticky_remaining).toBe(2);
  });
});

describe('applyStateTransitions — Active state', () => {
  const makeActive = (stickyRemaining?: number): SlotBehaviorState => ({
    slot_id: 's',
    status: 'Active',
    trigger_count: 1,
    last_activated_tick: 1,
    sticky_remaining: stickyRemaining
  });

  it('Active → Cooling when cooldown_ticks > 0', () => {
    const state = makeActive();
    const next = applyStateTransitions(state, {
      conditionMet: false,
      currentTick: 5,
      cooldownTicks: 10
    });
    expect(next.status).toBe('Cooling');
    expect(next.cooldown_until_tick).toBe(15);
  });

  it('Active → Retained when sticky_remaining > 0 (no cooldown)', () => {
    const state = makeActive(3);
    const next = applyStateTransitions(state, { conditionMet: false, currentTick: 5 });
    expect(next.status).toBe('Retained');
    expect(next.sticky_remaining).toBe(2);
  });

  it('Active → Pending when no sticky and no cooldown', () => {
    const state = makeActive();
    const next = applyStateTransitions(state, { conditionMet: false, currentTick: 5 });
    expect(next.status).toBe('Pending');
  });

  it('Cooling takes priority over sticky', () => {
    const state = makeActive(3);
    const next = applyStateTransitions(state, {
      conditionMet: false,
      currentTick: 5,
      cooldownTicks: 10,
      stickyMaxActivations: 5
    });
    expect(next.status).toBe('Cooling');
    expect(next.sticky_remaining).toBeUndefined();
  });
});

describe('applyStateTransitions — Retained state', () => {
  const makeRetained = (stickyRemaining: number): SlotBehaviorState => ({
    slot_id: 's',
    status: 'Retained',
    sticky_remaining: stickyRemaining,
    trigger_count: 1
  });

  it('Retained → Retained with sticky decremented when condition met', () => {
    const state = makeRetained(3);
    const next = applyStateTransitions(state, { conditionMet: true, currentTick: 5 });
    expect(next.status).toBe('Retained');
    expect(next.sticky_remaining).toBe(2);
    expect(next.trigger_count).toBe(2);
  });

  it('Retained → Pending when sticky exhausted and no cooldown', () => {
    const state = makeRetained(0);
    const next = applyStateTransitions(state, { conditionMet: true, currentTick: 5 });
    expect(next.status).toBe('Pending');
    expect(next.sticky_remaining).toBeUndefined();
  });

  it('Retained → Cooling when sticky exhausted + cooldown', () => {
    const state = makeRetained(0);
    const next = applyStateTransitions(state, {
      conditionMet: true,
      currentTick: 5,
      cooldownTicks: 10
    });
    expect(next.status).toBe('Cooling');
    expect(next.cooldown_until_tick).toBe(15);
  });

  it('Retained → Pending when condition not met, no cooldown', () => {
    const state = makeRetained(3);
    const next = applyStateTransitions(state, { conditionMet: false, currentTick: 5 });
    expect(next.status).toBe('Pending');
  });

  it('Retained → Cooling when condition not met + cooldown', () => {
    const state = makeRetained(3);
    const next = applyStateTransitions(state, {
      conditionMet: false,
      currentTick: 5,
      cooldownTicks: 10
    });
    expect(next.status).toBe('Cooling');
  });
});

describe('applyStateTransitions — Cooling state', () => {
  const makeCooling = (cooldownUntil: number): SlotBehaviorState => ({
    slot_id: 's',
    status: 'Cooling',
    cooldown_until_tick: cooldownUntil,
    trigger_count: 1
  });

  it('stays Cooling when cooldown not elapsed', () => {
    const state = makeCooling(20);
    const next = applyStateTransitions(state, { conditionMet: true, currentTick: 10 });
    expect(next.status).toBe('Cooling');
  });

  it('Cooling → Pending when cooldown elapsed', () => {
    const state = makeCooling(20);
    const next = applyStateTransitions(state, { conditionMet: true, currentTick: 20 });
    expect(next.status).toBe('Pending');
    expect(next.cooldown_until_tick).toBeUndefined();
  });

  it('Cooling → Pending when past cooldown', () => {
    const state = makeCooling(20);
    const next = applyStateTransitions(state, { conditionMet: true, currentTick: 25 });
    expect(next.status).toBe('Pending');
  });

  it('Cooling ignores conditions — stays Cooling even if condition met', () => {
    const state = makeCooling(20);
    const next = applyStateTransitions(state, { conditionMet: true, currentTick: 10 });
    expect(next.status).toBe('Cooling');
  });
});

describe('applyStateTransitions — full lifecycle', () => {
  it('Pending → Active → Cooling → Pending', () => {
    let state = createInitialBehaviorState('s');

    // Pending → Active (condition met)
    state = applyStateTransitions(state, { conditionMet: true, currentTick: 1, cooldownTicks: 5 });
    expect(state.status).toBe('Active');

    // Active → Cooling (cooldown triggers)
    state = applyStateTransitions(state, { conditionMet: false, currentTick: 1, cooldownTicks: 5 });
    expect(state.status).toBe('Cooling');
    expect(state.cooldown_until_tick).toBe(6);

    // Cooling → stays Cooling
    state = applyStateTransitions(state, { conditionMet: true, currentTick: 3 });
    expect(state.status).toBe('Cooling');

    // Cooling → Pending (cooldown elapsed)
    state = applyStateTransitions(state, { conditionMet: true, currentTick: 7 });
    expect(state.status).toBe('Pending');
  });

  it('Pending → Active → Retained → Retained → Pending', () => {
    let state = createInitialBehaviorState('s');

    state = applyStateTransitions(state, {
      conditionMet: true, currentTick: 1, stickyMaxActivations: 3
    });
    expect(state.status).toBe('Active');
    expect(state.sticky_remaining).toBe(2);

    state = applyStateTransitions(state, { conditionMet: true, currentTick: 2 });
    expect(state.status).toBe('Retained');
    expect(state.sticky_remaining).toBe(1);

    state = applyStateTransitions(state, { conditionMet: true, currentTick: 3 });
    expect(state.status).toBe('Retained');
    expect(state.sticky_remaining).toBe(0);

    state = applyStateTransitions(state, { conditionMet: true, currentTick: 4 });
    expect(state.status).toBe('Pending');
  });

  it('Pending → Delayed → Active → Pending', () => {
    let state = createInitialBehaviorState('s');

    state = applyStateTransitions(state, { conditionMet: true, currentTick: 1, delayTicks: 3 });
    expect(state.status).toBe('Delayed');

    state = applyStateTransitions(state, { conditionMet: false, currentTick: 2 });
    expect(state.status).toBe('Delayed');

    state = applyStateTransitions(state, { conditionMet: false, currentTick: 4 });
    expect(state.status).toBe('Active');

    state = applyStateTransitions(state, { conditionMet: false, currentTick: 4 });
    expect(state.status).toBe('Pending');
  });
});
