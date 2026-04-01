import { NarrativeResolver } from '../../src/narrative/resolver.js';
import { AccessLevel, PermissionContext } from '../../src/permission/types.js';

const resolver = new NarrativeResolver();
resolver.updateVariables(
  {
    public_news: '天气晴朗',
    secret_code: 'XY-772',
    org_mission: '渗透底座区'
  },
  {
    secret_code: { id: 'sc', min_level: AccessLevel.SECRET },
    org_mission: { id: 'om', min_level: AccessLevel.PROTECTED, circle_id: 'black_ops' }
  }
);

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

const template = '简报: {{public_news}} | 代码: {{secret_code}} | 任务: {{org_mission}}';

console.log('--- 权限过滤验证 ---');
console.log('平民 (Public):', resolver.resolve(template, {}, civilian));
console.log('特工 (Black Ops):', resolver.resolve(template, {}, operative));
console.log('管理员 (Secret):', resolver.resolve(template, {}, admin));

console.log('\n--- 安全性验证 ---');
console.log('非法占位符:', resolver.resolve('测试非法 {{ $$$ }} 内容'));
console.log('不存在变量:', resolver.resolve('测试缺失 {{ nonexistent }} 内容'));
