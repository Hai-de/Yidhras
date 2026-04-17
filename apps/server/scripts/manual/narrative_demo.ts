import { renderNarrativeTemplate } from '../../src/narrative/resolver.js';
import {
  createPromptVariableContext,
  createPromptVariableLayer,
  normalizePromptVariableRecord
} from '../../src/narrative/variable_context.js';

const variableContext = createPromptVariableContext({
  layers: [
    createPromptVariableLayer({
      namespace: 'pack',
      values: normalizePromptVariableRecord({
        metadata: {
          name: '叙事演示世界'
        },
        variables: {
          currency: '信用点',
          governance: '联合议会',
          location_suffix: '区',
          main_location: '底座{{ pack.variables.location_suffix }}',
          system_status: '当前社会由 {{ pack.variables.governance }} 统治，{{ pack.variables.main_location }} 处于高度戒严。'
        }
      }),
      alias_values: normalizePromptVariableRecord({
        currency: '信用点',
        governance: '联合议会',
        location_suffix: '区',
        main_location: '底座{{ pack.variables.location_suffix }}',
        system_status: '当前社会由 {{ pack.variables.governance }} 统治，{{ pack.variables.main_location }} 处于高度戒严。'
      }),
      metadata: {
        source_label: 'manual-demo-pack',
        trusted: true
      }
    }),
    createPromptVariableLayer({
      namespace: 'runtime',
      values: normalizePromptVariableRecord({
        current_tick: '1000',
        owned_artifacts: [{ id: 'artifact-alpha' }, { id: 'artifact-beta' }]
      }),
      alias_values: normalizePromptVariableRecord({ current_tick: '1000' }),
      metadata: {
        source_label: 'manual-demo-runtime',
        trusted: true
      }
    }),
    createPromptVariableLayer({
      namespace: 'actor',
      values: normalizePromptVariableRecord({
        display_name: '演示主体',
        has_bound_artifact: true,
        profile: {
          title: ''
        }
      }),
      alias_values: normalizePromptVariableRecord({ actor_name: '演示主体' }),
      metadata: {
        source_label: 'manual-demo-actor',
        trusted: true
      }
    }),
    createPromptVariableLayer({
      namespace: 'request',
      values: normalizePromptVariableRecord({
        strategy: 'rule_based'
      }),
      alias_values: normalizePromptVariableRecord({ strategy: 'rule_based' }),
      metadata: {
        source_label: 'manual-demo-request',
        trusted: true
      }
    })
  ]
});

console.log('--- 嵌套解析验证 ---');
const promptTemplate = '欢迎来到 {{ pack.metadata.name }}。{{ pack.variables.system_status }} 记住，你的钱包里只有 {{ pack.variables.currency }}。';
const resolvedResult = renderNarrativeTemplate({
  template: promptTemplate,
  variableContext,
  templateSource: 'manual.narrative.demo'
});
console.log('原始模板:', promptTemplate);
console.log('解析结果:', resolvedResult.text);
console.log('诊断:', resolvedResult.diagnostics);

console.log('\n--- 动态变量覆盖验证 ---');
const overrideResult = renderNarrativeTemplate({
  template: '当前位置: {{ pack.variables.main_location }}',
  variableContext,
  extraContext: { main_location: '外部区域' },
  templateSource: 'manual.narrative.override'
});
console.log('覆盖前: 底座区 (从变量池)');
console.log('覆盖后:', overrideResult.text);

console.log('\n--- default / if / each 验证 ---');
const macroResult = renderNarrativeTemplate({
  template: [
    '称号={{ actor.profile.title | default("unknown") }}',
    '{{#if actor.has_bound_artifact}}持有关键媒介{{/if}}',
    '{{#each runtime.owned_artifacts as artifact}}- {{ artifact.id }}\n{{/each}}'
  ].join('\n'),
  variableContext,
  templateSource: 'manual.narrative.macro'
});
console.log(macroResult.text);
console.log(macroResult.diagnostics);
