import type { PrismaClient } from '@prisma/client';

import type { AgentRepository } from './AgentRepository.js';
import { PrismaAgentRepository } from './AgentRepository.js';
import type { IdentityOperatorRepository } from './IdentityOperatorRepository.js';
import { PrismaIdentityOperatorRepository } from './IdentityOperatorRepository.js';
import type { InferenceWorkflowRepository } from './InferenceWorkflowRepository.js';
import { PrismaInferenceWorkflowRepository } from './InferenceWorkflowRepository.js';
import type { MemoryRepository } from './MemoryRepository.js';
import { PrismaMemoryRepository } from './MemoryRepository.js';
import type { NarrativeEventRepository } from './NarrativeEventRepository.js';
import { PrismaNarrativeEventRepository } from './NarrativeEventRepository.js';
import type { PluginRepository } from './PluginRepository.js';
import { PrismaPluginRepository } from './PluginRepository.js';
import type { RelationshipGraphRepository } from './RelationshipGraphRepository.js';
import { PrismaRelationshipGraphRepository } from './RelationshipGraphRepository.js';
import type { SocialRepository } from './SocialRepository.js';
import { PrismaSocialRepository } from './SocialRepository.js';

export interface Repositories {
  readonly inference: InferenceWorkflowRepository;
  readonly identityOperator: IdentityOperatorRepository;
  readonly memory: MemoryRepository;
  readonly narrative: NarrativeEventRepository;
  readonly relationship: RelationshipGraphRepository;
  readonly plugin: PluginRepository;
  readonly agent: AgentRepository;
  readonly social: SocialRepository;
}

export function createPrismaRepositories(prisma: PrismaClient): Repositories {
  return {
    inference: new PrismaInferenceWorkflowRepository(prisma),
    identityOperator: new PrismaIdentityOperatorRepository(prisma),
    memory: new PrismaMemoryRepository(prisma),
    narrative: new PrismaNarrativeEventRepository(prisma),
    relationship: new PrismaRelationshipGraphRepository(prisma),
    plugin: new PrismaPluginRepository(prisma),
    agent: new PrismaAgentRepository(prisma),
    social: new PrismaSocialRepository(prisma)
  };
}
