import type { PrismaClient } from '@prisma/client';

import type { Repositories } from './types.js';
import { PrismaWorkflowRunRepository } from '../workflow/workflow_run_repository.js';
import { PrismaWorkflowStepRunRepository } from '../workflow/workflow_step_repository.js';
import { PrismaAgentRepository } from './AgentRepository.js';
import { PrismaIdentityOperatorRepository } from './IdentityOperatorRepository.js';
import { PrismaInferenceWorkflowRepository } from './InferenceWorkflowRepository.js';
import { PrismaMemoryRepository } from './MemoryRepository.js';
import { PrismaNarrativeEventRepository } from './NarrativeEventRepository.js';
import { PrismaPluginRepository } from './PluginRepository.js';
import { PrismaRelationshipGraphRepository } from './RelationshipGraphRepository.js';
import { PrismaSocialRepository } from './SocialRepository.js';

export function createPrismaRepositories(prisma: PrismaClient): Repositories {
  return {
    inference: new PrismaInferenceWorkflowRepository(prisma),
    identityOperator: new PrismaIdentityOperatorRepository(prisma),
    memory: new PrismaMemoryRepository(prisma),
    narrative: new PrismaNarrativeEventRepository(prisma),
    relationship: new PrismaRelationshipGraphRepository(prisma),
    plugin: new PrismaPluginRepository(prisma),
    agent: new PrismaAgentRepository(prisma),
    social: new PrismaSocialRepository(prisma),
    workflowRuns: new PrismaWorkflowRunRepository(prisma),
    workflowSteps: new PrismaWorkflowStepRunRepository(prisma)
  };
}
