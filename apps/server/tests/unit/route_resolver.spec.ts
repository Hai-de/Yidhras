import { describe, expect, it } from 'vitest';

import { resolveAiRoute } from '../../src/ai/route_resolver.js';

describe('resolveAiRoute', () => {
  it('resolves pack-aware route and prioritizes explicit model hint without failing when the hinted model is absent from route candidates', () => {
    const selected = resolveAiRoute({
      task_type: 'agent_decision',
      pack_id: 'world-death-note',
      response_mode: 'json_schema',
      route_hint: {
        provider: 'openai',
        model: 'missing-model'
      },
      task_override: {
        route: {
          provider: 'openai',
          model: 'gpt-4.1'
        }
      }
    });

    expect(selected.route.route_id).toBe('default.agent_decision');
    expect(selected.primary_model_candidates.length).toBeGreaterThan(0);
    expect(selected.primary_model_candidates[0]?.provider).toBe('openai');
  });

  it('supports context-summary route for intent grounding assist when no explicit route override is present', () => {
    const selected = resolveAiRoute({
      task_type: 'intent_grounding_assist',
      pack_id: 'world-death-note',
      response_mode: 'json_schema'
    });

    expect(selected.route.route_id).toBe('default.context_summary');
    expect(selected.route.task_types).toContain('intent_grounding_assist');
  });

  it('supports rerank route resolution through default.context_summary', () => {
    const selected = resolveAiRoute({ task_type: 'rerank', response_mode: 'json_object' });

    expect(selected.route.route_id).toBe('default.context_summary');
    expect(selected.route.task_types).toContain('rerank');
  });
});
