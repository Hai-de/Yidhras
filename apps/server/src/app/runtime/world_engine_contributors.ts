export {
  type StepContribution,
  type StepContributor,
  type RuleContribution,
  type RuleContributor,
  type QueryContribution,
  type QueryContributor,
  type WorldEngineSessionContext
} from '@yidhras/contracts';

import type {
  StepContributor,
  RuleContributor,
  QueryContributor
} from '@yidhras/contracts';

/**
 * Registry that holds all world-engine contributors.
 *
 * The TypeScript world-engine adapter uses this to compose
 * contributions from built-in logic and registered plugins.
 */
export interface WorldEngineContributorRegistry {
  registerStepContributor(contributor: StepContributor): void;
  registerRuleContributor(contributor: RuleContributor): void;
  registerQueryContributor(contributor: QueryContributor): void;

  readonly stepContributors: ReadonlyArray<StepContributor>;
  readonly ruleContributors: ReadonlyArray<RuleContributor>;
  readonly queryContributors: ReadonlyArray<QueryContributor>;
}

/**
 * Factory for a contributor registry backed by in-memory arrays.
 */
export const createWorldEngineContributorRegistry = (): WorldEngineContributorRegistry => {
  const stepContributors: StepContributor[] = [];
  const ruleContributors: RuleContributor[] = [];
  const queryContributors: QueryContributor[] = [];

  const sortByPriority = <T extends { priority: number }>(list: T[]): T[] => {
    return [...list].sort((a, b) => a.priority - b.priority);
  };

  return {
    registerStepContributor(contributor) {
      stepContributors.push(contributor);
    },
    registerRuleContributor(contributor) {
      ruleContributors.push(contributor);
    },
    registerQueryContributor(contributor) {
      queryContributors.push(contributor);
    },
    get stepContributors() {
      return sortByPriority(stepContributors);
    },
    get ruleContributors() {
      return sortByPriority(ruleContributors);
    },
    get queryContributors() {
      return sortByPriority(queryContributors);
    }
  };
};
