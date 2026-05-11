# Template Engine / 模板引擎

共享内核 + 领域前端的模板解析与渲染引擎。支持变量插值、修饰符链、条件/迭代块，语法由配置定义。

Key concepts:

- **Shared kernel + domain frontends** — `template_engine/core/` 提供 lexer → parser → renderer 流水线，`template_engine/frontends/` 下各领域前端注入变量解析、块处理器和语法配置
- **Configurable syntax** — 分隔符、修饰符链、块关键字全在 `SyntaxConfig` 中定义。Data Cleaner 前端默认 `{...}` / `{{...}}`，Narrative 前端默认 `{{...}}`
- **Two usage modes** — `render()` 一步渲染；`parse() → 操作 AST → renderAst()` 两步操作
- **Modifier pipeline** — `{var|upper|trim|default("N/A")}`，修饰符链式执行，支持自定义注册
- **Block handlers** — `if/else`、`each`、`with` 内置块，可通过 `createParser()` 注册自定义块处理器
- **Domain frontends** — Data Cleaner（flat key lookup + 管道链）、Narrative（8 层命名空间变量解析）、Slot Function（slot 注册表引用）

本文档集中说明共享内核的 API、语法配置、修饰符/块系统以及各领域前端的使用方式。

## 1. 文档定位

本文件回答：

- 模板引擎的公共 API 有哪些，如何选择 `render()` vs `parse()` vs `createParser()`
- 默认语法规则是什么，如何配置自定义语法
- 内置修饰符和块处理器的完整列表及行为
- 如何注册自定义修饰符和块处理器
- 各领域前端（Data Cleaner、Narrative、Slot Function）的职责与使用方式

本文件不负责：

- DataCleaner 注册表与插件生命周期：看 `PLUGIN_RUNTIME.md`
- Prompt Workflow 中 slot 与 section draft 的关系：看 `PROMPT_WORKFLOW.md`
- Narrative 变量上下文的 8 层命名空间解析细节：看 `../LOGIC.md`

## 2. 架构概览

```
apps/server/src/template_engine/
├── core/                       # 共享内核 — tokenize → parse → renderAst
│   ├── lexer.ts                # 通用 tokenizer
│   ├── parser.ts               # AST 构建器（栈式解析，支持嵌套）
│   ├── renderer.ts              # 递归渲染骨架
│   └── types.ts                 # AstNode, Token, RenderScope, SyntaxConfig 等
├── defaults.ts                  # 默认语法配置 + 内置修饰符 + 内置块处理器
├── frontends/
│   ├── data_cleaner/            # Data Cleaner 前端（{ } 语法，flat key lookup）
│   │   └── index.ts
│   ├── narrative/               # Narrative 前端（{{ }} 语法，8 层命名空间解析）
│   │   ├── resolver.ts          # renderNarrativeTemplate 入口
│   │   ├── variable_context.ts  # PromptVariableContext 构建与查找
│   │   ├── resolvers.ts         # Narrative VariableResolver
│   │   ├── blocks.ts            # if/else, each, with 块处理器
│   │   └── types.ts             # PromptVariableLayer, PromptVariableContext 等
│   └── slot_function/           # Slot Function 前端（slot 引用与作用域）
│       ├── types.ts             # SlotRegistration, SlotRegistry
│       └── blocks.ts            # slot-ref 块处理器, scope 块接口
```

共享内核负责 tokenization、AST 构建和递归渲染骨架。各领域前端注入：
- 变量解析函数（`VariableResolver`）
- 块处理器（`BlockHandlerFn`）
- 语法配置（`SyntaxConfig`）

## 3. 公共 API

### 3.1 Data Cleaner 前端（一步渲染）

最简单的使用方式，适用于 `{var}` 语法的模板渲染。

```typescript
import { render } from './template_engine/frontends/data_cleaner/index.js'

const result = render('Hello {name|upper}, welcome to {place}', {
  name: 'alice',
  place: 'Wonderland'
})
// → 'Hello ALICE, welcome to Wonderland'
```

签名：

```typescript
function render(
  template: string,
  variables: Record<string, unknown>,
  syntaxOverride?: Partial<SyntaxConfig>
): string
```

