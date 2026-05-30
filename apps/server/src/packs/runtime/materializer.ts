import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';

import { createPRNG } from '../../template_engine/core/prng.js';
import type { RenderScope } from '../../template_engine/core/types.js';
import { BUILTIN_MACRO_HANDLERS } from '../../template_engine/defaults.js';
import type { WorldPack } from '../schema/constitution_schema.js';
import { upsertPackAuthorityGrant } from '../storage/authority_repo.js';
import { upsertPackWorldEntity } from '../storage/entity_repo.js';
import { upsertPackEntityState } from '../storage/entity_state_repo.js';
import { upsertPackMediatorBinding } from '../storage/mediator_repo.js';
import type { PackStorageAdapter } from '../storage/PackStorageAdapter.js';
import {
  DEFAULT_PACK_WORLD_ENTITY_ID,
  type PackRuntimeAuthorityGrantInput,
  type PackRuntimeEntityStateInput,
  type PackRuntimeMaterializeSummary,
  type PackRuntimeMediatorBindingInput,
  type PackRuntimeWorldEntityInput
} from './core_models.js';
import { expandStateJson } from './template_expander.js';

const buildWorldEntityId = (packId: string, entityId: string): string => `${packId}:entity:${entityId}`;
const buildEntityStateId = (packId: string, entityId: string, namespace: string): string => `${packId}:state:${entityId}:${namespace}`;
const buildMediatorBindingId = (packId: string, mediatorId: string): string => `${packId}:mediator:${mediatorId}`;

const createWorldEntityInput = (
  packId: string,
  entityId: string,
  entityKind: string,
  label: string,
  now: bigint,
  options?: {
    entityType?: string | null;
    tags?: string[];
    staticSchemaRef?: string | null;
    payload?: Record<string, unknown> | null;
  }
): PackRuntimeWorldEntityInput => ({
  id: buildWorldEntityId(packId, entityId),
  pack_id: packId,
  entity_kind: entityKind,
  entity_type: options?.entityType ?? null,
  label,
  tags: options?.tags ?? [],
  static_schema_ref: options?.staticSchemaRef ?? null,
  payload_json: options?.payload ?? null,
  now
});

const createEntityStateInput = (
  packId: string,
  entityId: string,
  namespace: string,
  stateJson: Record<string, unknown>,
  now: bigint
): PackRuntimeEntityStateInput => ({
  id: buildEntityStateId(packId, entityId, namespace),
  pack_id: packId,
  entity_id: entityId,
  state_namespace: namespace,
  state_json: stateJson,
  now
});

