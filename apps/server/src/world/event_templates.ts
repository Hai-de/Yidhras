import type { Prisma } from '@prisma/client';

import type { AppContext } from '../app/context.js';
import { ApiError } from '../utils/api_error.js';
import type { WorldPackEventTemplateConfig, WorldPackScenarioValue } from './schema.js';
import {
  getScenarioEntityState,
  getScenarioEntityStateWithPrisma,
  type ScenarioStateClient,
  type ScenarioStateRecord
} from './state.js';

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const resolveStringTemplate = (template: string, context: Record<string, unknown>): string => {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_full, path) => {
    const parts = String(path).split('.');
    let current: unknown = context;
    for (const part of parts) {
      if (!isRecord(current) || !(part in current)) {
        return '';
      }
      current = current[part];
    }

    if (current === null || current === undefined) {
      return '';
    }

    return typeof current === 'string' || typeof current === 'number' || typeof current === 'boolean'
      ? String(current)
      : '';
  });
};

const resolveScenarioTemplateValue = (
  value: WorldPackScenarioValue,
  context: Record<string, unknown>
): Prisma.InputJsonValue => {
  if (typeof value === 'string') {
    return resolveStringTemplate(value, context);
  }

  if (Array.isArray(value)) {
    return value.map(item => resolveScenarioTemplateValue(item, context));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolveScenarioTemplateValue(item as WorldPackScenarioValue, context)])
    ) as Prisma.InputJsonValue;
  }

  return value as Prisma.InputJsonValue;
};

const resolveTemplateContext = async (
  prisma: ScenarioStateClient,
  context: AppContext,
  input: {
    actorAgentId: string | null;
    artifactId?: string | null;
  }
): Promise<Record<string, unknown>> => {
  const pack = context.sim.getActivePack();
  if (!pack) {
    throw new ApiError(503, 'WORLD_PACK_NOT_READY', 'World pack not ready for event templates');
  }

  const actorId = input.actorAgentId;
  const artifactId = input.artifactId ?? null;

  const [actor, actorState, artifactState] = await Promise.all([
    actorId
      ? prisma.agent.findUnique({
          where: { id: actorId },
          select: { id: true, name: true, type: true }
        })
      : Promise.resolve(null),
    actorId
      ? getScenarioEntityStateWithPrisma(prisma, {
          pack_id: pack.metadata.id,
          entity_type: 'actor',
          entity_id: actorId
        })
      : Promise.resolve(null),
    artifactId
      ? getScenarioEntityStateWithPrisma(prisma, {
          pack_id: pack.metadata.id,
          entity_type: 'artifact',
          entity_id: artifactId
        })
      : Promise.resolve(null)
  ]);

  return {
    actor: actor
      ? {
          id: actor.id,
          name: actor.name,
          type: actor.type,
          state: actorState?.state_json ?? {}
        }
      : null,
    artifact: artifactState
      ? {
          id: artifactState.entity_id,
          ...(artifactState.state_json as ScenarioStateRecord)
        }
      : null,
    world: {
      id: pack.metadata.id,
      name: pack.metadata.name,
      version: pack.metadata.version
    }
  };
};

export const emitPackEventTemplateWithPrisma = async (
  prisma: ScenarioStateClient,
  context: AppContext,
  input: {
    templateKey: string;
    actorAgentId: string | null;
    artifactId?: string | null;
    sourceActionIntentId: string;
    now: bigint;
  }
): Promise<void> => {
  const pack = context.sim.getActivePack();
  if (!pack) {
    throw new ApiError(503, 'WORLD_PACK_NOT_READY', 'World pack not ready for event templates');
  }

  const template = pack.event_templates?.[input.templateKey] as WorldPackEventTemplateConfig | undefined;
  if (!template) {
    throw new ApiError(500, 'ACTION_EVENT_INVALID', 'Pack event template not found', {
      template_key: input.templateKey,
      pack_id: pack.metadata.id
    });
  }

  const templateContext = await resolveTemplateContext(prisma, context, {
    actorAgentId: input.actorAgentId,
    artifactId: input.artifactId ?? null
  });

  const impactData = template.impact_data
    ? resolveScenarioTemplateValue(template.impact_data, templateContext)
    : null;

  await prisma.event.create({
    data: {
      title: resolveStringTemplate(template.title, templateContext),
      description: resolveStringTemplate(template.description, templateContext),
      tick: input.now,
      type: template.type,
      impact_data: impactData ? JSON.stringify(impactData) : null,
      source_action_intent_id: input.sourceActionIntentId,
      created_at: input.now
    }
  });
};

export const emitPackEventTemplate = async (
  context: AppContext,
  input: {
    templateKey: string;
    actorAgentId: string | null;
    artifactId?: string | null;
    sourceActionIntentId: string;
  }
): Promise<void> => {
  const now = context.sim.clock.getTicks();
  await emitPackEventTemplateWithPrisma(context.prisma, context, {
    ...input,
    now
  });
};

export const getPackArtifactState = async (
  context: AppContext,
  artifactId: string
) => {
  const pack = context.sim.getActivePack();
  if (!pack) {
    throw new ApiError(503, 'WORLD_PACK_NOT_READY', 'World pack not ready for artifact state');
  }

  return getScenarioEntityState(context, {
    pack_id: pack.metadata.id,
    entity_type: 'artifact',
    entity_id: artifactId
  });
};
