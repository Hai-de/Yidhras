import { describe, expect, it } from 'vitest';

import { renderTemplateWithVariableContext, renderTemplateWithVisibleVariables } from '../../src/domain/perception/template_renderer.js';
import type { PermissionContext } from '../../src/permission/types.js';
import { renderNarrativeTemplate } from '../../src/template_engine/frontends/narrative/resolver.js';
import type { PromptVariableContext, PromptVariableRecord } from '../../src/template_engine/frontends/narrative/types.js';
import {
  createPromptVariableContext,
  createPromptVariableLayer,
  normalizePromptVariableRecord
} from '../../src/template_engine/frontends/narrative/variable_context.js';

const buildMultiLayerContext = (): PromptVariableContext => {
  return createPromptVariableContext({
    layers: [
      createPromptVariableLayer({
        namespace: 'system',
        values: normalizePromptVariableRecord({ version: '1.0.0' }),
        alias_values: normalizePromptVariableRecord({ system_version: '1.0.0' }),
        metadata: { source_label: 'system', trusted: true }
      }),
      createPromptVariableLayer({
        namespace: 'pack',
        values: normalizePromptVariableRecord({
          name: '测试世界包',
          settings: { difficulty: 'hard', permadeath: true }
        }),
        alias_values: normalizePromptVariableRecord({ pack_name: '测试世界包' }),
        metadata: { source_label: 'pack', trusted: true }
      }),
      createPromptVariableLayer({
        namespace: 'runtime',
        values: normalizePromptVariableRecord({
          tick: '2000',
          entities: [
            { id: 'e1', type: 'character', name: 'Alice' },
            { id: 'e2', type: 'character', name: 'Bob' },
            { id: 'e3', type: 'item', name: '钥匙' }
          ],
          flags: { combat_active: true, stealth_mode: false }
        }),
        alias_values: normalizePromptVariableRecord({ current_tick: '2000' }),
        metadata: { source_label: 'runtime', trusted: true }
      }),
      createPromptVariableLayer({
        namespace: 'actor',
        values: normalizePromptVariableRecord({
          id: 'agent-001',
          display_name: '测试角色',
          role: 'protagonist',
          stats: { hp: 80, max_hp: 100, mp: 50 },
          inventory: ['剑', '盾', '药水'],
          status: { alive: true, poisoned: false }
        }),
        alias_values: normalizePromptVariableRecord({
          actor_name: '测试角色',
          actor_role: 'protagonist'
        }),
        metadata: { source_label: 'actor', trusted: true }
      }),
      createPromptVariableLayer({
        namespace: 'request',
        values: normalizePromptVariableRecord({
          task_type: 'agent_decision',
          strategy: 'adaptive'
        }),
        alias_values: normalizePromptVariableRecord({ strategy: 'adaptive' }),
        metadata: { source_label: 'request', trusted: true }
      })
    ]
  });
};