export const materializePackRuntimeCoreModels = async (
  instanceId: string,
  pack: WorldPack,
  now: bigint,
  packStorageAdapter: PackStorageAdapter,
  appliedOpeningId?: string,
  prisma?: PrismaClient
): Promise<PackRuntimeMaterializeSummary> => {
  const packId = instanceId;
  const worldEntities = new Map<string, PackRuntimeWorldEntityInput>();
  const entityStates = new Map<string, PackRuntimeEntityStateInput>();
  const authorityGrants = new Map<string, PackRuntimeAuthorityGrantInput>();
  const mediatorBindings = new Map<string, PackRuntimeMediatorBindingInput>();

  const putWorldEntity = (input: PackRuntimeWorldEntityInput): void => {
    worldEntities.set(input.id, input);
  };
  const putEntityState = (input: PackRuntimeEntityStateInput): void => {
    entityStates.set(input.id, input);
  };
  const putAuthorityGrant = (input: PackRuntimeAuthorityGrantInput): void => {
    authorityGrants.set(input.id, input);
  };
  const putMediatorBinding = (input: PackRuntimeMediatorBindingInput): void => {
    mediatorBindings.set(input.id, input);
  };

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- YAML config value
  const seed = (pack.variables?.['seed'] as string | undefined) ?? randomUUID();
  const prng = createPRNG(seed);
  const expandScope: RenderScope = {
    variables: {
      pack: {
        variables: pack.variables ?? {}
      }
    },
    modifiers: {},
    blockHandlers: {},
    macroHandlers: BUILTIN_MACRO_HANDLERS,
    prng,
    depth: 0,
    maxDepth: 32
  };

  for (const actor of pack.entities?.actors ?? []) {
    putWorldEntity(
      createWorldEntityInput(packId, actor.id, actor.kind ?? 'actor', actor.label, now, {
        entityType: actor.entity_type ?? null,
        tags: actor.tags,
        staticSchemaRef: actor.static_schema_ref ?? null,
        payload: actor
      })
    );
    if (actor.state) {
      const expandedState = expandStateJson(actor.state, expandScope);
      putEntityState(createEntityStateInput(packId, actor.id, 'core', expandedState, now));
    }
  }

  for (const collective of pack.entities?.collectives ?? []) {
    putWorldEntity(
      createWorldEntityInput(packId, collective.id, collective.kind ?? 'collective', collective.label, now, {
        entityType: collective.entity_type ?? null,
        tags: collective.tags,
        staticSchemaRef: collective.static_schema_ref ?? null,
        payload: collective
      })
    );
    if (collective.state) {
      const expandedState = expandStateJson(collective.state, expandScope);
      putEntityState(createEntityStateInput(packId, collective.id, 'core', expandedState, now));
    }
  }

  for (const artifact of pack.entities?.artifacts ?? []) {
    putWorldEntity(
      createWorldEntityInput(packId, artifact.id, artifact.kind ?? 'artifact', artifact.label, now, {
        entityType: artifact.entity_type ?? null,
        tags: artifact.tags,
        staticSchemaRef: artifact.static_schema_ref ?? null,
        payload: artifact
      })
    );
    if (artifact.state) {
      const expandedState = expandStateJson(artifact.state, expandScope);
      putEntityState(createEntityStateInput(packId, artifact.id, 'core', expandedState, now));
    }
  }

  for (const domain of pack.entities?.domains ?? []) {
    putWorldEntity(
      createWorldEntityInput(packId, domain.id, domain.kind ?? 'domain', domain.label, now, {
        entityType: domain.entity_type ?? null,
        tags: domain.tags,
        staticSchemaRef: domain.static_schema_ref ?? null,
        payload: domain
      })
    );
    if (domain.state) {
      const expandedState = expandStateJson(domain.state, expandScope);
      putEntityState(createEntityStateInput(packId, domain.id, 'domain', expandedState, now));
    }
  }

  for (const institution of pack.entities?.institutions ?? []) {
    putWorldEntity(
      createWorldEntityInput(packId, institution.id, institution.kind ?? 'institution', institution.label, now, {
        entityType: institution.entity_type ?? null,
        tags: institution.tags,
        staticSchemaRef: institution.static_schema_ref ?? null,
        payload: institution
      })
    );
    if (institution.state) {
      const expandedState = expandStateJson(institution.state, expandScope);
      putEntityState(createEntityStateInput(packId, institution.id, 'core', expandedState, now));
    }
  }

  for (const mediator of pack.entities?.mediators ?? []) {
    putWorldEntity(
      createWorldEntityInput(packId, mediator.id, 'mediator', mediator.id, now, {
        entityType: mediator.mediator_kind,
        payload: mediator
      })
    );
    putMediatorBinding({
      id: buildMediatorBindingId(packId, mediator.id),
      pack_id: packId,
      mediator_id: mediator.id,
      subject_entity_id: mediator.entity_ref,
      binding_kind: 'direct_entity',
      status: 'active',
      metadata_json: mediator,
      now
    });
  }

  for (const identity of pack.identities ?? []) {
    putWorldEntity(
      createWorldEntityInput(packId, identity.id, 'abstract_authority', identity.id, now, {
        entityType: identity.type,
        payload: identity
      })
    );
  }

  for (const authority of pack.authorities ?? []) {
    putAuthorityGrant({
      id: authority.id,
      pack_id: packId,
      source_entity_id: authority.source_entity_id,
      target_selector_json: authority.target_selector,
      capability_key: authority.capability_key,
      grant_type: authority.grant_type,
      mediated_by_entity_id: authority.mediated_by_entity_id ?? null,
      scope_json: authority.scope_json ?? null,
      conditions_json: authority.conditions_json ?? null,
      priority: authority.priority,
      status: authority.status ?? null,
      revocable: authority.revocable ?? null,
      now
    });
  }

  for (const initialState of pack.bootstrap?.initial_states ?? []) {
    if (initialState.entity_id === DEFAULT_PACK_WORLD_ENTITY_ID) {
      putWorldEntity(
        createWorldEntityInput(packId, DEFAULT_PACK_WORLD_ENTITY_ID, 'abstract_authority', `${pack.metadata.name} world`, now, {
          entityType: 'world',
          payload: null
        })
      );
    }
    const expandedStateJson = expandStateJson(initialState.state_json, expandScope);
    putEntityState(
      createEntityStateInput(
        packId,
        initialState.entity_id,
        initialState.state_namespace,
        expandedStateJson,
        now
      )
    );
  }

  if (prisma && (pack.bootstrap?.initial_events?.length ?? 0) > 0) {
    for (const initialEvent of pack.bootstrap?.initial_events ?? []) {
      await prisma.event.create({
        data: {
          title: initialEvent.event_type,
          description: JSON.stringify(initialEvent.payload),
          tick: now,
          type: 'system',
          pack_id: packId,
          visibility: 'public',
          created_at: now
        }
      });
    }
  }

  const metaStateId = buildEntityStateId(packId, DEFAULT_PACK_WORLD_ENTITY_ID, 'meta');
  entityStates.set(metaStateId, {
    id: metaStateId,
    pack_id: packId,
    entity_id: buildWorldEntityId(packId, DEFAULT_PACK_WORLD_ENTITY_ID),
    state_namespace: 'meta',
    state_json: {
      applied_opening_id: appliedOpeningId ?? null,
      materialized_at: String(now),
      seed
    },
    now
  });

  for (const transform of pack.state_transforms ?? []) {
    putWorldEntity(
      createWorldEntityInput(packId, transform.target, 'state_transform', transform.target, now, {
        entityType: 'state_transform',
        payload: transform
      })
    );
  }

  for (const worldEntity of worldEntities.values()) {
    await upsertPackWorldEntity(packStorageAdapter, worldEntity);
  }
  for (const entityState of entityStates.values()) {
    await upsertPackEntityState(packStorageAdapter, entityState);
  }
  for (const authorityGrant of authorityGrants.values()) {
    await upsertPackAuthorityGrant(packStorageAdapter, authorityGrant);
  }
  for (const mediatorBinding of mediatorBindings.values()) {
    await upsertPackMediatorBinding(packStorageAdapter, mediatorBinding);
  }

  return {
    pack_id: packId,
    world_entity_count: worldEntities.size,
    entity_state_count: entityStates.size,
    authority_grant_count: authorityGrants.size,
    mediator_binding_count: mediatorBindings.size,
    state_transform_count: (pack.state_transforms ?? []).length
  };
};

