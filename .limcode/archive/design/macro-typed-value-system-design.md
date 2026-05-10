# 宏系统真类型支持

**状态：已实现（2026-05-11）** | 实施计划：`.limcode/plans/macro-typed-value-system-implementation.plan.md`

## 现状问题

核心类型定义 `types.ts:37,58-62` 将所有宏参数和返回值限定为 `string`：

```typescript
// 现状 — 全部是字符串
interface MacroNode {
  type: 'macro';
  name: string;
  args: Record<string, string>;       // 参数只能传字符串
  body?: AstNode[];                    // 声明了但 parser 从未填充
}
type MacroHandlerFn = (
  name: string,
  args: Record<string, string>,
  scope: RenderScope
) => string;                           // 返回值只能是字符串
```

连锁反应：

1. **Parser** (`parser.ts:30-49`) 用空格分割和 `=` 匹配解析参数，无法识别数字、布尔、数组字面量
2. **Renderer** (`renderer.ts:5-20`) 的 `toString()` 把 number/boolean/bigint 全强转为字符串
3. **内置宏** (`defaults.ts`) `int`/`float` 返回 `String(result)`，`pick` 返回逗号拼接字符串
4. **`expandStateJson()`** (`template_expander.ts:40-55`) 展开 `"{{int min=1 max=10}}"` → 字符串 `"7"` 而非数字 `7`，JSON 类型丢失
5. **`ModifierSpec.args: string[]`** (`types.ts:51`) 修饰器参数也是全字符串

实际世界包配置中的表现：

```yaml
# snowbound_mansion/config.yaml
is_mastermind: "{{pick from=false,false,false,false,false,false,false,false,false,true,false}}"
masterminds_alive: "{{int min=1 max=3}}"
```

布尔值用逗号分隔字符串里的 `"false"`/`"true"` 模拟，数字用字符串模板产出字符串。

---

## 目标状态

### 新增 `MacroValue` 类型

```typescript
// 递归类型：对标 JSON 但不出现在 JSON 中的值用 undefined
type MacroPrimitive = string | number | boolean | null;
type MacroValue = MacroPrimitive | MacroValue[] | { [key: string]: MacroValue };
```

### AST 节点改动

```typescript
interface MacroNode {
  type: 'macro';
  name: string;
  args: Record<string, MacroValue>;
  body?: AstNode[];                    // parser 实际填充
}

interface ModifierSpec {
  name: string;
  args: MacroValue[];
}

type MacroHandlerFn = (
  name: string,
  args: Record<string, MacroValue>,
  scope: RenderScope
) => MacroValue;                       // 可返回任意类型
```

### 宏语法扩展

```
现状                         目标
──────────────────────────────────────────────────────
{{int min=1 max=10}}         {{int min=1 max=10}}         ← 数字字面量
{{int min=1 max=10}}         返回值 "7" → 7               ← 类型保留
{{pick from=a,b,c}}          {{pick from=["a","b","c"]}}  ← 数组字面量
{{pick from=a,b,c}}          返回值 "a" → "a"             ← 单元素仍为字符串
{{pick from=a,b,c count=2}}  返回值 "a,c" → ["a","c"]     ← 多元素返回数组
is_mastermind: "{{pick...    直接用布尔数组                ← 不需要字符串模拟
  from=false,false,...,       {{pick from=[false,false,
  true,false}}"               true,false]}}
n/a                           {{if condition=true}}       ← 布尔字面量
n/a                           {{macro arg={a:1,b:2}}}    ← 对象字面量
n/a                           {{#macro arg=value}}        ← 块级宏（body 填充）
                                body content
                              {{/macro}}
```

### `expandStateJson()` 行为

```
输入 JSON                       展开后
──────────────────────────────────────────────────────
{"count": "{{int min=1 max=10}}"}   {"count": 7}         ← 数字保留
{"flag": "{{pick from=[true,false]}}"}  {"flag": true}   ← 布尔保留
{"items": "{{pick from=[a,b,c] count=2}}"}  {"items": ["a","b"]}  ← 数组保留
{"name": "{{pick from=[Alice,Bob]}}"}  {"name": "Alice"} ← 单值字符串
```

