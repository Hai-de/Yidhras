# 物化阶段宏参数变量引用支持

> 上下文：snowbound_mansion 升级中 Step 11 被阻塞 — `{{pick from=pack.variables.names}}` 无法解析为数组。
> 对应的 TODO.md 条目："物化阶段宏参数变量引用"。

---

## 问题诊断

当前引擎在物化阶段存在**两个独立但耦合的断裂**：

### 断裂 1: entity state 宏从未被展开（P0，预存 bug）

DB 验证 (`runtime.sqlite`):
```
char_01 | core | {{pick from=['张伟','李娜',...]}}
```
原始模板字符串被逐字存入数据库，entity state 的 `{{pick}}` 完全无效。

根因：`materializer.ts:102` 直接写 `actor.state`，不像 bootstrap 那样经过 `expandStateJson`。

影响范围：
- `entities.yaml` 中所有 actor/artifact/domain/institution 的 `state` 字段
- snowbound_mansion 的 12 个角色的 name/personality/profession/secret/is_mastermind 全部是模板字面量

### 断裂 2: 宏参数不解析变量引用（P1，本次需求）

即使 entity state 走 `expandStateJson`，`{{pick from=pack.variables.names}}` 中的 `pack.variables.names` 也不会被解析。三层根因：
1. `materializer.ts:197` — `RenderScope.variables` 显式为 `{}`
2. `template_expander.ts:47-52` — 单宏快捷路径绕过 `renderAst()` 变量解析
3. `parser.ts:27` — `isIdentCont` 含 `.`，点分路径被词法为单个 `IDENT`

### 断裂 1 为什么一直没被发现

entity state 宏展开是整个引擎从未工作过的路径。snowbound_mansion 出现前，没有 pack 在 entity state 中使用 `{{pick}}`（world-death-note 只在 bootstrap 中用）。验证命令 (`validate:pack`) 只校验 schema，不检查 DB 内容。

---

## 修复方案

### 修改 1: materializer.ts — entity state 走 expandStateJson

```
文件: apps/server/src/packs/runtime/materializer.ts
```

在 actor/artifact/domain/institution 循环中，对 `state` 字段应用 `expandStateJson`：

```typescript
// 将 expandScope 的构建前置到 entity state 循环之前
const seed = (pack.variables?.seed as string | undefined) ?? randomUUID();
const prng = createPRNG(seed);
const expandScope: RenderScope = {
  variables: {
    pack: {
      variables: pack.variables ?? {}
    }
  },
  modifiers: {},
  blockHandlers: {},
  macroHandlers: BUILTIN_MACRO_HANDLERS,
  prng,
  depth: 0,
  maxDepth: 32
};

// Actor 循环（行 92-104）
for (const actor of pack.entities?.actors ?? []) {
  // ... putWorldEntity 不变 ...
  if (actor.state) {
    const expandedState = expandStateJson(actor.state, expandScope);
    putEntityState(createEntityStateInput(packId, actor.id, 'core', expandedState, now));
  }
}

// 同样模式应用于 artifact (行 115-117)、domain (行 129-131)、institution (行 143-145)
```

关键变更：
- `expandScope` 构建从行 196 移到 entity state 循环之前
- `variables` 注入 `{ pack: { variables: pack.variables } }` 以支持 `pack.variables.*` 路径
- entity state 在写入前经过 `expandStateJson`

### 修改 2: template_expander.ts — 宏参数变量解析

```
文件: apps/server/src/packs/runtime/template_expander.ts
```

在 `expandMacroValue` 中，调用宏 handler 前解析 args 中的变量引用：

```typescript
// 新增工具函数
const resolveNestedValue = (path: string, variables: Record<string, unknown>): unknown => {
  const parts = path.split('.');
  let current: unknown = variables;
  for (const part of parts) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
};

const resolveMacroArgs = (
  args: Record<string, MacroValue>,
  scope: RenderScope
): Record<string, MacroValue> => {
  const resolved: Record<string, MacroValue> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string' && value.includes('.') && !value.includes(',')) {
      const resolvedVal = resolveNestedValue(value, scope.variables);
      resolved[key] = resolvedVal !== undefined ? resolvedVal as MacroValue : value;
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
};
```

修改 `expandMacroValue` 行 47-52：