### 3.2 两步操作：`parseTemplate()` + `renderAst()`

```typescript
import { parseTemplate, renderAstPublic } from './template_engine/frontends/data_cleaner/index.js'

const { nodes, diagnostics } = parseTemplate('{name|upper}')
const result = renderAstPublic(nodes, { name: 'charlie' })
// → 'CHARLIE'
```

### 3.3 工厂模式：`createParser()`

```typescript
import { createParser } from './template_engine/frontends/data_cleaner/index.js'

const parser = createParser({
  modifiers: {
    scream: (value: unknown) => String(value).toUpperCase() + '!!!'
  },
  blockHandlers: {
    greet: (condition, body, _elseBody, scope, renderFn) => {
      return `[GREETING: ${renderFn(body, scope)}]`
    }
  }
})

parser.render('{msg|scream}', { msg: 'hello' })  // → 'HELLO!!!'
parser.render('{{#greet}}world{{/greet}}', {})    // → '[GREETING: world]'
```

`ParserInstance` 接口：

```typescript
interface ParserInstance {
  render(template: string, variables: Record<string, unknown>, syntaxOverride?: Partial<SyntaxConfig>): string
  parse(template: string, syntaxOverride?: Partial<SyntaxConfig>): { nodes: AstNode[]; diagnostics: ParserDiagnostic[] }
  renderAst(nodes: AstNode[], variables: Record<string, unknown>): string
}
```

### 3.4 Narrative 前端（`{{ }}` 语法，命名空间变量解析）

```typescript
import { renderNarrativeTemplate } from './template_engine/frontends/narrative/resolver.js'
import { createPromptVariableContext, createPromptVariableLayer, normalizePromptVariableRecord } from './template_engine/frontends/narrative/variable_context.js'

const ctx = createPromptVariableContext({
  layers: [
    createPromptVariableLayer({
      namespace: 'actor',
      values: normalizePromptVariableRecord({ display_name: '夜神月' }),
      metadata: { source_label: 'actor', trusted: true }
    })
  ]
})

const result = renderNarrativeTemplate({
  template: '角色：{{ actor.display_name }}',
  variableContext: ctx
})
// result.text → '角色：夜神月'
// result.diagnostics → RenderDiagnostics（traces, missing_paths, errors 等）
```

返回类型：

```typescript
interface RenderResult {
  text: string
  diagnostics: RenderDiagnostics
}
```

Narrative 前端支持 `{{#if}}...{{else}}...{{/if}}`、`{{#each path as alias}}...{{/each}}`、`{{#with path}}...{{/with}}` 块语法，以及 `{{path | default("fallback")}}` 默认值修饰符。

## 4. 默认语法规则

### 4.1 Data Cleaner 前端默认语法

变量和块均使用 `{...}` / `{{...}}` 分隔符：

```
{var_name}                     — 简单变量替换
{var_name|modifier}            — 单修饰符
{var_name|mod1|mod2}           — 修饰符链（从左到右执行）
{var_name|mod(args)}           — 带参数的修饰符
{{#if condition}}...{{/if}}    — 条件块（支持 {{#else}}）
{{#each items}}...{{/each}}    — 迭代块
{{#with context}}...{{/with}}  — 上下文块
{!-- comment --}              — 注释
```

### 4.2 Narrative 前端默认语法

变量统一使用 `{{ }}`，与块语法共用分隔符对：

```
{{ path }}                     — 命名空间变量插值
{{ path | default("x") }}      — 带默认值的变量插值
{{#if path}}...{{/if}}         — 条件块（支持嵌套和 {{#else}}）
{{#each path as alias}}...{{/each}} — 迭代块
{{#with path}}...{{/with}}     — 上下文块
```

Narrative 前端的 `{{ }}` 统一解析为变量节点，与 slot 引用的区分发生在变量解析层（先查 slot 注册表，再执行命名空间变量查找）。

### 4.3 通用规则

变量名支持点号路径访问嵌套属性：`{user.name}` 解析为 `variables.user.name`。

