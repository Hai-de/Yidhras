import { AccessLevel, PermissionContext } from '../../src/permission/types.js';
import { renderNarrativeTemplate } from '../../src/template_engine/frontends/narrative/resolver.js';
import { createPromptVariableContext, createPromptVariableLayer, normalizePromptVariableRecord } from '../../src/template_engine/frontends/narrative/variable_context.js';

const civilian: PermissionContext = {
  agent_id: 'agent-001',
  circles: new Set([]),
  global_level: AccessLevel.PUBLIC
};

const operative: PermissionContext = {
  agent_id: 'agent-002',
  circles: new Set(['black_ops']),
  global_level: AccessLevel.PROTECTED
};

const admin: PermissionContext = {
  agent_id: 'agent-003',
  circles: new Set([]),
  global_level: AccessLevel.SECRET
};

const buildContext = (permission: PermissionContext) => {
  const allVars = {
    public_news: '天气晴朗',
    secret_code: 'XY-772',
    org_mission: '渗透底座区'
  };

  const visibleVars: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(allVars)) {
    if (key === 'public_news') {
      visibleVars[key] = value;
    } else if (key === 'secret_code' && permission.global_level >= AccessLevel.SECRET) {
      visibleVars[key] = value;
    } else if (key === 'org_mission' && (
      permission.global_level >= AccessLevel.PROTECTED || permission.circles.has('black_ops')
    )) {
      visibleVars[key] = value;
    }
  }

  return createPromptVariableContext({
    layers: [
      createPromptVariableLayer({
        namespace: 'pack',
        values: normalizePromptVariableRecord(visibleVars),
        alias_values: normalizePromptVariableRecord(visibleVars),
        metadata: { source_label: 'permission-demo', trusted: true }
      })
    ]
  });
};

const template = '简报: {{public_news}} | 代码: {{secret_code}} | 任务: {{org_mission}}';

console.log('--- 权限过滤验证 ---');
console.log('平民 (Public):', renderNarrativeTemplate({ template, variableContext: buildContext(civilian) }).text);
console.log('特工 (Black Ops):', renderNarrativeTemplate({ template, variableContext: buildContext(operative) }).text);
console.log('管理员 (Secret):', renderNarrativeTemplate({ template, variableContext: buildContext(admin) }).text);

console.log('\n--- 安全性验证 ---');
console.log('非法占位符:', renderNarrativeTemplate({ template: '测试非法 {{ $$$ }} 内容', variableContext: buildContext(civilian) }).text);
console.log('不存在变量:', renderNarrativeTemplate({ template: '测试缺失 {{ nonexistent }} 内容', variableContext: buildContext(civilian) }).text);
