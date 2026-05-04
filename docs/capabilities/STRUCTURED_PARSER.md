# Structured Syntax Parser / 结构化语法解析器

可配置的模板字符串解析与渲染引擎。支持变量插值、修饰符链、条件/迭代块，语法本身由配置定义而非硬编码。

Key concepts:

- **Layered architecture** — Lexer (tokenizer) → Parser (AST builder) → Renderer (string output)，三层独立，AST 可被程序化操作
- **Configurable syntax** — 分隔符、修饰符链、块关键字全在 `ParserSyntaxConfig` 中定义，默认 `{...}` / `{{...}}` / `{{#...}}`，可替换为任意自定义语法
- **Two usage modes** — `render()` 一步渲染（简单场景）；`parse() → 操作 AST → renderAst()` 两步操作（复杂场景，如 Slot 函数系统）
- **Modifier pipeline** — `{var|upper|trim|default("N/A")}`，修饰符链式执行，支持自定义注册
- **Block handlers** — `{{#if}}`、`{{#each}}`、`{{#with}}` 内置块，可通过 `createParser()` 注册自定义块处理器
- **DataCleaner adapter** — `data_cleaner.template` 作为薄封装暴露给 DataCleaner 管道，模板渲染可嵌入数据清洗流程

本文档集中说明解析器的 API、语法配置、修饰符/块系统以及 DataCleaner 适配器的使用方式。

## 1. 文档定位

本文件回答：

- 解析器的公共 API 有哪些，如何选择 `render()` vs `parse()` vs `createParser()`
- 默认语法规则是什么，如何配置自定义语法
- 内置修饰符和块处理器的完整列表及行为
- 如何注册自定义修饰符和块处理器
- `data_cleaner.template` 适配器的输入输出契约

本文件不负责：

- DataCleaner 注册表与插件生命周期：看 `docs/capabilities/PLUGIN_RUNTIME.md`
- Prompt Workflow 中 slot 与 section draft 的关系：看 `docs/capabilities/PROMPT_WORKFLOW.md`

## 2. 公共 API

实现位于 `apps/server/src/parser/`，公共入口为 `index.ts`。

### 2.1 一步渲染：`render()`

最简单的使用方式。传入模板字符串和变量映射，返回渲染后的字符串。

```typescript
import { render } from './parser/index.js'

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
  syntaxOverride?: Partial<ParserSyntaxConfig>
): string
```

适用场景：ConversationAssembler 的格式模板渲染、YAML 配置中的消息前缀/后缀替换。

### 2.2 两步操作：`parseTemplate()` + `renderAst()`

先解析为 AST，可程序化操作节点后再渲染。适用于需要在渲染前修改模板结构的场景。

```typescript
import { parseTemplate, renderAstPublic } from './parser/index.js'

const { nodes, diagnostics } = parseTemplate('{name|upper}')
// nodes: [{ type: 'variable', name: 'name', modifiers: [{ name: 'upper', args: [] }] }]

// 可以在渲染前操作 nodes（插入、删除、修改节点）

const result = renderAstPublic(nodes, { name: 'charlie' })
// → 'CHARLIE'
```

### 2.3 工厂模式：`createParser()`

创建带自定义修饰符和块处理器的解析器实例。适用于 Slot 函数系统等需要扩展语法的场景。

```typescript
import { createParser } from './parser/index.js'

const parser = createParser({
  syntax: {
    delimiters: {
      variable: { open: '<<', close: '>>' }
    }
  },
  modifiers: {
    scream: (value: unknown) => String(value).toUpperCase() + '!!!'
  },
  blockHandlers: {
    greet: (condition, body, _elseBody, scope, renderFn) => {
      const inner = renderFn(body, scope)
      return `[GREETING: ${inner}]`
    }
  }
})

parser.render('<<msg|scream>>', { msg: 'hello' })
// → 'HELLO!!!'

parser.render('{{#greet}}world{{/greet}}', {})
// → '[GREETING: world]'
```

签名：

