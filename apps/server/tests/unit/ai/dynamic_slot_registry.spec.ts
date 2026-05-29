import { afterEach, describe, expect, it } from 'vitest';

import {
  BUILTIN_SLOT_IDS,
  getPromptSlotRegistry,
  listDynamicSlots,
  registerDynamicSlot,
  resetPromptSlotRegistryCache,
  setSlotEnabled,
  unregisterDynamicSlot
} from '../../../src/ai/registry.js';
import type { PromptSlotConfig } from '../../../src/inference/prompt_slot_config.js';
import { resolveSlotPositions } from '../../../src/inference/slot_position_resolver.js';
import { expectDefined } from '../../helpers/assertions.js';

const makeSlot = (overrides: Partial<PromptSlotConfig> = {}): PromptSlotConfig => ({
  id: 'test_dynamic_slot',
  display_name: 'Test Dynamic Slot',
  default_priority: 50,
  position: 45,
  default_template: 'Dynamic content.',
  message_role: 'user',
  include_in_combined: true,
  enabled: true,
  ...overrides
});

describe('Dynamic Slot Registry', () => {
  afterEach(() => {
    // Clean up registered dynamic slots
    const slots = listDynamicSlots();
    for (const s of slots) {
      unregisterDynamicSlot(s.id);
    }
    resetPromptSlotRegistryCache();
  });

  it('registers a dynamic slot successfully', () => {
    const config = makeSlot({ id: 'custom_slot' });
    const ok = registerDynamicSlot(config);
    expect(ok).toBe(true);

    const registry = getPromptSlotRegistry();
    expect(registry.slots).toHaveProperty('custom_slot');
    expect(registry.slots['custom_slot'].display_name).toBe('Test Dynamic Slot');
  });

  it('rejects registration when YAML slot with same id exists', () => {
    const config = makeSlot({ id: 'system_core' });
    const ok = registerDynamicSlot(config);
    expect(ok).toBe(false);

    const registry = getPromptSlotRegistry();
    expect(registry.slots['system_core'].display_name).not.toBe('Test Dynamic Slot');
  });

  it('rejects registration for builtin slot ids', () => {
    for (const id of BUILTIN_SLOT_IDS) {
      const config = makeSlot({ id });
      expect(registerDynamicSlot(config)).toBe(false);
    }
  });

  it('unregisters a dynamic slot', () => {
    const config = makeSlot({ id: 'temp_slot' });
    registerDynamicSlot(config);
    expect(getPromptSlotRegistry().slots).toHaveProperty('temp_slot');

    const ok = unregisterDynamicSlot('temp_slot');
    expect(ok).toBe(true);
    // After re-fetch, the slot is gone
    expect(getPromptSlotRegistry().slots).not.toHaveProperty('temp_slot');
  });

  it('rejects unregister of builtin slot', () => {
    expect(unregisterDynamicSlot('system_core')).toBe(false);
    expect(unregisterDynamicSlot('role_core')).toBe(false);
    expect(unregisterDynamicSlot('conversation_history')).toBe(false);
  });

  it('rejects unregister of nonexistent slot', () => {
    expect(unregisterDynamicSlot('nonexistent_slot')).toBe(false);
  });

  it('toggles enabled state on a dynamic slot', () => {
    const config = makeSlot({ id: 'toggle_slot', enabled: true });
    registerDynamicSlot(config);

    const ok = setSlotEnabled('toggle_slot', false);
    expect(ok).toBe(true);

    const registry = getPromptSlotRegistry();
    expect(registry.slots['toggle_slot'].enabled).toBe(false);

    setSlotEnabled('toggle_slot', true);
    expect(getPromptSlotRegistry().slots['toggle_slot'].enabled).toBe(true);
  });

  it('toggles enabled state on a YAML slot', () => {
    const ok = setSlotEnabled('system_policy', false);
    expect(ok).toBe(true);
    expect(getPromptSlotRegistry().slots['system_policy'].enabled).toBe(false);

    // Restore
    setSlotEnabled('system_policy', true);
    expect(getPromptSlotRegistry().slots['system_policy'].enabled).toBe(true);
  });

  it('returns false for setSlotEnabled on nonexistent slot', () => {
    expect(setSlotEnabled('nonexistent_slot', false)).toBe(false);
  });

  it('resolveSlotPositions includes dynamic slots in correct order', () => {
    registerDynamicSlot(
      makeSlot({ id: 'custom_a', position: 85, default_priority: 85 })
    );
    registerDynamicSlot(
      makeSlot({ id: 'custom_b', position: 55, default_priority: 55 })
    );

    const registry = getPromptSlotRegistry();
    const { resolved_positions } = resolveSlotPositions(registry.slots);

    const customA = resolved_positions.find((p) => p.slot_id === 'custom_a');
    const customB = resolved_positions.find((p) => p.slot_id === 'custom_b');

    const resolvedCustomA = expectDefined(customA, 'custom_a resolved slot');
    const resolvedCustomB = expectDefined(customB, 'custom_b resolved slot');
    // custom_a (position 85) should appear before custom_b (position 55) in descending order
    const idxA = resolved_positions.indexOf(resolvedCustomA);
    const idxB = resolved_positions.indexOf(resolvedCustomB);
    expect(idxA).toBeLessThan(idxB);
  });

  it('disabled dynamic slot retains position in resolved_positions', () => {
    const config = makeSlot({ id: 'disabled_dynamic', position: 75, enabled: false });
    registerDynamicSlot(config);

    const registry = getPromptSlotRegistry();
    const { resolved_positions } = resolveSlotPositions(registry.slots);

    const slot = resolved_positions.find((p) => p.slot_id === 'disabled_dynamic');
    const resolvedSlot = expectDefined(slot, 'disabled dynamic resolved slot');
    expect(resolvedSlot.enabled).toBe(false);
  });

  it('listDynamicSlots returns only dynamic slots, not YAML slots', () => {
    registerDynamicSlot(makeSlot({ id: 'dyn_a' }));
    registerDynamicSlot(makeSlot({ id: 'dyn_b' }));

    const dynamicIds = listDynamicSlots().map((s) => s.id);
    expect(dynamicIds).toContain('dyn_a');
    expect(dynamicIds).toContain('dyn_b');
    expect(dynamicIds).not.toContain('system_core');
    expect(dynamicIds).not.toContain('role_core');
  });
});