export interface ActorBridgeSummary {
  pack_id: string;
  agent_count: number;
  identity_count: number;
  binding_count: number;
}

const buildBridgedAgentId = (packId: string, actorId: string): string => `${packId}:${actorId}`;
const buildBridgedIdentityId = (packId: string, identityId: string): string => `${packId}:identity:${identityId}`;

export const materializeActorBridges = async (
  instanceId: string,
  pack: WorldPack,
  prisma: PrismaClient,
  now: bigint
): Promise<ActorBridgeSummary> => {
  const packId = instanceId;
  const actors = pack.entities?.actors ?? [];
  const identities = pack.identities ?? [];

  let agentCount = 0;
  let identityCount = 0;
  let bindingCount = 0;

  for (const actor of actors) {
    const agentId = buildBridgedAgentId(packId, actor.id);

    await prisma.agent.upsert({
      where: { id: agentId },
      update: { name: actor.label, type: 'active', snr: 1.0, updated_at: now },
      create: { id: agentId, name: actor.label, type: 'active', snr: 1.0, is_pinned: false, created_at: now, updated_at: now }
    });
    agentCount++;

    const matchingIdentities = identities.filter(
      (identity) => identity.subject_entity_id === actor.id
    );

    if (matchingIdentities.length === 0) {
      const defaultIdentityId = buildBridgedIdentityId(packId, actor.id);

      await prisma.identity.upsert({
        where: { id: defaultIdentityId },
        update: { name: actor.label, type: 'agent', updated_at: now },
        create: {
          id: defaultIdentityId,
          type: 'agent',
          name: actor.label,
          provider: 'pack',
          status: 'active',
          created_at: now,
          updated_at: now
        }
      });
      identityCount++;

      await prisma.identityNodeBinding.upsert({
        where: {
          id: `${packId}:binding:${actor.id}`
        },
        update: {},
        create: {
          id: `${packId}:binding:${actor.id}`,
          identity_id: defaultIdentityId,
          agent_id: agentId,
          atmosphere_node_id: null,
          role: 'active',
          status: 'active',
          created_at: now,
          updated_at: now
        }
      });
      bindingCount++;
    }

    for (const identity of matchingIdentities) {
      const bridgedIdentityId = buildBridgedIdentityId(packId, identity.id);

      await prisma.identity.upsert({
        where: { id: bridgedIdentityId },
        update: { name: identity.id, type: identity.type, updated_at: now },
        create: {
          id: bridgedIdentityId,
          type: identity.type,
          name: identity.id,
          provider: 'pack',
          status: 'active',
          created_at: now,
          updated_at: now
        }
      });
      identityCount++;

      await prisma.identityNodeBinding.upsert({
        where: {
          id: `${packId}:binding:${actor.id}:${identity.id}`
        },
        update: {},
        create: {
          id: `${packId}:binding:${actor.id}:${identity.id}`,
          identity_id: bridgedIdentityId,
          agent_id: agentId,
          atmosphere_node_id: null,
          role: 'active',
          status: 'active',
          created_at: now,
          updated_at: now
        }
      });
      bindingCount++;
    }
  }

  return { pack_id: packId, agent_count: agentCount, identity_count: identityCount, binding_count: bindingCount };
};

export const teardownActorBridges = async (packId: string, prisma: PrismaClient): Promise<number> => {
  const prefix = `${packId}:`;
  const identityPrefix = `${packId}:identity:`;
  const bindingPrefix = `${packId}:binding:`;

  const deletedIdentityBindings = await prisma.identityNodeBinding.deleteMany({
    where: { id: { startsWith: bindingPrefix } }
  });
  const deletedIdentities = await prisma.identity.deleteMany({
    where: { id: { startsWith: identityPrefix } }
  });
  const deletedAgents = await prisma.agent.deleteMany({
    where: { id: { startsWith: prefix } }
  });

  return deletedAgents.count + deletedIdentities.count + deletedIdentityBindings.count;
};