```typescript
function createParser(config: {
  syntax?: Partial<ParserSyntaxConfig>
  modifiers?: Record<string, ModifierFn>
  blockHandlers?: Record<string, BlockHandlerFn>
}): ParserInstance
```

`ParserInstance` 接口：

```typescript
interface ParserInstance {
  render(template: string, variables: Record<string, unknown>, syntaxOverride?: Partial<ParserSyntaxConfig>): string
  parse(template: string, syntaxOverride?: Partial<ParserSyntaxConfig>): { nodes: AstNode[]; diagnostics: ParserDiagnostic[] }
  renderAst(nodes: AstNode[], variables: Record<string, unknown>): string
}
```

## 3. 默认语法规则

默认配置定义在 `apps/server/src/parser/syntax_defaults.ts`，采用 Handlebars 风格。

### 3.1 变量插值

```
{var_name}                     — 简单变量替换
{var_name|modifier}            — 单修饰符
{var_name|mod1|mod2}           — 修饰符链（从左到右执行）
{var_name|mod(args)}           — 带参数的修饰符
{var_name|mod1|mod2(arg)}      — 链式 + 参数
```

变量名支持点号路径访问嵌套属性：`{user.name}` 解析为 `variables.user.name`。

### 3.2 宏引用

```
{{macro_name}}                 — 简单宏引用
{{macro_name arg1=val1}}       — 带命名参数的宏
```

宏当前在渲染器中不产生输出（返回空字符串），为 Slot 函数系统预留。Slot 函数系统可通过操作 AST 消费宏节点。

### 3.3 块语法

```
{{#if condition}}...{{/if}}
{{#if condition}}...{{#else}}...{{/if}}
{{#each items}}...{{/each}}
{{#with context}}...{{/with}}
```

块可嵌套。最大递归深度 32 层，超出返回空字符串。

### 3.4 注释

```
{!-- 这是注释，不会出现在输出中 --}
```

### 3.5 转义

