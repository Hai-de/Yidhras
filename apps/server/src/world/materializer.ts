import { Prisma, type PrismaClient } from '@prisma/client';

import { toJsonSafe } from '../app/http/json.js';
import type {
  ScenarioIdentityConfig,
  WorldPack,
  WorldPackScenarioAgentConfig,
  WorldPackScenarioRelationshipConfig
} from './schema.js';
import { upsertScenarioEntityStateWithPrisma } from './state.js';

export const DEFAULT_WORLD_STATE_ENTITY_ID = '__world__';

const toJsonValue = (value: unknown): Prisma.InputJsonValue => {
  return JSON.parse(JSON.stringify(toJsonSafe(value))) as Prisma.InputJsonValue;
};

const normalizeIdentityConfig = (agent: WorldPackScenarioAgentConfig): ScenarioIdentityConfig => {
  return {
    id: agent.identity?.id ?? agent.id,
    type: agent.identity?.type ?? 'agent',
    name: agent.identity?.name ?? agent.name,
    provider: agent.identity?.provider ?? 'world_pack',
    status: agent.identity?.status ?? 'active',
    claims: agent.identity?.claims,
    metadata: agent.identity?.metadata
  };
};

const upsertScenarioAgent = async (
  prisma: PrismaClient,
  agent: WorldPackScenarioAgentConfig,
  now: bigint
): Promise<void> => {
  await prisma.agent.upsert({
    where: {
      id: agent.id
    },
    update: {
      name: agent.name,
      type: agent.type,
      updated_at: now
    },
    create: {
      id: agent.id,
      name: agent.name,
      type: agent.type,
      created_at: now,
      updated_at: now
    }
  });
};

const upsertScenarioIdentity = async (
  prisma: PrismaClient,
  identity: ScenarioIdentityConfig,
  now: bigint
): Promise<void> => {
  await prisma.identity.upsert({
    where: {
      id: identity.id
    },
    update: {
      type: identity.type,
      name: identity.name ?? null,
      provider: identity.provider ?? 'world_pack',
      status: identity.status ?? 'active',
      claims: identity.claims ? toJsonValue(identity.claims) : Prisma.JsonNull,
      metadata: identity.metadata ? toJsonValue(identity.metadata) : Prisma.JsonNull,
      updated_at: now
    },
    create: {
      id: identity.id,
      type: identity.type,
      name: identity.name ?? null,
      provider: identity.provider ?? 'world_pack',
      status: identity.status ?? 'active',
      claims: identity.claims ? toJsonValue(identity.claims) : Prisma.JsonNull,
      metadata: identity.metadata ? toJsonValue(identity.metadata) : Prisma.JsonNull,
      created_at: now,
      updated_at: now
    }
  });
};

const ensureScenarioIdentityBinding = async (
  prisma: PrismaClient,
  input: {
    identity_id: string;
    agent_id: string;
    now: bigint;
  }
): Promise<void> => {
  const existing = await prisma.identityNodeBinding.findFirst({
    where: {
      identity_id: input.identity_id,
      agent_id: input.agent_id,
      atmosphere_node_id: null,
      role: 'active'
    },
    orderBy: {
      created_at: 'asc'
    }
  });

  if (existing) {
    await prisma.identityNodeBinding.update({
      where: {
        id: existing.id
      },
      data: {
        status: 'active',
        expires_at: null,
        updated_at: input.now
      }
    });
    return;
  }

  await prisma.identityNodeBinding.create({
    data: {
      identity_id: input.identity_id,
      agent_id: input.agent_id,
      atmosphere_node_id: null,
      role: 'active',
      status: 'active',
      expires_at: null,
      created_at: input.now,
      updated_at: input.now
    }
  });
};

const upsertScenarioRelationship = async (
  prisma: PrismaClient,
  relationship: WorldPackScenarioRelationshipConfig,
  now: bigint
): Promise<void> => {
  await prisma.relationship.upsert({
    where: {
      from_id_to_id_type: {
        from_id: relationship.from_id,
        to_id: relationship.to_id,
        type: relationship.type
      }
    },
    update: {
      weight: relationship.weight,
      updated_at: now
    },
    create: {
      from_id: relationship.from_id,
      to_id: relationship.to_id,
      type: relationship.type,
      weight: relationship.weight,
      created_at: now,
      updated_at: now
    }
  });
};

export const materializeWorldPackScenario = async (
  prisma: PrismaClient,
  pack: WorldPack,
  now: bigint
): Promise<void> => {
  if (!pack.scenario) {
    return;
  }

  const packId = pack.metadata.id;
  const agents = pack.scenario.agents ?? [];
  const relationships = pack.scenario.relationships ?? [];
  const artifacts = pack.scenario.artifacts ?? [];

  for (const agent of agents) {
    await upsertScenarioAgent(prisma, agent, now);
    const identity = normalizeIdentityConfig(agent);
    await upsertScenarioIdentity(prisma, identity, now);
    await ensureScenarioIdentityBinding(prisma, {
      identity_id: identity.id,
      agent_id: agent.id,
      now
    });
    await upsertScenarioEntityStateWithPrisma(prisma, {
      pack_id: packId,
      entity_type: 'actor',
      entity_id: agent.id,
      state: agent.state ?? {},
      now
    });
  }

  for (const relationship of relationships) {
    await upsertScenarioRelationship(prisma, relationship, now);
  }

  for (const artifact of artifacts) {
    await upsertScenarioEntityStateWithPrisma(prisma, {
      pack_id: packId,
      entity_type: 'artifact',
      entity_id: artifact.id,
      state: {
        kind: artifact.kind,
        label: artifact.label,
        ...(artifact.state ?? {})
      },
      now
    });
  }

  if (pack.scenario.world_state) {
    await upsertScenarioEntityStateWithPrisma(prisma, {
      pack_id: packId,
      entity_type: 'world',
      entity_id: DEFAULT_WORLD_STATE_ENTITY_ID,
      state: pack.scenario.world_state,
      now
    });
  }
};