逻辑：字符串包含 `{{` → 展开 → 如果整个字符串就是单个宏调用且返回非字符串，替换原值；否则 `toString()` 后替换字符串内容。

---

## 受影响文件清单

### 直接影响（必须改）

| # | 文件 | 改动内容 |
|---|---|---|
| 1 | `apps/server/src/template_engine/core/types.ts` | 新增 `MacroValue` 类型；`MacroNode.args` 改为 `Record<string, MacroValue>`；`MacroHandlerFn` 返回 `MacroValue`；`ModifierSpec.args` 改为 `MacroValue[]`；`ModifierFn` 参数改为 `MacroValue[]`；`RenderScope` 中 renderFn 返回类型扩展 |
| 2 | `apps/server/src/template_engine/core/lexer.ts` | 新增 token 类型：`NUMBER`、`BOOLEAN`、`NULL_LITERAL`、`STRING_LITERAL`、`LBRACKET`、`RBRACKET`、`LBRACE`、`RBRACE`、`COMMA`、`COLON`；或保持简单 lexer，在 parser 层做字面量识别 |
| 3 | `apps/server/src/template_engine/core/parser.ts` | 重写 `parseMacroExpression()` 为递归下降解析器；支持数字/布尔/null/字符串/数组/对象字面量；填充 `MacroNode.body`（块级宏支持） |
| 4 | `apps/server/src/template_engine/core/renderer.ts` | `applyModifiers` 返回 `unknown` 而非 `string`；`toString()` 推迟到最后文本拼接层；macro 节点渲染保留返回值类型 |
| 5 | `apps/server/src/template_engine/defaults.ts` | `roll`/`int`/`float` 返回 `number`；`pick` 单元素返回 `string`，多元素返回 `string[]`；内置 modifier 适配 `MacroValue[]` 参数 |
| 6 | `apps/server/src/packs/runtime/template_expander.ts` | 核心改动：字符串展开时检测返回值是否为非字符串，是整个字符串等于单个宏调用时替换值类型，否则 `toString()` 内联 |
| 7 | `apps/server/src/template_engine/frontends/narrative/resolver.ts` | `parseModifierExpression()` 适配新参数类型；`toString()` 处理 `MacroValue` 返回值；宏回退路径（未注册宏当作变量）保持兼容 |
| 8 | `apps/server/src/template_engine/frontends/narrative/resolvers.ts` | `applyDefaultModifier` 的 `fallbackLiteral` 从 `string` 改为 `MacroValue`；`parseLiteralValue` 已正确支持 typed，不改 |

### 间接影响（签名兼容性适配）

| # | 文件 | 影响原因 |
|---|---|---|
| 9 | `apps/server/src/packs/runtime/materializer.ts` | 使用 `BUILTIN_MACRO_HANDLERS` 和 `expandStateJson()`，handler 签名变了；`RenderScope` 构造需要适配；state_json 中值类型可能从 string 变为 number/boolean/array |
| 10 | `apps/server/src/template_engine/frontends/narrative/blocks.ts` | `BlockHandlerFn` 兼容；`resolveNarrativeVar` 已返回 `unknown`，不改；`isTruthyMacroValue` 已支持 typed，不改 |
| 11 | `apps/server/src/template_engine/frontends/narrative/variable_context.ts` | `detectPromptVariableValueType()` 已支持完整类型体系，不改；可能需确认 `normalizePromptVariableRecord` 行为不变 |
| 12 | `apps/server/src/template_engine/frontends/narrative/types.ts` | `PromptVariableValue` 已支持完整类型体系，不改；如需对外暴露 `MacroValue` 则此处导出 |
| 13 | `apps/server/src/template_engine/frontends/data_cleaner/index.ts` | 包装核心 `renderAst`，返回类型如需保持 `string` 则内部做 `toString()` |
| 14 | `apps/server/src/template_engine/frontends/slot_function/blocks.ts` | 使用 `BlockHandlerFn` 签名，不改（blocks 仍返回 string） |
| 15 | `apps/server/src/template_engine/frontends/slot_function/types.ts` | 不改 |
| 16 | `apps/server/src/domain/perception/template_renderer.ts` | 调用 `renderNarrativeTemplate()`，消费 `.text` 字段，不改 |
| 17 | `apps/server/src/inference/prompt_block.ts` | `PromptBlockContent.macro_ref.default_value` 类型可考虑从 `string \| null` 扩展到 `MacroValue`（可选增强） |
| 18 | `apps/server/src/inference/prompt_tree.ts` | `renderSlotText()` 装饰性调用，不改 |
| 19 | `apps/server/src/inference/prompt_builder_v2.ts` | 不变 |
| 20 | `apps/server/src/conversation/assembler.ts` | 不变 |