转义使用 `\`：`\{not a variable\}` 输出为 `{not a variable}`。

最大递归深度 32 层，超出返回空字符串。

## 5. 内置修饰符

| 修饰符 | 参数 | 行为 | 示例 |
|--------|------|------|------|
| `upper` | — | 转大写 | `{name\|upper}` → `ALICE` |
| `lower` | — | 转小写 | `{name\|lower}` → `alice` |
| `trim` | — | 去首尾空白 | `{name\|trim}` → `alice` |
| `capitalize` | — | 首字母大写 | `{name\|capitalize}` → `Alice` |
| `pad(n)` | `n: number` | 右填充空格至长度 n | `{name\|pad(10)}` → `alice     ` |
| `truncate(n)` | `n: number` | 截断至长度 n | `{name\|truncate(3)}` → `ali` |
| `default(val)` | `val: string` | 值为空时使用默认值 | `{missing\|default("N/A")}` → `N/A` |

修饰符链从左到右执行。修饰符函数签名：

```typescript
type ModifierFn = (value: unknown, ...args: string[]) => unknown
```

## 6. 内置块处理器

### 6.1 `if` / `else`

```
{{#if show}}
  可见内容
{{#else}}
  不可见时的替代内容
{{/if}}
```

Falsy 值：`null`、`undefined`、`false`、`0`、`""`、`[]`。其余为 truthy。

### 6.2 `each`

Data Cleaner 前端注入 `item`、`index`、`first`、`last` 变量。Narrative 前端使用 `as alias` 语法：

```
{{#each items}}
  {index}: {item}
{{/each}}
```

### 6.3 `with`

切换变量上下文，块内可直接访问该对象的属性：

```
{{#with user}}
  {name} ({email})
{{/with}}
```

## 7. 自定义语法配置

`SyntaxConfig` 的完整结构：

```typescript
interface SyntaxConfig {
  delimiters: {
    variable:    { open: string; close: string }   // Data Cleaner 默认: { }
    macro:       { open: string; close: string }   // Data Cleaner 默认: {{ }}
    blockOpen:   { open: string; close: string }   // 默认: {{# }}
    blockClose:  { open: string; close: string }   // 默认: {{/ }}
    comment:     { open: string; close: string }   // 默认: {!-- --}
    escape:      string                            // 默认: \
  }
  modifiers: {
    chainSeparator: string   // 默认: |
    argOpen:        string   // 默认: (
    argClose:       string   // 默认: )
    namedArgSep:    string   // 默认: =
  }
  blocks: {
    keywords:    string[]    // 识别的块关键字，如 ['if', 'each', 'with', 'slot-ref']
    elseKeyword: string      // 默认: 'else'
    asKeyword:   string      // 默认: 'as'
  }
}
```

### 7.1 示例：自定义分隔符

```typescript
import { render } from './template_engine/frontends/data_cleaner/index.js'

const result = render('Hello <<name>>', { name: 'World' }, {
  delimiters: {
    variable: { open: '<<', close: '>>' }
  }
})
// → 'Hello World'
```

## 8. DataCleaner 适配器

### 8.1 接口 key

```
data_cleaner.template
```

### 8.2 输入输出

```typescript
// 输入
{
  text: string                              // 模板字符串
  options?: {
    variables?: Record<string, unknown>     // 变量映射
    syntax_config?: Partial<SyntaxConfig>   // 可选的语法覆盖
  }
}

// 输出
{
  cleaned: string          // 渲染后的字符串
  metadata: {
    variable_count: number
    input_length: number
    output_length: number
  }
}
```

### 8.3 错误处理

模板解析或渲染过程中的异常被捕获，适配器返回原始输入文本作为降级。

## 9. AST 节点类型参考

```typescript
type AstNode = TextNode | VariableNode | MacroNode | BlockNode

interface TextNode {
  type: 'text'
  content: string
}

interface VariableNode {
  type: 'variable'
  name: string
  modifiers: ModifierSpec[]
}

interface MacroNode {
  type: 'macro'
  name: string
  args: Record<string, MacroValue>
  body?: AstNode[]
}

interface BlockNode {
  type: 'block'
  keyword: string
  condition: string
  body: AstNode[]
  elseBody?: AstNode[]
}

interface ModifierSpec {
  name: string
  args: MacroValue[]
}
```

## 10. 集成点

### 10.1 ConversationAssembler

`data_cleaner.template` 插件通过 `render()` 为 ConversationAssembler 的格式模板渲染提供基础设施。

### 10.2 Narrative 模板渲染

Narrative 前端 (`renderNarrativeTemplate`) 用于 prompt 模板渲染，替代了旧的 `NarrativeResolver` 正则实现。支持命名空间变量解析、嵌套 `if/else`、`each as alias`、`with` 块，返回 `RenderResult`（结构化错误替代标记字符串）。

### 10.3 Slot 函数系统

Slot Function 前端提供 `slot-ref` 块处理器，支持在模板中引用 slot 内容：
- 内联形式：`{{slot_name}}` 通过 Narrative 前端 `VariableResolver` 分流
- 块形式：`{{#slot-ref "slot_id"}}fallback{{/slot-ref}}` 支持回退内容

## 11. 宏处理器扩展点

模板引擎的 AST 已支持 `MacroNode`（`{{roll count=2 sides=6}}` 解析为 `{name: "roll", args: {count: 2, sides: 6}}`）。渲染器在文本模板中对宏结果调用 `toString()`，在 `expandStateJson` 中保留原始类型。

### 11.1 MacroHandlerFn 注册机制

```typescript
type MacroValue = string | number | boolean | null | MacroValue[] | { [key: string]: MacroValue };

type MacroHandlerFn = (
  name: string,
  args: Record<string, MacroValue>,
  scope: RenderScope,
) => MacroValue;
```

`RenderScope` 携带 `macroHandlers` 字段。渲染器遇到 `case 'macro'` 时，查找 `scope.macroHandlers[name]` 并调用，无匹配处理器时输出空字符串。

### 11.2 内置宏

| 宏名 | 参数 | 返回类型 | 说明 |
|------|------|----------|------|
| `roll` | `count`（默认 1）、`sides`（默认 6） | `number` | NdN 骰子求和 |
| `pick` | `from`（数组字面量 `["a","b"]`）、`count`（默认 1） | `string` 或 `string[]` | 不放回随机选取；单元素返回 string，多元素返回 string[] |
| `int` | `min`（默认 0）、`max`（默认 100） | `number` | 区间内随机整数 |
| `float` | `min`（默认 0）、`max`（默认 1） | `number` | 区间内随机浮点数 |
| `seed` | 无 | `string` | 返回物化阶段使用的 PRNG 种子字符串 |

宏参数语法支持字面量：数字 `42`、布尔 `true`/`false`、null、双/单引号字符串、数组 `["a","b"]`、浅层对象 `{k1: v1, k2: v2}`。裸标识符（无引号）作为字符串处理。

### 11.3 加载时展开

宏在世界包物化阶段（`materializer.ts`）展开，而非 YAML 解析阶段。展开后的具体值写入 runtime DB 的 entity state，**保留原始类型**（number 写为 number，array 写为 array，不再强制转换字符串）。后续 AI 推理读到的是已确定的值，不再经过模板引擎。

PRNG 种子可通过世界包配置提供（可重现），未提供时使用 `crypto.randomUUID()` 生成并记录到世界包元数据中。

### 11.4 设计原则

**随机性决定模拟状态，不是提示词噪声。** 宏的职责是在加载时将随机性物化为确定的状态值。AI 的工作是扮演已有属性的角色，而非从裸数字推断属性。

## 13. 相关文档

- 系统架构：`docs/ARCH.md`
- 业务逻辑原则：`docs/LOGIC.md` "模拟状态确定性原则"
- World Pack 宏模板规范：`docs/specs/WORLD_PACK.md` "变量与宏模板"

## 12. 约束与限制

- **最大递归深度 32** — 嵌套块超过此深度返回空字符串
- **变量缺失不报错** — 未找到的变量渲染为空字符串（Data Cleaner）或在 diagnostics 中记录（Narrative）
- **修饰符缺失静默跳过** — 注册表中不存在的修饰符被跳过
- **块处理器缺失静默跳过** — 未注册的块关键字不产生输出
- **语法配置部分合并** — 传入 `Partial<SyntaxConfig>` 时，未指定字段保留默认值