使用 `\` 转义分隔符：`\{not a variable\}` 输出为 `{not a variable}`。

## 4. 内置修饰符

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

## 5. 内置块处理器

### 5.1 `if` / `else`

条件渲染。condition 为变量名，解析为 truthy/falsy 判断。

```
{{#if show}}
  可见内容
{{#else}}
  不可见时的替代内容
{{/if}}
```

Falsy 值：`null`、`undefined`、`false`、`0`、`""`、`[]`。其余为 truthy。

### 5.2 `each`

迭代数组。condition 为数组变量名。每次迭代注入以下局部变量：

| 变量 | 含义 |
|------|------|
| `item` | 当前元素 |
| `index` | 当前索引（从 0 开始） |
| `first` | 是否第一个元素 |
| `last` | 是否最后一个元素 |

```
{{#each items}}
  {index}: {item}
{{/each}}
```

### 5.3 `with`

切换变量上下文。condition 为一个对象变量名，块内可直接访问该对象的属性。

```
{{#with user}}
  {name} ({email})
{{/with}}
```

等价于在块内将 `variables` 与 `user` 对象合并。

## 6. 自定义语法配置

`ParserSyntaxConfig` 的完整结构。所有字段均有默认值，传 `Partial<ParserSyntaxConfig>` 只覆盖需要改的部分。

```typescript
interface ParserSyntaxConfig {
  delimiters: {
    variable:    { open: string; close: string }   // 默认: { }
    macro:       { open: string; close: string }   // 默认: {{ }}
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
    conditional: { keyword: string; elseKeyword: string }  // 默认: if / else
    iteration:   { keyword: string }                        // 默认: each
    context:     { keyword: string }                        // 默认: with
  }
}
```

### 6.1 示例：自定义分隔符

```typescript
import { render } from './parser/index.js'

const result = render('Hello <<name>>', { name: 'World' }, {
  delimiters: {
    variable: { open: '<<', close: '>>' }
  }
})
// → 'Hello World'
```

注意：部分覆盖时，未指定的字段保持默认值。只改了 `variable` 分隔符，`macro`、`block` 等仍用 `{{...}}`。

### 6.2 示例：在 ConversationFormatConfig 中嵌入

按设计决策，每个 `ConversationFormatConfig` 内嵌一份语法配置：

```yaml
conversation_format:
  transcript:
    speaker_format:
      default:
        prefix: '"{speaker_id}": "'
        suffix: '"\n'
  parser_syntax:           # 嵌入的语法配置（可选，不传则用默认）
    delimiters:
      variable:
        open: "{"
        close: "}"
```

## 7. DataCleaner 适配器

### 7.1 接口 key

```
data_cleaner.template
```

### 7.2 输入输出

```typescript
// 输入
{
  text: string                              // 模板字符串
  options?: {
    variables?: Record<string, unknown>     // 变量映射
    syntax_config?: Partial<ParserSyntaxConfig>  // 可选的语法覆盖
  }
}

// 输出
{
  cleaned: string          // 渲染后的字符串
  metadata: {
    variable_count: number // 传入的变量数量
    input_length: number   // 输入模板长度
    output_length: number  // 输出字符串长度
  }
}
```

### 7.3 使用示例

```typescript
import { dataCleanerRegistry } from './plugins/extensions/data_cleaner_registry.js'

const cleaner = dataCleanerRegistry.get('data_cleaner.template')!
const output = await cleaner.clean({
  text: 'Agent {agent_id} says: {message|upper}',
  options: {
    variables: { agent_id: 'agent9', message: 'hello world' }
  }
})
// output.cleaned → 'Agent agent9 says: HELLO WORLD'
```

### 7.4 错误处理

模板解析或渲染过程中的异常被捕获，适配器返回原始输入文本作为降级：

```typescript
// 如果渲染抛出，输出 = 输入
{ cleaned: originalText, metadata: { ... } }
```

## 8. AST 节点类型参考

供需要程序化操作 AST 的消费者（如 Slot 函数系统）参考。

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
  args: Record<string, string>
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
  args: string[]
}
```

操作 AST 后再渲染的典型流程：

```typescript
const parser = createParser({})
const { nodes } = parser.parse('Hello {name}')

// 程序化修改 AST：在末尾追加一个文本节点
nodes.push({ type: 'text', content: '!' })

const result = parser.renderAst(nodes, { name: 'World' })
// → 'Hello World!'
```

## 9. 集成点

### 9.1 ConversationAssembler（近期）

解析器的 `render()` 是 ConversationAssembler 格式模板渲染的基础设施。`ConversationFormatConfig` 中的 `speaker_format`、`role_format`、`message_prefix/suffix` 等字段通过 `render(template, {...})` 转为实际字符串。

详见 `.limcode/design/multi-turn-conversation-design.md` §3。

### 9.2 Slot 函数系统（远期）

解析器的 `parse() → 操作 AST → renderAst()` 两步模式支撑 Slot 函数系统中的宏展开、嵌套作用域、块级条件/迭代。

详见 `TODO.md` "插槽函数（链表）" 项。

### 9.3 NarrativeResolver（现有，未来迁移候选）

`apps/server/src/narrative/resolver.ts` 中 `NarrativeResolver` 的 `processInterpolations` / `processIfBlocks` / `processEachBlocks` 是正则-based 的模板渲染。本解析器设计上可替换该实现，但不属于当前任务范围。

## 10. 约束与限制

- **最大递归深度 32** — 嵌套块超过此深度返回空字符串，防止栈溢出
- **宏不产生输出** — `{{macro_name}}` 当前渲染为空字符串，为 Slot 函数系统预留的扩展点
- **变量缺失不报错** — 未找到的变量渲染为空字符串，不抛异常
- **修饰符缺失静默跳过** — 注册表中不存在的修饰符被跳过，值不变
- **块处理器缺失静默跳过** — 未注册的块关键字不产生输出，不报错
- **语法配置部分合并** — 传入 `Partial<ParserSyntaxConfig>` 时，未指定的字段保留默认值，使用浅合并
