import type { WorldStepPrepareRequest } from '@yidhras/contracts';

import { evaluateStateTransforms } from '../../packs/runtime/state_transform_evaluator.js';
import { createLogger } from '../../utils/logger.js';
import type { StepContribution, StepContributor, WorldEngineSessionContext } from './world_engine_contributors.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === 'string';

const logger = createLogger('state_transform_contributor');

export const StateTransformContributor: StepContributor = {
  name: 'builtin:state_transform_evaluator',
  priority: 0,

  contributePrepare(
    _input: WorldStepPrepareRequest,
    context: WorldEngineSessionContext
  ): StepContribution | null {
    const worldEntities = context.world_entities;
    const entityStates = context.entity_states;

    const actorEntityIds = new Set(
      worldEntities
        .filter(e => {
          const kind = isString(e.entity_kind) ? e.entity_kind : '';
          return kind === 'actor' || kind.startsWith('actor:');
        })
        .map(e => e.id as string)
    );

    const actorStates = entityStates
      .filter(
        s =>
          isString(s.state_namespace) && s.state_namespace === 'core' &&
          isString(s.entity_id) && actorEntityIds.has(s.entity_id) &&
          isRecord(s.state_json)
      )
      .map(s => ({
        entity_id: s.entity_id as string,
        state_json: s.state_json as Record<string, unknown>
      }));

    const transformDefs = worldEntities
      .filter(e => isString(e.entity_kind) && e.entity_kind === 'state_transform')
      .map(e => {
        const payload = isRecord(e.payload_json) ? e.payload_json : {};
        return {
          source: isString(payload.source) ? payload.source : '',
          ranges: (Array.isArray(payload.ranges) ? payload.ranges : []) as Array<{
            min: number;
            max: number;
            label: string;
          }>,
          target: isString(payload.target) ? payload.target : ''
        };
      })
      .filter(t => t.source.length > 0 && t.target.length > 0 && t.ranges.length > 0);

    if (transformDefs.length === 0 || actorStates.length === 0) {
      return null;
    }

    const deltaOps = evaluateStateTransforms({
      packId: context.pack_id,
      actorStates,
      transformDefs,
      logDebug: (message, meta) => logger.debug(message, meta),
      logWarn: (message, meta) => logger.warn(message, meta)
    });

    if (deltaOps.length === 0) {
      return null;
    }

    return {
      delta_operations: deltaOps,
      emitted_events: [],
      observability: []
    };
  }
};
