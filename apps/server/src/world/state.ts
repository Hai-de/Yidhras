import { Prisma, type PrismaClient } from '@prisma/client';

import type { AppContext } from '../app/context.js';
import { toJsonSafe } from '../app/http/json.js';
import type { WorldPackScenarioValue } from './schema.js';

export type ScenarioStateEntityType = 'actor' | 'artifact' | 'world';
export type ScenarioStateValue = WorldPackScenarioValue;
export type ScenarioStateRecord = Record<string, ScenarioStateValue>;
export type ScenarioStateClient = PrismaClient | Prisma.TransactionClient;

export interface ScenarioEntityStateSnapshot {
  id: string;
  pack_id: string;
  entity_type: ScenarioStateEntityType;
  entity_id: string;
  state_json: ScenarioStateRecord;
  created_at: bigint;
  updated_at: bigint;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const toJsonValue = (value: unknown): Prisma.InputJsonValue => {
  return JSON.parse(JSON.stringify(toJsonSafe(value))) as Prisma.InputJsonValue;
};

const normalizeScenarioStateRecord = (value: unknown): ScenarioStateRecord => {
  if (!isRecord(value)) {
    return {};
  }

  return value as ScenarioStateRecord;
};

const buildScenarioEntityStateId = (
  packId: string,
  entityType: ScenarioStateEntityType,
  entityId: string
): string => {
  return `${packId}:${entityType}:${entityId}`;
};

const toScenarioEntityStateSnapshot = (state: {
  id: string;
  pack_id: string;
  entity_type: string;
  entity_id: string;
  state_json: unknown;
  created_at: bigint;
  updated_at: bigint;
}): ScenarioEntityStateSnapshot => {
  return {
    ...state,
    entity_type: state.entity_type as ScenarioStateEntityType,
    state_json: normalizeScenarioStateRecord(state.state_json)
  };
};

export const upsertScenarioEntityStateWithPrisma = async (
  prisma: ScenarioStateClient,
  input: {
    pack_id: string;
    entity_type: ScenarioStateEntityType;
    entity_id: string;
    state: ScenarioStateRecord;
    now: bigint;
  }
): Promise<ScenarioEntityStateSnapshot> => {
  const recordId = buildScenarioEntityStateId(input.pack_id, input.entity_type, input.entity_id);

  const state = await prisma.scenarioEntityState.upsert({
    where: {
      pack_id_entity_type_entity_id: {
        pack_id: input.pack_id,
        entity_type: input.entity_type,
        entity_id: input.entity_id
      }
    },
    update: {
      state_json: toJsonValue(input.state),
      updated_at: input.now
    },
    create: {
      id: recordId,
      pack_id: input.pack_id,
      entity_type: input.entity_type,
      entity_id: input.entity_id,
      state_json: toJsonValue(input.state),
      created_at: input.now,
      updated_at: input.now
    }
  });

  return toScenarioEntityStateSnapshot(state);
};

export const upsertScenarioEntityState = async (
  context: AppContext,
  input: {
    pack_id: string;
    entity_type: ScenarioStateEntityType;
    entity_id: string;
    state: ScenarioStateRecord;
  }
): Promise<ScenarioEntityStateSnapshot> => {
  return upsertScenarioEntityStateWithPrisma(context.prisma, {
    ...input,
    now: context.sim.clock.getTicks()
  });
};

export const getScenarioEntityStateWithPrisma = async (
  prisma: ScenarioStateClient,
  input: {
    pack_id: string;
    entity_type: ScenarioStateEntityType;
    entity_id: string;
  }
): Promise<ScenarioEntityStateSnapshot | null> => {
  const state = await prisma.scenarioEntityState.findUnique({
    where: {
      pack_id_entity_type_entity_id: {
        pack_id: input.pack_id,
        entity_type: input.entity_type,
        entity_id: input.entity_id
      }
    }
  });

  if (!state) {
    return null;
  }

  return toScenarioEntityStateSnapshot(state);
};

export const getScenarioEntityState = async (
  context: AppContext,
  input: {
    pack_id: string;
    entity_type: ScenarioStateEntityType;
    entity_id: string;
  }
): Promise<ScenarioEntityStateSnapshot | null> => {
  return getScenarioEntityStateWithPrisma(context.prisma, input);
};

export const listScenarioEntityStatesWithPrisma = async (
  prisma: ScenarioStateClient,
  input: {
    pack_id: string;
    entity_type?: ScenarioStateEntityType;
  }
): Promise<ScenarioEntityStateSnapshot[]> => {
  const states = await prisma.scenarioEntityState.findMany({
    where: {
      pack_id: input.pack_id,
      ...(input.entity_type ? { entity_type: input.entity_type } : {})
    },
    orderBy: [{ entity_type: 'asc' }, { entity_id: 'asc' }]
  });

  return states.map(toScenarioEntityStateSnapshot);
};

export const listScenarioEntityStates = async (
  context: AppContext,
  input: {
    pack_id: string;
    entity_type?: ScenarioStateEntityType;
  }
): Promise<ScenarioEntityStateSnapshot[]> => {
  return listScenarioEntityStatesWithPrisma(context.prisma, input);
};

export const patchScenarioEntityState = async (
  context: AppContext,
  input: {
    pack_id: string;
    entity_type: ScenarioStateEntityType;
    entity_id: string;
    patch: ScenarioStateRecord;
  }
): Promise<ScenarioEntityStateSnapshot> => {
  const existing = await getScenarioEntityState(context, input);
  const nextState = {
    ...(existing?.state_json ?? {}),
    ...input.patch
  };

  return upsertScenarioEntityState(context, {
    pack_id: input.pack_id,
    entity_type: input.entity_type,
    entity_id: input.entity_id,
    state: nextState
  });
};

export const buildScenarioEntityStateIdForStorage = buildScenarioEntityStateId;
