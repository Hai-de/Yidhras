import { describe, expect,it } from 'vitest';

import { PackRuntimeInstance } from '../../src/core/pack_runtime_instance.js';

const packStub = {
  metadata: { id: 'test-pack', name: 'Test Pack', version: '1.0.0' },
  time_systems: []
};

describe('PackRuntimeInstance requestedStep', () => {
  const createInstance = () =>
    new PackRuntimeInstance({
      pack: packStub as Parameters<typeof PackRuntimeInstance['prototype']['getPack']>['0'],
      packFolderName: 'test-pack',
      instanceId: 'test-pack'
    });

  it('consume returns undefined when nothing was set', () => {
    const instance = createInstance();
    expect(instance.consumeRequestedStepTicks()).toBeUndefined();
  });

  it('stores and returns the requested step ticks', () => {
    const instance = createInstance();
    instance.setRequestedStepTicks(80n);
    expect(instance.consumeRequestedStepTicks()).toBe(80n);
  });

  it('clears the value after consume', () => {
    const instance = createInstance();
    instance.setRequestedStepTicks(50n);
    instance.consumeRequestedStepTicks();
    expect(instance.consumeRequestedStepTicks()).toBeUndefined();
  });

  it('allows setting multiple times, last value wins', () => {
    const instance = createInstance();
    instance.setRequestedStepTicks(10n);
    instance.setRequestedStepTicks(30n);
    expect(instance.consumeRequestedStepTicks()).toBe(30n);
  });

  it('consume then set again works correctly', () => {
    const instance = createInstance();
    instance.setRequestedStepTicks(5n);
    expect(instance.consumeRequestedStepTicks()).toBe(5n);
    instance.setRequestedStepTicks(3n);
    expect(instance.consumeRequestedStepTicks()).toBe(3n);
  });
});