### 测试（必须更新）

| # | 文件 | 改动内容 |
|---|---|---|
| 21 | `apps/server/tests/unit/template_engine_macro.spec.ts` | 全覆盖 typed 行为：`int`/`float` 返回 number；`pick` 单/多元素返回 string/string[]；数组/布尔/null 字面量解析；`expandStateJson` 类型保留 |
| 22 | `apps/server/tests/unit/prompt_macro_resolver.spec.ts` | 新增 typed 变量引用测试；`default` modifier typed fallback |
| 23 | `apps/server/tests/unit/structured_parser.spec.ts` | 新增字面量解析测试：数字/布尔/null/字符串/数组/对象字面量 |
| 24 | `apps/server/tests/integration/template_engine_narrative.spec.ts` | 端到端 typed 行为验证 |
| 25 | `apps/server/tests/integration/template_engine_data_cleaner.spec.ts` | 验证类型穿越或 toString 策略 |
| 26 | `apps/server/tests/unit/template_engine_plugin.spec.ts` | 签名兼容性 |
| 27 | `apps/server/tests/unit/template_track.spec.ts` | 不变 |

### 数据文件（需要迁移）

| # | 文件 | 改动内容 |
|---|---|---|
| 28 | `data/world_packs/snowbound_mansion/config.yaml` | `pick from=false,false,...` → `pick from=[false,false,...]`；`int`/`float` 参数不再引号包裹（可选） |
| 29 | `data/world_packs/death_note/config.yaml` | 检查 `{{pack.variables.xxx}}` 引用是否需要适配 |
| 30 | `data/world_packs/world-death-note/config.yaml` | 同 death_note |

### 参考文档

| # | 文件 | 变更 |
|---|---|---|
| 31 | `.limcode/archive/design/world-pack-prompt-macro-variable-formalization-design.md` | 不修改（历史档案），本草案作为该设计的修正案 |

---

## 实现策略

### 阶段 1：核心类型系统 + 解析器 + 渲染器

**范围**：文件 1-5, 7-8
**产物**：`MacroValue` 类型体系、字面量解析、typed 宏返回值、typed modifier 参数
**不改变**：任何 handler 的实现逻辑（仍然返回字面量，只是类型标注变化）
**测试**：文件 21-23 的核心测试

### 阶段 2：内置宏和 expandStateJson 升级

**范围**：文件 5-6
**产物**：`int`/`float`/`roll` 返回 `number`；`pick` 返回 `string` 或 `string[]`；`expandStateJson` 类型保留
**测试**：文件 21 的 expandStateJson 测试更新

### 阶段 3：块级宏支持（MacroNode.body）

**范围**：文件 1, 3, 4
**产物**：parser 解析 `{{#macroname arg=value}} body {{/macroname}}`，填充 body；renderer 支持块级宏
**注意**：此项为新增能力，不影响现有行为。可在阶段 1 完成后评估是否有立即需求

### 阶段 4：世界包数据迁移 + 集成测试

**范围**：文件 28-30；测试文件 24-25
**产物**：所有现网 world pack 配置迁移到新语法，全量集成测试通过

---

## 不做的

- 宏内算术表达式（`{{ 1 + 2 }}`）→ 保持安全边界，宏只能调用注册的 handler
- 宏自定义注册（pack author 写自己的 handler）→ 保持关闭
- 变量写入 / 宏副作用 → 保持纯函数语义
- 完整的 JSON 对象字面量语法 → 仅支持 `{key: value, ...}` 浅层对象，key 不加引号，不支持嵌套对象字面量（可通过变量引用传递嵌套结构）
