import type { WorldPack, WorldPackOpening } from '../schema/constitution_schema.js';
import { parseWorldPackConstitution } from '../schema/constitution_schema.js';

export const applyOpening = (pack: WorldPack, opening: WorldPackOpening): WorldPack => {
  const mergedVariables =
    opening.variables !== undefined
      ? { ...(pack.variables ?? {}), ...opening.variables }
      : pack.variables;

  const mergedInitialStates =
    opening.initial_states !== undefined && opening.initial_states.length > 0
      ? opening.initial_states
      : pack.bootstrap?.initial_states ?? [];

  const mergedInitialEvents =
    opening.initial_events !== undefined && opening.initial_events.length > 0
      ? opening.initial_events
      : pack.bootstrap?.initial_events ?? [];

  const merged = {
    ...pack,
    variables: mergedVariables,
    bootstrap: {
      ...(pack.bootstrap ?? { initial_states: [], initial_events: [] }),
      initial_states: mergedInitialStates,
      initial_events: mergedInitialEvents
    }
  };

  return parseWorldPackConstitution(merged, `world pack with opening applied`);
};
