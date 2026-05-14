import type { PerceptionRuleEngine } from './rule_engine.js';
import type { PerceptionResolver } from './types.js';

/**
 * Rule-based perception resolver — thin wrapper around PerceptionRuleEngine.
 *
 * Delegates all perception decisions to the engine, which evaluates
 * `rules.perception` from pack config (or built-in defaults).
 */
export const createRuleBasedPerceptionResolver = (
  engine: PerceptionRuleEngine
): PerceptionResolver => ({
  async resolve(input) {
    return engine.evaluate(input);
  }
});