describe('template engine — narrative frontend integration', () => {
  it('renders complex multi-namespace template with nested property access', () => {
    const result = renderNarrativeTemplate({
      template: [
        '世界: {{ pack.name }} (难度: {{ pack.settings.difficulty }})',
        '角色: {{ actor.display_name }} [{{ actor.role }}]',
        'HP: {{ actor.stats.hp }}/{{ actor.stats.max_hp }}',
        'Tick: {{ runtime.tick }}'
      ].join('\n'),
      variableContext: buildMultiLayerContext(),
      templateSource: 'integration.complex'
    });

    expect(result.text).toBe([
      '世界: 测试世界包 (难度: hard)',
      '角色: 测试角色 [protagonist]',
      'HP: 80/100',
      'Tick: 2000'
    ].join('\n'));
    expect(result.diagnostics.errors).toEqual([]);
  });

  it('resolves boolean values in #if blocks correctly', () => {
    const ctx = buildMultiLayerContext();

    const truthyResult = renderNarrativeTemplate({
      template: '{{#if runtime.flags.combat_active}}战斗中{{/if}}',
      variableContext: ctx
    });
    expect(truthyResult.text).toBe('战斗中');

    const falsyResult = renderNarrativeTemplate({
      template: '{{#if runtime.flags.stealth_mode}}隐匿中{{/if}}',
      variableContext: ctx
    });
    expect(falsyResult.text).toBe('');
  });

  it('supports #if with nested property access in condition', () => {
    const result = renderNarrativeTemplate({
      template: '{{#if actor.stats.hp}}HP存在{{/if}}',
      variableContext: buildMultiLayerContext()
    });

    expect(result.text).toBe('HP存在');
  });

  it('supports deeply nested #if blocks via AST parsing', () => {
    const result = renderNarrativeTemplate({
      template:
        '{{#if actor.status.alive}}' +
        '{{#if runtime.flags.combat_active}}' +
        '{{#if actor.stats.hp}}生存且战斗中{{/if}}' +
        '{{/if}}' +
        '{{/if}}',
      variableContext: buildMultiLayerContext()
    });

    expect(result.text).toBe('生存且战斗中');
  });

  it('supports #if / #else / #if combinations', () => {
    const result = renderNarrativeTemplate({
      template:
        '{{#if actor.status.poisoned}}中毒{{#else}}' +
        '{{#if actor.status.alive}}健康{{/if}}' +
        '{{/if}}',
      variableContext: buildMultiLayerContext()
    });

    expect(result.text).toBe('健康');
  });

  it('supports #each with complex object iteration', () => {
    const result = renderNarrativeTemplate({
      template:
        '角色列表:\n' +
        '{{#each runtime.entities as entity}}' +
        '- [{{ entity.type }}] {{ entity.name }}\n' +
        '{{/each}}',
      variableContext: buildMultiLayerContext()
    });

    expect(result.text).toBe(
      '角色列表:\n' +
      '- [character] Alice\n' +
      '- [character] Bob\n' +
      '- [item] 钥匙\n'
    );
  });

  it('supports #each with empty array (no output)', () => {
    const ctx = createPromptVariableContext({
      layers: [
        createPromptVariableLayer({
          namespace: 'runtime',
          values: normalizePromptVariableRecord({ empty_list: [] }),
          metadata: { source_label: 'runtime', trusted: true }
        })
      ]
    });

    const result = renderNarrativeTemplate({
      template: '前{{#each runtime.empty_list as item}}{{ item }}{{/each}}后',
      variableContext: ctx
    });

    expect(result.text).toBe('前后');
  });

  it('supports #with block for context switching', () => {
    const result = renderNarrativeTemplate({
      template:
        '{{#with actor.stats}}' +
        'HP: {{ hp }}/{{ max_hp }} MP: {{ mp }}' +
        '{{/with}}',
      variableContext: buildMultiLayerContext()
    });

    expect(result.text).toBe('HP: 80/100 MP: 50');
  });

  it('supports #with on nested object from namespace', () => {
    const result = renderNarrativeTemplate({
      template:
        '{{#with pack.settings}}' +
        '难度: {{ difficulty }}, 永久死亡: {{ permadeath }}' +
        '{{/with}}',
      variableContext: buildMultiLayerContext()
    });

    expect(result.text).toBe('难度: hard, 永久死亡: true');
  });

  it('records diagnostics for missing variables without embedding markers', () => {
    const result = renderNarrativeTemplate({
      template: 'A={{ actor.nonexistent }} B={{ pack.also_missing }}',
      variableContext: buildMultiLayerContext()
    });

    expect(result.text).toBe('A= B=');
    expect(result.diagnostics.missing_paths).toContain('actor.nonexistent');
    expect(result.diagnostics.missing_paths).toContain('pack.also_missing');
    // Must NOT contain legacy marker strings
    expect(result.text).not.toContain('RESTRICTED_OR_MISSING');
    expect(result.text).not.toContain('INVALID_TEMPLATE');
  });

  it('returns RenderResult with structured errors on parse failure', () => {
    const result = renderNarrativeTemplate({
      template: '{{#if x}}body{{/each}}',
      variableContext: buildMultiLayerContext()
    });

    expect(result.diagnostics.errors.length).toBeGreaterThan(0);
    expect(result.diagnostics.errors.some(
      (e) => e.code === 'UNMATCHED_BLOCK'
    )).toBe(true);
  });

  it('handles template with only static text (no expressions)', () => {
    const result = renderNarrativeTemplate({
      template: '这是纯文本，没有任何模板表达式。',
      variableContext: buildMultiLayerContext()
    });

    expect(result.text).toBe('这是纯文本，没有任何模板表达式。');
    expect(result.diagnostics.errors).toEqual([]);
    expect(result.diagnostics.traces).toEqual([]);
  });
});

describe('template engine — perception renderer integration', () => {
  const visibleVars: PromptVariableRecord = normalizePromptVariableRecord({
    world_name: '测试世界',
    actor_name: '主角',
    actor_hp: '75',
    faction: '反抗军'
  });

  it('renderTemplateWithVisibleVariables renders with permission=undefined', () => {
    const text = renderTemplateWithVisibleVariables(
      '世界: {{ pack.world_name }}, 角色: {{ pack.actor_name }}',
      visibleVars
    );

    expect(text).toBe('世界: 测试世界, 角色: 主角');
  });

  it('renderTemplateWithVisibleVariables passes extraContext as local scope', () => {
    const text = renderTemplateWithVisibleVariables(
      'HP: {{ actor_hp }}',
      visibleVars,
      { actor_hp: '100' }
    );

    expect(text).toBe('HP: 100');
  });

  it('renderTemplateWithVariableContext with multi-layer context', () => {
    const ctx = buildMultiLayerContext();
    const text = renderTemplateWithVariableContext(
      '{{ actor.display_name }} [{{ runtime.tick }}]',
      ctx
    );

    expect(text).toBe('测试角色 [2000]');
  });

  it('renderTemplateWithVariableContext with extraContext override', () => {
    const ctx = buildMultiLayerContext();
    const text = renderTemplateWithVariableContext(
      '{{ actor.display_name }} (override: {{ override_key }})',
      ctx,
      { override_key: '来自extraContext' }
    );

    expect(text).toBe('测试角色 (override: 来自extraContext)');
  });
});

describe('template engine — permission integration', () => {
  it('renderTemplateWithVisibleVariables passes permission context through', () => {
    const permission: PermissionContext = {
      agent_id: 'agent-001',
      circles: new Set(['red_circle']),
      global_level: 0
    };

    const text = renderTemplateWithVisibleVariables(
      '{{ pack.world_name }}',
      normalizePromptVariableRecord({ world_name: '可见世界' }),
      {},
      permission
    );

    expect(text).toBe('可见世界');
  });

  it('renderNarrativeTemplate accepts permission parameter', () => {
    const ctx = createPromptVariableContext({
      layers: [
        createPromptVariableLayer({
          namespace: 'pack',
          values: normalizePromptVariableRecord({ public_info: '公开信息' }),
          metadata: { source_label: 'pack', trusted: true }
        })
      ]
    });

    const result = renderNarrativeTemplate({
      template: '{{ pack.public_info }}',
      variableContext: ctx,
      permission: {
        agent_id: 'test',
        circles: new Set([]),
        global_level: 0
      }
    });

    expect(result.text).toBe('公开信息');
  });
});
