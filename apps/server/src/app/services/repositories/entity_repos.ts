import type { AgentRepository } from './AgentRepository.js';
import type { IdentityOperatorRepository } from './IdentityOperatorRepository.js';
import type { MemoryRepository } from './MemoryRepository.js';
import type { NarrativeEventRepository } from './NarrativeEventRepository.js';
import type { RelationshipGraphRepository } from './RelationshipGraphRepository.js';
import type { SocialRepository } from './SocialRepository.js';

export interface EntityRepositories {
  readonly agent: AgentRepository;
  readonly identityOperator: IdentityOperatorRepository;
  readonly relationship: RelationshipGraphRepository;
  readonly memory: MemoryRepository;
  readonly narrative: NarrativeEventRepository;
  readonly social: SocialRepository;
}