```typescript
if (nodes.length === 1 && nodes[0].type === 'macro' && scope.macroHandlers?.[nodes[0].name]) {
  const resolvedArgs = resolveMacroArgs(nodes[0].args, scope);
  return scope.macroHandlers[nodes[0].name](nodes[0].name, resolvedArgs, scope);
}
```

### 修改 3: materializer.ts — 移除 expandScope 重复构建

原行 194-204 的 `expandScope` 将不再需要（已前置）。bootstrap 循环直接复用同一个 scope。

### 修改 4: entities.yaml / bootstrap.yaml — 替换内联数组为变量引用

```
文件: data/world_packs/snowbound_mansion/config/entities.yaml
      data/world_packs/snowbound_mansion/config/bootstrap.yaml
```

修改 1-3 完成后，以下语法生效：
```yaml
# entities.yaml — actor state
name: "{{pick from=pack.variables.names}}"
personality: "{{pick from=pack.variables.personalities}}"
profession: "{{pick from=pack.variables.professions}}"
secret: "{{pick from=pack.variables.secrets}}"

# bootstrap.yaml — world state
scenario: "{{pick from=pack.variables.scenarios}}"
location_type: "{{pick from=pack.variables.location_types}}"
team_dynamic: "{{pick from=pack.variables.team_dynamics}}"
```

消除 12 角色 × 5 字段 + 3 个 bootstrap 字段 = 63 处内联数组重复。

---

## 风险与边界

### 向后兼容
- `{{pick from=a,b,c}}` 不含 `.`，`resolveNestedValue` 不触发 → 保持逗号分隔行为
- `{{pick from=['a','b','c']}}` 是数组 literal，`resolveNestedValue` 只处理 string 类型 → 不触发
- 现有测试中任何使用 entity state 宏的 pack 将首次获得真正的随机值

### 幂等性
`expandStateJson` 是幂等的 —— 展开后的值不再含 `{{`，再次调用返回自身。seed 在物化阶段固定，同 seed 产生相同结果。

### PRNG 一致性
entity state 和 bootstrap state 共享同一个 `prng` 实例，调用顺序会影响结果。当前顺序：entity states → bootstrap states。如果变更为先 bootstrap 后 entity，相同 seed 会产生不同结果。需要固定顺序并文档化。

### renderAst 兼容
`renderAst` 已支持 `{{ variable.path }}` 解析。如果将来有混合模板（`{{pick from=...}} + {{text}}`），不走单宏快捷路径时会走 `renderAst`，其变量解析路径无需修改。

### 性能
- `resolveNestedValue` 对每个宏参数执行一次 O(depth) 的对象遍历，depth ≤ 3
- `expandStateJson` 对每个 entity state 递归遍历，state 对象规模通常 < 20 个 key
- 影响可忽略

---

## 验证计划

### 单元测试
1. `template_expander.test.ts`：`resolveNestedValue` 路径解析
2. `template_expander.test.ts`：`expandMacroValue` 中 `pick from=pack.variables.xxx` 正确解析为数组并随机选取
3. `materializer.test.ts`：entity state 经过 `expandStateJson` 展开

### 集成测试
4. 重置 DB 后检查 `entity_states` 表中 `state_json` 不再包含 `{{pick` 模板字符串
5. snowbound_mansion 的 12 个角色 name/personality/profession/secret 全部为展开后的具体值
6. 同一 seed 两次物化产生相同的随机结果

### 验证命令
```bash
pnpm --filter yidhras-server test:unit
pnpm --filter yidhras-server test:integration
pnpm --filter yidhras-server reset:dev-db
sqlite3 data/world_packs/snowbound_mansion/runtime.sqlite \
  "SELECT entity_id, json_extract(state_json, '$.name') FROM entity_states WHERE state_namespace='core' LIMIT 3;"
# 预期：具体中文名字，不是 {{pick from=...}}
pnpm --filter yidhras-server validate:pack data/world_packs/snowbound_mansion
pnpm typecheck
```

---

## 不在此次范围内

- `pack.metadata` 或 `pack` 下其他非 `variables` 路径的变量引用 — 作用域只注入 `pack.variables`，可按需扩展
- `{{#if}}` / `{{#each}}` 块中的变量引用 — 当前 block handler 路径不动
- 推理阶段的变量解析 (`resolveConfigValues`) — 独立机制，不受影响
