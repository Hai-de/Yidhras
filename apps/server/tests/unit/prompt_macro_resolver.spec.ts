import { describe, expect, it } from 'vitest';

import { renderNarrativeTemplate } from '../../src/narrative/resolver.js';
import {
  createPromptVariableContext,
  createPromptVariableLayer,
  normalizePromptVariableRecord
} from '../../src/narrative/variable_context.js';

const buildVariableContext = () => {
  return createPromptVariableContext({
    layers: [
      createPromptVariableLayer({
        namespace: 'system',
        values: normalizePromptVariableRecord({ name: 'Yidhras' }),
        alias_values: normalizePromptVariableRecord({ system_name: 'Yidhras' }),
        metadata: { source_label: 'system', trusted: true }
      }),
      createPromptVariableLayer({
        namespace: 'pack',
        values: normalizePromptVariableRecord({
          metadata: { name: '死亡笔记' },
          variables: { world_name: '死亡笔记世界', atmosphere: 'tense' }
        }),
        alias_values: normalizePromptVariableRecord({ world_name: '死亡笔记世界', atmosphere: 'tense' }),
        metadata: { source_label: 'pack', trusted: true }
      }),
      createPromptVariableLayer({
        namespace: 'runtime',
        values: normalizePromptVariableRecord({
          current_tick: '1000',
          owned_artifacts: [{ id: 'artifact-1' }, { id: 'artifact-2' }]
        }),
        alias_values: normalizePromptVariableRecord({ current_tick: '1000' }),
        metadata: { source_label: 'runtime', trusted: true }
      }),
      createPromptVariableLayer({
        namespace: 'actor',
        values: normalizePromptVariableRecord({
          display_name: '夜神月',
          role: 'active',
          has_bound_artifact: true,
          profile: {
            title: ''
          }
        }),
        alias_values: normalizePromptVariableRecord({ actor_name: '夜神月', actor_role: 'active' }),
        metadata: { source_label: 'actor', trusted: true }
      }),
      createPromptVariableLayer({
        namespace: 'request',
        values: normalizePromptVariableRecord({
          task_type: 'agent_decision',
          strategy: 'rule_based'
        }),
        alias_values: normalizePromptVariableRecord({ task_type: 'agent_decision', strategy: 'rule_based', actor_name: '请求侧别名' }),
        metadata: { source_label: 'request', trusted: true }
      })
    ]
  });
};

describe('prompt macro resolver', () => {
  it('resolves namespaced variables and records namespaces used', () => {
    const result = renderNarrativeTemplate({
      template: '世界：{{ pack.metadata.name }} / 角色：{{ actor.display_name }}',
      variableContext: buildVariableContext(),
      templateSource: 'unit.namespaced'
    });

    expect(result.text).toBe('世界：死亡笔记 / 角色：夜神月');
    expect(result.diagnostics.namespaces_used).toEqual(expect.arrayContaining(['pack', 'actor']));
    expect(result.diagnostics.missing_paths).toEqual([]);
  });

  it('applies alias precedence with request overriding actor alias', () => {
    const result = renderNarrativeTemplate({
      template: '别名命中：{{ actor_name }}',
      variableContext: buildVariableContext(),
      templateSource: 'unit.alias'
    });

    expect(result.text).toBe('别名命中：请求侧别名');
    expect(result.diagnostics.alias_fallback_count).toBe(1);
    expect(result.diagnostics.traces[0]?.resolved_layer).toBe('request');
  });

  it('supports default fallback syntax', () => {
    const result = renderNarrativeTemplate({
      template: '称号：{{ actor.profile.title | default("unknown") }}',
      variableContext: buildVariableContext(),
      templateSource: 'unit.default'
    });

    expect(result.text).toBe('称号：unknown');
    expect(result.diagnostics.traces.some(trace => trace.notes?.includes('default_applied'))).toBe(true);
  });

  it('supports if blocks', () => {
    const result = renderNarrativeTemplate({
      template: '状态{{#if actor.has_bound_artifact}}：持有媒介{{/if}}',
      variableContext: buildVariableContext(),
      templateSource: 'unit.if'
    });

    expect(result.text).toBe('状态：持有媒介');
    expect(result.diagnostics.blocks).toContainEqual(
      expect.objectContaining({
        kind: 'if',
        expression: 'actor.has_bound_artifact',
        executed: true
      })
    );
  });

  it('supports each blocks with local alias access', () => {
    const result = renderNarrativeTemplate({
      template: 'Artifacts:\n{{#each runtime.owned_artifacts as artifact}}- {{ artifact.id }}\n{{/each}}',
      variableContext: buildVariableContext(),
      templateSource: 'unit.each'
    });

    expect(result.text).toBe('Artifacts:\n- artifact-1\n- artifact-2\n');
    expect(result.diagnostics.blocks).toContainEqual(
      expect.objectContaining({
        kind: 'each',
        expression: 'runtime.owned_artifacts',
        executed: true,
        iteration_count: 2,
        alias: 'artifact'
      })
    );
  });

  it('returns restricted_or_missing marker for missing paths and records diagnostics', () => {
    const result = renderNarrativeTemplate({
      template: 'Missing={{ actor.unknown_field }}',
      variableContext: buildVariableContext(),
      templateSource: 'unit.missing'
    });

    expect(result.text).toBe('Missing=[RESTRICTED_OR_MISSING]');
    expect(result.diagnostics.missing_paths).toContain('actor.unknown_field');
  });

});
