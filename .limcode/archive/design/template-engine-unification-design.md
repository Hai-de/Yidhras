# 模板引擎统一与插槽宏系统设计

> 状态: 已完成（实现计划：`.limcode/plans/template-engine-unification.md`）
> 关联: TODO.md — 插槽函数；`apps/server/src/template_engine/`
> 前置: 无（独立可实施）

## 1. 问题陈述

项目有两个 TS 模板引擎能力重叠、权责边界模糊；另有一个 Rust 数据层插值工具不参与本轮统一：

| 组件 | 位置 | 语法 | 能力 | 用途 | 分类 |
|------|------|------|------|------|------|
| NarrativeResolver | `narrative/resolver.ts` | `{{ }}` | 插值、`default()`、`#if`、`#each` | prompt 模板渲染 | 模板引擎 |
| Parser 模块 | `parser/` | `{ }` / `{{ }}` | 插值、管道链、`if/else`、`each`、`with`、可配置分隔符 | data_cleaner 插件 | 模板引擎 |
| Rust Sidecar | `apps/server/rust/world_engine_sidecar/src/template.rs` | `{{ }}` | 仅 `render_string_template`（73 行，无条件/迭代/宏/块语法） | 目标规则变更中的字符串插值 | 数据层工具，不参与统一 |

同时 TODO.md 插槽函数需求暴露了 NarrativeResolver 的结构性瓶颈：

1. **不支持嵌套 `#if`** — 正则 `([\s\S]*?)` 非贪婪匹配会错配内层闭标签
2. **不支持 `else`** — 必须写两段互补 `#if`
3. **不支持 slot 自引用** — 无法用 `{{system_core}}` 引用其他 slot 内容
4. **不支持作用域/嵌套宏** — §12.14 明确规定宏仅单次扁平替换
5. **不支持自定义函数** — 无法表达条件激活、冷却时间等插槽函数元数据逻辑
6. **正则实现不可扩展** — 每个 `#if`/`#each` 都是独立正则，无法组合

### 核心矛盾

NarrativeResolver 基于正则的解析方案（`processInterpolations` / `processIfBlocks` / `processEachBlocks` 三道独立正则扫描）无法支持嵌套 `#if`、`else`、`#with`，且不可扩展。必须用 AST 架构替代。

但同时，现有的 `parser/` 模块已具备完整的 lexer → token → AST → renderer 流水线、栈式解析（天然嵌套）、`else`/`#with`/`#each` 支持、`createParser()` 工厂和可配置分隔符。这意味着本轮不需要"从零构建"模板引擎内核——真正的增量是：

1. 将 `parser/` 的 `RenderScope` 扩展为支持注入式变量解析的 `RenderContext`（当前 `parser/` 的变量解析是硬编码的 flat key lookup）
2. 为 Narrative 领域编写命名空间 8 层变量解析前端
3. 统一诊断系统、增加 `scopeStack` 作用域栈

核心决策不是"升级 vs 从零构建"，而是：将 `parser/` 重构为通用内核、删除 `narrative/` 的正则实现、用内核提供的 AST 能力重写 Narrative 前端。

## 2. 设计目标

1. **单一解析内核** — tokenization + AST +递归渲染只实现一次，两个领域前端共用
2. **领域前端分离** — 数据清洗前端和提示词/插槽前端各自定义块语义和变量解析，互不侵入
3. **NarrativeResolver 迁移** — 用共享内核重写，消除正则解析缺陷，获得嵌套 `#if`、`else`、`with` 支持
4. **插槽宏可扩展** — 共享内核提供扩展点（自定义块处理器、变量解析器），插槽函数前端在此基础上添加 slot 自引用、作用域嵌套等语义
5. **清洁迁移** — 项目未上线，无外部/生产使用者（有 6 个内部消费方需同步迁移，见 §5 依赖图），不做向后兼容妥协；直接删除旧模块，API 可自由重构；Rust Sidecar 不受影响（保持独立）

## 3. 架构：共享内核 + 领域前端

共享内核的 lexer、parser、renderer 三件套从现有 `parser/` 模块直接搬迁，核心能力（tokenize → AST → 递归渲染、嵌套块、`else` 支持、`createParser()` 工厂）已就绪。本轮重构的增量集中在 `types.ts`：将 `RenderScope` 扩展为 `RenderContext`（增加可注入的 `VariableResolver`、`SlotRefResolver`、`scopeStack`、统一 `RenderDiagnostics`），而非重新实现解析/渲染流水线。

```
apps/server/src/template_engine/
├── core/                       # 共享内核 — 只回答"怎么解析和渲染模板"（从 parser/ 搬迁+扩展）
│   ├── lexer.ts                # 通用 tokenizer
│   ├── parser.ts                # AST 构建器
│   ├── renderer.ts              # 递归渲染骨架
│   ├── types.ts                 # AstNode, Token, RenderContext, BlockHandler, Resolver 等
│   ├── diagnostics.ts           # 诊断收集（trace、missing、block execution）
│   └── errors.ts                # TemplateError 层级
├── frontends/
│   ├── narrative/               # 提示词/插槽前端
│   │   ├── resolver.ts          # NarrativeResolver 重写入口
│   │   ├── variable_context.ts  # 8 层命名空间变量解析（从 narrative/ 迁入，重写）
│   │   ├── blocks.ts            # prompt 领域块处理器：if/else/each/slot-ref/with
│   │   ├── resolvers.ts         # prompt 领域变量解析：命名空间路径、default()
│   │   └── types.ts             # PromptVariableContext, PromptVariableLayer 等（重写）
│   ├── data_cleaner/            # 数据清洗前端
│   │   ├── blocks.ts            # data_cleaner 块处理器：if/else/each/with
│   │   └── resolvers.ts         # data_cleaner 变量解析：简单 key lookup + 管道链
│   └── slot_function/           # 插槽函数前端（TODO 阶段，本设计只定义接口）
│       ├── blocks.ts             # slot-ref（slot 内容引用）、scope 块处理器
│       ├── resolvers.ts         # 作用域变量解析
│       └── types.ts             # SlotFunctionContext 等
└── defaults.ts                  # 默认语法配置、内置修饰符
```

### 3.1 共享内核职责

共享内核 **只提供基础设施**，不包含任何领域语义：

| 能力 | 说明 |
|------|------|
| Tokenization | 将模板字符串切分为 Token 流（TEXT, VAR_OPEN/CLOSE, MACRO_OPEN/CLOSE, BLOCK_OPEN/CLOSE, COMMENT_OPEN/CLOSE） |
| AST 构建 | 将 Token 流构建为 `AstNode[]`（TextNode / VariableNode / BlockNode / CommentNode），支持可配置的分隔符和关键字 |
| 递归渲染 | 遍历 AST，对每种节点类型调用注册的处理器 |
| 作用域栈 | `RenderContext` 维护变量作用域栈，支持 `pushScope` / `popScope` |
| 诊断收集 | 统一的 trace / missing / block execution 诊断收集 |
| 深度/长度保护 | 递归深度上限（32）和输出长度上限（可配置） |

**内核不包含**：命名空间解析、`default()` 语法、`slot-ref` 语义、权限过滤、变量来源追踪。

### 3.2 领域前端职责

| 前端 | 注册什么 | 变量解析 | 块处理器 |
|------|---------|---------|---------|
| Narrative | 命名空间路径 `{namespace.path}`、`default()` 管道 | 8 层 `PromptVariableLayer` 查找 + localScope | `if/else`、`each`、`with`、未来 `slot-ref` |
| Data Cleaner | 简单 key lookup + 修饰符管道链 `{name\|upper\|trim}` | flat `variables` 查找 | `if/else`、`each`、`with`（复用内核通用块框架） |
| Slot Function | 命名空间 + 作用域链 + slot 内容引用 | 扩展 Narrative 变量解析 | 继承 Narrative + `slot-ref`、`scope` 块 |

## 4. 核心类型设计

### 4.0 关键决策：Narrative 前端 `{{ }}` 语法统一

Narrative 前端只有一对分隔符 `{{ }}`，同时用于变量插值和 slot 内联引用。如果 lexer 试图在 tokenize 阶段区分两者，需要两对不同的分隔符，但这会引入不必要的语法复杂度（且 `[[ ]]` 等替代分隔符与 Markdown 链接冲突）。

**决策（方案 B）**：Narrative 前端的 lexer 将 `{{ }}` 统一标记为 `VAR_OPEN/CLOSE`，parser 统一构建 `VariableNode`。变量和 slot 的区分发生在渲染层：Narrative 前端的 `VariableResolver` 解析路径时，先查询 slot 注册表——若路径匹配已注册 slot 名，委托给 `SlotRefResolver` 内联其内容；否则执行正常的命名空间变量查找。

影响：
- `SlotRefNode` 不作为独立 AST 节点类型存在（内联 `{{slot_name}}` 用 `VariableNode` 承载）
- `MACRO_OPEN`/`MACRO_CLOSE` token 保留，但仅 Data Cleaner 前端使用（其 `{ }` = 变量、`{{ }}` = 宏，分隔符不同，lexer 可区分）
- `SlotRefResolver` 从 `RenderContext` 的独立字段移除，变为 Narrative `VariableResolver` 内部依赖
- 块形式 `{{#slot-ref "system_core"}}...{{/slot-ref}}` 不受影响——仍然是 `BlockNode { keyword: 'slot-ref' }`

### 4.1 Token & AST

```typescript
// core/types.ts

export type TokenKind =
  | 'TEXT'
  | 'VAR_OPEN'       // {  或自定义（Narrative 前端配置为 '{{'）
  | 'VAR_CLOSE'      // }  或自定义（Narrative 前端配置为 '}}'）
  | 'MACRO_OPEN'     // {{ 或自定义（仅 Data Cleaner 前端使用，其 { } = 变量、{{ }} = 宏）
  | 'MACRO_CLOSE'    // }} 或自定义（同上）
  | 'BLOCK_OPEN'     // {{# 或自定义（macro_open/open + block_prefix 组合）
  | 'BLOCK_CLOSE'    // {{/ 或自定义（macro_open/open + block_close_prefix 组合）
  | 'COMMENT_OPEN'   // {!-- 或自定义
  | 'COMMENT_CLOSE'  // --} 或自定义

export interface Token {
  kind: TokenKind
  content?: string
  keyword?: string
  position: number
}

export type AstNode =
  | TextNode
  | VariableNode
  | BlockNode
  | CommentNode

export interface TextNode {
  type: 'text'
  content: string
}

export interface VariableNode {
  type: 'variable'
  raw: string                // 原始表达式 "actor.display_name | default('none')"
  path: string               // 变量路径部分 "actor.display_name"
  pipeline: PipelineStep[]   // 管道链 [{name: 'default', args: ['none']}]
}

// 注：内联 slot 引用 {{slot_name}} 统一解析为 VariableNode，
// 由 Narrative 前端 VariableResolver 在渲染时查询 slot 注册表分流。
// 块形式 {{#slot-ref "name"}}...{{/slot-ref}} 为 BlockNode。

export interface PipelineStep {
  name: string
  args: string[]
}

export interface BlockNode {
  type: 'block'
  keyword: string            // 'if', 'each', 'with', 'slot-ref', ... 可扩展
  condition: string          // 块条件的原始表达式（由各前端自行解析，如 'each' 的 'path as alias'）
  body: AstNode[]             // 主分支 AST
  elseBody?: AstNode[]        // else 分支（可选）
}

export interface CommentNode {
  type: 'comment'
  content: string
}
```

### 4.2 RenderContext 与 SyntaxConfig

`SyntaxConfig` 采用折中方案：`delimiters` 保持当前嵌套 `{open, close}` 结构（lexer 零改动），`blocks` 采用 `keywords: string[]` 数组（加新块关键字只需 push），`modifiers` 保持当前结构。

```typescript
// core/types.ts

export interface SyntaxConfig {
  delimiters: {
    variable: { open: string; close: string }   // 默认 '{' / '}'
    macro: { open: string; close: string }      // 默认 '{{' / '}}'（Data Cleaner 前端用于宏节点；Narrative 前端不使用此分隔符对）
    blockOpen: { open: string; close: string }  // 默认 '{{#' / '}}'
    blockClose: { open: string; close: string } // 默认 '{{/' / '}}'
    comment: { open: string; close: string }    // 默认 '{!--' / '--}'
    escape: string                              // 默认 '\\'
  }
  modifiers: {
    chainSeparator: string  // 默认 '|'
    argOpen: string         // 默认 '('
    argClose: string        // 默认 ')'
    namedArgSep: string     // 默认 '='
  }
  blocks: {
    keywords: string[]       // 识别的块关键字 ['if', 'each', 'with', 'slot-ref', ...]
    elseKeyword: string      // 默认 'else'
    asKeyword: string        // 默认 'as'（各前端 each handler 自行解析）
  }
}
```

```typescript
export interface RenderContext {
  variables: Record<string, unknown>
  resolve: VariableResolver          // 领域前端提供的变量解析函数
  modifiers: Record<string, ModifierFn>
  blockHandlers: Record<string, BlockHandlerRegistration>
  scopeStack: ScopeFrame[]
  depth: number
  maxDepth: number
  maxLength: number
  diagnostics: RenderDiagnostics
}

export interface ScopeFrame {
  variables: Record<string, unknown>
  label?: string   // 调试用：'each-iteration', 'with-scope', 'macro-scope'
}

export type VariableResolver = (
  path: string,
  pipeline: PipelineStep[],
  context: RenderContext
) => ResolvedVariable

export interface ResolvedVariable {
  value: unknown
  missing: boolean
  restricted?: boolean
  trace?: VariableResolutionTrace
}

export type ModifierFn = (value: unknown, ...args: string[]) => unknown

// SlotRefResolver 签名不再是 RenderContext 的独立字段。
// Narrative 前端的 VariableResolver 内部依赖此签名查询 slot 注册表（见 §7.1）。
export type SlotRefResolver = (
  name: string,
  context: RenderContext
) => { content: string; enabled: boolean }

export type BlockHandlerKind = 'conditional' | 'iteration' | 'context' | 'custom'

export interface BlockHandlerRegistration {
  kind: BlockHandlerKind
  fn: BlockHandlerFn
}

export type BlockHandlerFn = (
  node: BlockNode,
  context: RenderContext,
  renderChildren: (nodes: AstNode[], context: RenderContext) => string
) => string

export interface RenderDiagnostics {
  traces: VariableResolutionTrace[]
  missing_paths: string[]
  restricted_paths: string[]
  blocks: BlockExecutionTrace[]
  namespaces_used?: string[]
  output_length?: number
  template_source?: string
  errors: TemplateError[]       // 结构化错误取代标记字符串（如 [RESTRICTED_OR_MISSING]）
}

export interface VariableResolutionTrace {
  expression: string
  resolved_path: string
  resolved: boolean
  missing: boolean
  restricted?: boolean
  value_preview?: string
  fallback_applied?: boolean
  source?: string
}

export interface BlockExecutionTrace {
  kind: string
  expression: string
  executed: boolean
  iteration_count?: number
  alias?: string
}
```

### 4.3 关键设计决策

#### D1: 变量解析权在前端、不在内核；权限预过滤保留

内核的 `RenderContext.resolve` 是一个函数签名，具体解析逻辑由领域前端注入。Narrative 前端注入命名空间 8 层解析，Data Cleaner 前端注入简单 flat key lookup。

**理由**：命名空间解析权限模型（`AccessLevel`, `InformationMetadata`, `PermissionContext`）是 prompt 领域专属概念，不属于通用模板引擎。

> ##### 权限模型迁移：方案 A — 保持预过滤
>
> 当前 `NarrativeResolver.canAccess()` → `buildVisiblePool()` 在变量池构建时预过滤不可见变量（渲染前一次性完成）。迁移后此逻辑从 `NarrativeResolver` 搬到 Narrative 前端的 `createNarrativeRenderer()` 工厂：
>
> ```typescript
> // frontends/narrative/resolver.ts
> export const createNarrativeRenderer = (options: {
>   variablePool: PromptVariableRecord;
>   metadataMap: Record<string, InformationMetadata>;
>   permission?: PermissionContext;
> }) => {
>   // 预过滤：构建时一次性检查权限（与当前行为完全一致）
>   const visiblePool = buildVisiblePool(options.variablePool, options.metadataMap, options.permission);
>   // VariableResolver 只接收已过滤的可见变量
>   const variableResolver = createNarrativeVariableResolver(visiblePool);
>   return { render: (template) => core.render(template, { resolve: variableResolver, ... }) };
> };
> ```
>
> **不采用延迟检查（方案 B）的理由**：`AccessLevel`/`PermissionContext` 在渲染前已完全确定，不存在"渲染过程中权限动态变化"的用例。延迟检查的额外复杂度换不来功能收益，且所有消费方需要从"不可见变量=不存在"改为"不可见变量=空字符串+检查 diagnostics.restricted_paths"，破坏性无必要。
>
> 行为规范：
> - 权限检查时机：`createNarrativeRenderer()` 构造时（与当前 `buildVisiblePool` 一致）
> - 权限拒绝后的渲染输出：该变量不出现在变量池中 → `VariableResolver` 返回 `{ value: undefined, missing: true }` → 内核输出空字符串 → `missing_paths` 记录
> - 消费方适配：无行为变更——`template_renderer.ts` 和 `template_track.ts` 的权限预期不变

#### D2: 管道链在解析阶段拆分；`??` 作为一等管道操作符

`VariableNode` 将 `actor.display_name | default('none')` 拆分为 `path: 'actor.display_name'` 和 `pipeline: [{name: 'default', args: ['none']}]`。内核按序调用修饰符链，但修饰符注册由领域前端完成。

`??`（null-coalescing）作为一等管道操作符加入共享内核。语法 `{{path ?? fallback_path}}` 在 AST 中表示为 `VariableNode { path: 'path', pipeline: [{ name: '??', args: ['fallback_path'] }] }`。`??` 修饰符的语义：当主路径解析值为 `null` 或 `undefined` 时，解析回退路径并返回其值。这比 `default()` 更精确——`default()` 只能提供静态字面量回退，`??` 可以回退到另一个变量路径。

**理由**：Narrative 只需要 `default()`，Data Cleaner 需要 `upper|trim|capitalize` 等。修饰符集合不同，但管线执行逻辑相同。`??` 是两套前端都可能需要的通用操作，属于内核级别的修饰符。

> ##### `??` 双重实现说明
>
> 共享内核的 `??` 修饰符与 `context_config_resolver.ts` 的 `??` 解析（`resolveConfigValues()`）**永久并存，不合并**。两者实现同一语义但处于不同架构层：
>
> | 维度 | `context_config_resolver.ts` | 共享内核 `??` 修饰符 |
> |------|------|------|
> | 执行时机 | 配置加载期，变量池构建之前 | 模板渲染期 |
> | 输入 | 单个配置值字符串 `"{{path ?? fallback}}"` | AST 中 `VariableNode.pipeline` |
> | 变量上下文 | `runtimeObjects` 扁平字典 | `RenderContext`（变量栈、作用域链、slot 注册表） |
> | 产出 | `PromptVariableValue`，进入变量池 | 渲染字符串，进入输出 |
> | 架构角色 | 变量池的**生产者** | 变量池的**消费者** |
>
> 合并的唯一方式（让 config resolver 依赖共享内核）会造成架构倒置：变量池生产者依赖变量池消费者。为解析一个简单的 `??` 回退而启动完整的 tokenize→parse→render 流水线，既不必要也不合理。

#### D3: `else` 支持在 AST 层面而非正则层面

当前 NarrativeResolver 的 `#if` 用 `/\{\{#if\s+([^{}]+?)\s*\}\}([\s\S]*?)\{\{\/if\}\}/g` 无法支持 `else`，因为正则无法匹配 `{{#if}}...{{else}}...{{/if}}` 的正确配对。

共享内核的 parser 用 **栈式解析**：遇到 `{{#if}}` 压栈，遇到 `{{else}}` 切换到 elseBody，遇到 `{{/if}}` 弹栈。这天然支持嵌套。

#### D4: 块处理器注册开放

`RenderContext.blockHandlers` 是 `Record<string, BlockHandlerRegistration>`。领域前端注册自己的块关键字、处理器和类型标签（`BlockHandlerKind`）。内核 parser 根据 `SyntaxConfig.blocks.keywords` 识别块开始并分发到对应处理器，但不硬编码任何块的语义。

**理由**：插槽函数前端可以注册 `slot-ref`、`scope` 等新块类型，无需修改内核。

> ##### `SyntaxConfig.blocks` 结构选择
>
> 当前 `ParserSyntaxBlocksSchema` 是分类结构 `{conditional: {keyword}, iteration: {keyword}, context: {keyword}}`，但实际 parser 仅使用了 `conditional.elseKeyword`，`keyword` 字段从未用于类型感知的分发逻辑。决策 #10 采用扁平 `keywords: string[]` + 注册时声明 `kind`：
>
> ```typescript
> // 扁平 — 内核只管识不识别这个关键字
> blocks: { keywords: ['if', 'each', 'with', 'slot-ref'], elseKeyword: 'else' }
>
> // 注册时声明类型 — 元数据由注册方提供，不参与解析逻辑
> registerBlockHandler('if', { kind: 'conditional', fn: ifHandler })
> registerBlockHandler('each', { kind: 'iteration', fn: eachHandler })
> registerBlockHandler('slot-ref', { kind: 'custom', fn: slotRefHandler })
> ```
>
> 不采用方案 A（恢复分类结构）的理由：(a) 当前分类结构在代码中是未使用的死代码；(b) 新块类型 `slot-ref`/`scope` 放在 `custom` 类别下是二等公民；(c) 分类本质是给人类看的值，内核从不依赖它做解析决策。`BlockHandlerKind` 在注册时附带，用于 diagnostics 自描述和文档可读性，扩展性不受限。

#### D5: 作用域栈是内核能力

`RenderContext.scopeStack` 维护变量作用域链。`#each` 迭代时 push 新栈帧（alias 变量），`#with` 块 push 新栈帧（子对象属性展开），`renderChildren` 递归结束后 pop。变量解析时从栈顶向下查找。

**理由**：作用域是通用的模板能力，不限于任何领域。插槽函数的"全局变量 vs 局部作用域"需求可以在此基础上实现。

## 5. 迁移策略

### 5.1 阶段一：内核提取 + Data Cleaner 直接迁移

项目未上线，无外部/生产使用者。直接删除旧模块，消费方改为引用新路径。

1. 将 `parser/lexer.ts`, `parser/parser.ts`, `parser/renderer.ts`, `parser/types.ts` 移入 `template_engine/core/`（搬迁，不重写解析/渲染逻辑）
2. 重构类型层：将 `RenderScope` 扩展为 `RenderContext`（增加可注入的 `VariableResolver` 函数签名、`SlotRefResolver`、`scopeStack`、统一 `RenderDiagnostics`）；将 `builtins.ts` 中的修饰符和块处理器提取到 `template_engine/defaults.ts`
3. Data Cleaner 前端 (`frontends/data_cleaner/`) 直接使用共享内核，通过 `createParser()` 工厂注入 flat key resolver + 修饰符链 + 块处理器（现有 `parser/index.ts` 已有此能力，接口不变）
4. **删除 `parser/` 目录**，所有消费方（data_cleaner 插件等）改为引用 `template_engine/frontends/data_cleaner/`
5. 将 `packages/contracts/src/structured_parser.ts` 中的 `ParserSyntaxConfig` 和 `ParserOutput` 迁移到 `template_engine/core/types.ts`，contracts 中直接删除 `structured_parser.ts` 和 `index.ts` 中的 re-export（零跨包消费方，不做 re-export）
6. 测试：现有 `template_engine_plugin.spec.ts` 和 `structured_parser.spec.ts` 改为引用新路径后全部通过

### 5.2 阶段二：NarrativeResolver 重写

项目未上线，无外部/生产使用者。直接重写 NarrativeResolver，不复旧 API。`renderNarrativeTemplate()` 返回类型改为 `RenderResult`（结构化错误 + 诊断），不再返回标记字符串。

1. 在 `frontends/narrative/resolver.ts` 创建 `createNarrativeRenderer()` 工厂，注入命名空间变量解析器 + `default()` 修饰符 + `??` 回退修饰符 + `if/else/each` 块处理器
2. 迁移 `narrative/variable_context.ts` 的命名空间解析逻辑到 `frontends/narrative/resolvers.ts`
3. **重写 `renderNarrativeTemplate()` 签名**：返回 `RenderResult` 而非 `PromptMacroRenderResult`，消费方直接使用新类型
4. **删除 `narrative/` 目录**，所有消费方（template track、perception renderer、pack runtime facade、context builder）改为引用 `template_engine/frontends/narrative/`
5. **`{{ }}` 语法保持不变**（不是因为兼容性，而是因为 `{{ }}` 本身就是合适的 prompt 模板语法）；新增 `{{else}}`、`{{#with}}`、`{{ ?? }}` 支持
6. **立刻切换结构化错误**：所有消费方从检查 `[RESTRICTED_OR_MISSING]` 等标记字符串改为检查 `RenderResult.errors`
7. 验证：现有 `prompt_macro_resolver.spec.ts` 改为验证新 API 后全部通过 + 新增嵌套 `#if`/`else`/`#with`/`??` 测试

### 5.3 阶段三：插槽函数前端 + `slot-ref` POC

阶段三的目标是**端到端验证共享内核的扩展点**，而不仅是接口骨架。`slot-ref` 是最有验证价值的扩展点——它直接测试 `BlockHandlerFn` 注入、`RenderContext` 作用域栈、变量解析器扩展能否端到端工作。

1. 定义 `SlotFunctionContext` 类型（slot 注册表引用 + 作用域链）
2. **实现 `slot-ref` 块处理器 POC**：渲染时查询 slot 注册表（`PromptSlotRegistry`），如果 slot 启用则内联其渲染内容，如果禁用则输出空字符串。语法：`{{#slot-ref "system_core"}}...{{/slot-ref}}`
3. 定义 `scope` 块处理器接口（`{{#scope var_name=value}}...{{/scope}}`），实现留空——作用域链如何与 slot 注册表交互、全局变量在哪里定义，这些是插槽函数核心设计的开放问题，不应在此阶段预先决定
4. 验证：`slot-ref` POC 的端到端集成测试（模板 → slot 注册表 → 渲染结果）

**理由**：`slot-ref` 实现成本极低（查注册表 + 条件渲染），但能验证内核扩展点的关键假设。`scope` 块则依赖尚未明确的作用域设计，实现它等于提前做设计决策。

### 5.4 迁移依赖图

以下列出所有受影响的内部消费方及其迁移顺序。原则：**阶段一和阶段二可独立执行，但每个阶段内部需按依赖顺序自底向上迁移。**

```
阶段一（parser/ → template_engine/core/）
═══════════════════════════════════════════

  parser/ 目录
  ├── lexer.ts ───────────── 搬迁到 core/lexer.ts
  ├── parser.ts ──────────── 搬迁到 core/parser.ts
  ├── renderer.ts ────────── 搬迁到 core/renderer.ts
  ├── types.ts ───────────── 搬迁到 core/types.ts（+ RenderScope→RenderContext 扩展）
  ├── builtins.ts ────────── 搬迁到 defaults.ts
  ├── syntax_defaults.ts ─── 合并到 defaults.ts
  └── index.ts ───────────── createParser() 工厂保留，路径更新
       │
       └── 消费方：entry_renderer.ts
            └── 修改：import { render } from '../parser/index.js'
                   → import { render } from '../template_engine/frontends/data_cleaner/index.js'

  contracts/
  └── structured_parser.ts ── 类型移入 core/types.ts，源文件删除（零跨包消费方，确认无误）

阶段二（narrative/ → template_engine/frontends/narrative/）
═══════════════════════════════════════════════════════════════

  inference/types.ts ─── 导入 PromptVariableContext, PromptVariableContextSummary
  inference/context_config_resolver.ts ─── 导入 PromptVariableRecord, PromptVariableValue
  inference/context_builder.ts ─── 导入 narrative/ 类型
  core/active_pack_runtime_facade.ts ─── 导入 narrative/ 类型
       │
       ├── 以上 4 个文件仅导入 narrative/types.ts 中的类型定义
       │   → 迁移策略：types.ts 搬迁到 frontends/narrative/types.ts，更新 import 路径
       │   → 不涉及 API 行为变更（类型结构不变）
       │
  domain/perception/template_renderer.ts ─── 导入 NarrativeResolver/resolver 逻辑
  context/workflow/tracks/template_track.ts ─── 导入 NarrativeResolver/resolver 逻辑
       │
       └── 以上 2 个文件依赖 renderNarrativeTemplate() 行为
           → 迁移策略：阶段二重写后，同步改为调用 createNarrativeRenderer()
           → 返回类型从 PromptMacroRenderResult 改为 RenderResult
           → 标记字符串消费逻辑替换为 diagnostics 检查

  narrative/ 目录（迁移后整体删除）
  ├── types.ts ───────────── 搬迁到 frontends/narrative/types.ts
  ├── variable_context.ts ─── 搬迁到 frontends/narrative/variable_context.ts（重写）
  └── resolver.ts ─────────── 重写为 frontends/narrative/resolver.ts
```

**迁移顺序**：阶段一先执行（`parser/` → `core/`），因为阶段二的 Narrative 前端依赖共享内核。每个阶段内，先搬迁类型和基础设施文件，再修改消费方 import 路径，最后删除旧目录。

### 5.5 阶段四：Rust Sidecar（不动）

Rust Sidecar 的 `{{ }}` 插值能力极简（无条件/迭代），且运行在独立进程。保持现状，不参与本轮统一。

## 6. 语法兼容性矩阵

| 语法 | 当前 NarrativeResolver | 迁移后 Narrative 前端 | Data Cleaner 前端 | 插槽函数前端 |
|------|----------------------|---------------------|-------------------|-------------|
| `{{ path }}` 插值 | ✅ | ✅ | ✅（`{path}` 语法） | ✅ |
| `{{ path \| default(x) }}` | ✅ | ✅ | ❌（管道链语法不同） | ✅ |
| `{{ path ?? fallback_path }}` | ❌（`??` 仅 config resolver） | ✅ | ❌ | ✅ |
| `{{#if expr}}...{{/if}}` | ✅（无 else，不支持嵌套） | ✅（支持 else 和嵌套） | ❌ | ✅ |
| `{{#if expr}}...{{else}}...{{/if}}` | ❌ | ✅ | ✅（`{{#if}}...{{else}}...{{/if}}`） | ✅ |
| `{{#each path as alias}}...{{/each}}` | ✅ | ✅ | ✅（`{{#each path}}...{{/each}}`） | ✅ |
| `{{#with path}}...{{/with}}` | ❌ | ✅ | ✅ | ✅ |
| `{name \| upper \| trim}` 管道链 | ❌ | ❌ | ✅ | ❌ |
| `{{slot_name}}` 内联 slot 引用 | ❌ | ❌ | ❌ | ✅（`VariableNode` + `VariableResolver` 查 slot 注册表分流，阶段三 POC） |
| `{{#slot-ref "slot_id"}}...{{/slot-ref}}` 块 slot 引用 | ❌ | ❌ | ❌ | ✅（阶段三 POC） |
| `{{#scope var=val}}...{{/scope}}` | ❌ | ❌ | ❌ | ✅（接口定义，实现待插槽函数核心设计） |
| `{!-- comment --}` | ❌ | ❌ | ✅ | ❌ |

分隔符配置通过 `SyntaxConfig` 区分：Narrative 用 `{{`/`}}`，Data Cleaner 用 `{`/`}` + `{{`/`}}`。

## 7. 与插槽函数需求的对齐

### 7.1 内置 slot 禁用后引用 → 内联 `{{slot_name}}` + 块 `{{#slot-ref}}`

TODO: "内置slot既然可以被关闭，那自然可以使用类似的宏语法或者函数名 `{{system_core}}` 来指代原来已经被禁用的内置slot"

**映射**: 两种形式并存，覆盖不同场景：

- **内联 `{{system_core}}`**：lexer 统一标记为 `VAR_OPEN/CLOSE`，parser 构建 `VariableNode { path: 'system_core', pipeline: [] }`。区分发生在渲染层——Narrative 前端的 `VariableResolver` 解析路径时，先查询 slot 注册表（`PromptSlotRegistry`）：若路径匹配已注册 slot 名，委托给 `SlotRefResolver` 内联其内容（slot 启用）或输出空字符串（slot 禁用）；否则执行正常的命名空间变量查找。语法直接匹配 TODO 原文，且与变量插值共用 `{{ }}` 分隔符。
- **块 `{{#slot-ref "system_core"}}fallback{{/slot-ref}}`**：解析为 `BlockNode { keyword: 'slot-ref' }`，渲染时同样查询注册表，但支持 fallback body——slot 禁用时渲染 body 内容作为回退。适用于需要默认内容的场景。

两种形式的区分：内联形式在渲染层通过 `VariableResolver` 查询 slot 注册表分流；块形式在解析层通过 `BLOCK_OPEN` token → `BlockNode`。参见 §4.0 关键决策。

### 7.2 slot 之间的相对定位 → slot 定位系统（独立设计）

TODO: "slot 定义加入绝对位置和相对位置的动态定位功能"

**不在本设计范围**。这是 `PromptFragmentPlacementMode` / `PromptFragmentAnchor` 层面的问题，属于 `placement_resolution` executor 的领域。共享内核只管"怎么渲染模板"，不管"内容在 slot 中的排列"。slot 定位系统需要在现有的 placement 系统上独立设计，参见 TODO.md 中的警告。

### 7.3 宏嵌套/作用域 → 作用域栈 + `scope` 块

TODO: "引入函数的内联/嵌套/封装/作用域概念" / "允许在顶级空间之外定义变量作为全局变量"

**映射**: 共享内核的 `RenderContext.scopeStack` 提供作用域链。插槽函数前端的 `{{#scope var_name=value}}...{{/scope}}` 块创建新栈帧，内部变量覆盖外层同名变量。全局变量在 `variables` 根层定义，`scope` 块可以遮蔽但不修改。

### 7.4 自定义函数/脚本执行 → 隔离运行时（未来）

TODO: "允许执行图灵完备的代码"

**不在本设计范围**。图灵完备脚本执行需要独立的沙箱运行时（Lua/JS/WASM），与声明式模板引擎有根本性差异。共享内核的 `BlockHandlerFn` 和 `ModifierFn` 只接受字符串参数返回字符串，不支持副作用或状态。脚本执行系统的边界和接口需要在插槽函数核心设计启动时单独明确。

## 8. 诊断系统设计

当前 NarrativeResolver 有 `PromptMacroDiagnostics`（traces、missing_paths、restricted_paths、blocks）。共享内核统一为 `RenderDiagnostics`：

```typescript
export interface RenderResult {
  text: string
  diagnostics: RenderDiagnostics
}

export interface RenderDiagnostics {
  traces: VariableResolutionTrace[]
  missing_paths: string[]
  restricted_paths: string[]
  blocks: BlockExecutionTrace[]
  namespaces_used?: string[]
  output_length?: number
  template_source?: string
  errors: TemplateError[]       // 新增：结构化错误取代标记字符串
}
```

```typescript
export interface TemplateError {
  code: string            // 错误码，如 'MISSING_VARIABLE', 'RESTRICTED_ACCESS', 'INVALID_TEMPLATE', 'RECURSION_DEPTH', 'OUTPUT_LIMIT'
  path?: string           // 相关的变量路径
  message: string
  offset?: number
}
```

**`ParserDiagnostic` → `TemplateError` 演化**：`ParserDiagnostic` 保留为 parser 内部类型（阶段一不变），renderer 在构建 `RenderDiagnostics` 时将其转换为 `TemplateError`。`TemplateError` 是唯一对外公共错误类型。

| `ParserDiagnostic.kind` | 触发条件 | → `TemplateError.code` |
|---|---|---|
| `'warning'` | Empty variable/macro expression | `'EMPTY_EXPRESSION'` |
| `'error'` | Block without keyword | `'MALFORMED_BLOCK'` |
| `'error'` | Block close keyword mismatch | `'UNMATCHED_BLOCK'` |
| `'error'` | Unexpected block close | `'UNEXPECTED_CLOSE'` |

渲染阶段新增的错误（`MISSING_VARIABLE`、`RESTRICTED_ACCESS`、`RECURSION_DEPTH`、`OUTPUT_LIMIT`）由 renderer 或 `VariableResolver` 直接产出为 `TemplateError`，不经 `ParserDiagnostic`。

**关键改进**：当前 NarrativeResolver 用 `[INVALID_TEMPLATE_CONTENT]`、`[RESTRICTED_OR_MISSING]` 等标记字符串混入输出文本。迁移后 **立刻切换为结构化错误**，不再将错误标记嵌入输出：

- `RenderResult` 包含 `errors: TemplateError[]`，渲染调用方根据错误类型决定行为（日志、降级、中止）
- 输出文本中不再出现 `[RESTRICTED_OR_MISSING]` 等标记——变量缺失时输出空字符串，同时在 `diagnostics.missing_paths` 记录路径
- 阶段二的 Narrative 前端迁移时同步更新所有依赖 `renderNarrativeTemplate` 结果的调用方（template track、perception renderer、pack runtime facade），将标记字符串消费逻辑替换为诊断检查

这意味着阶段二是**破坏性变更窗口**——所有检查输出文本中错误标记的代码都需要改造。无外部/生产使用者，成本完全可控。

## 9. 性能考量

### Narrative 前端改进

| 关注点 | 当前（NarrativeResolver） | 迁移后（Narrative 前端） | 变化性质 |
|--------|------|------|------|
| 扫描策略 | 三遍独立正则（插值 `#if` `#each` 各一遍）+ 递归 | 内核一次 tokenize → 一次 AST → 一次遍历渲染 | 实际改进 |
| 递归深度 | 硬编码 10 层 | 可配置默认 32 层 | 上限提升（非性能） |
| 输出长度 | 硬编码 32,000 | 可配置 | 上限提升（非性能） |
| 作用域查找 | `localScope` 扁平字典 O(1) | 栈式作用域链 O(depth)，depth 通常 ≤ 5 | 轻微退化，实践中不可感知 |

### Data Cleaner 前端

Data Cleaner 迁移前后均为 `lexer → token → AST → renderer` 流程，流水线结构无变化。现有 `parser/` 模块已具备一次扫描 + 32 层递归深度保护。迁移到共享内核后性能特征不变。

## 10. 测试策略

| 阶段 | 测试重点 |
|------|---------|
| 阶段一 | 现有 `template_engine_plugin.spec.ts` 迁移到新路径后全部通过；内核 tokenize/parse/render 的单元测试 |
| 阶段二 | 现有 `prompt_macro_resolver.spec.ts` 迁移到新 API 后全部通过；新增：嵌套 `#if`、`else`、`#with`、`??`、结构化错误、深度递归 |
| 阶段三 | `slot-ref` 块处理器 POC 端到端测试（模板 → slot 注册表 → 渲染结果）；`scope` 块接口类型测试；`SlotFunctionContext` 类型验证 |

## 11. 风险与缓解

| 风险 | 缓解 |
|------|------|
| NarrativeResolver 重写引入回归 | 阶段二要求所有测试通过后再合并；新 API 返回 `RenderResult` 消除标记字符串 |
| Data Cleaner 公共 API 变化 | 直接删除 `parser/` 目录，消费方迁移到新路径；不做 facade |
| 两个前端行为微妙差异 | 共享内核的 renderer 和 diagnostics 收集是同一份代码，仅变量解析和块语义不同 |
| 插槽函数需求膨胀 | 阶段三只实现 `slot-ref` POC（验证内核扩展点），`scope` 块只定义接口；`slot-ref` 实现成本极低（查注册表 + 条件渲染） |

## 12. 命名与模块归属

| 当前 | 迁移后 | 说明 |
|------|--------|------|
| `apps/server/src/parser/lexer.ts` | `apps/server/src/template_engine/core/lexer.ts` | 移动 |
| `apps/server/src/parser/parser.ts` | `apps/server/src/template_engine/core/parser.ts` | 重构 |
| `apps/server/src/parser/renderer.ts` | `apps/server/src/template_engine/core/renderer.ts` | 重构 |
| `apps/server/src/parser/types.ts` | `apps/server/src/template_engine/core/types.ts` | 合并+扩展 |
| `apps/server/src/parser/types.ts` → `MacroNode` | **移除** | 方案 B（§4.0）下不再需要独立宏节点；内联引用统一为 `VariableNode`，块引用为 `BlockNode` |
| `apps/server/src/parser/builtins.ts` | `apps/server/src/template_engine/defaults.ts` | 移动 |
| `apps/server/src/parser/syntax_defaults.ts` | `apps/server/src/template_engine/defaults.ts` | 合并 |
| `packages/contracts/src/structured_parser.ts` | **删除** | 类型移入 server，contracts 删除（零跨包消费方） |
| `apps/server/src/narrative/resolver.ts` | `apps/server/src/template_engine/frontends/narrative/resolver.ts` | 重写 |
| `apps/server/src/narrative/variable_context.ts` | `apps/server/src/template_engine/frontends/narrative/variable_context.ts` | 移动+重写 |
| `apps/server/src/narrative/types.ts` | `apps/server/src/template_engine/frontends/narrative/types.ts` | 移动+重写 |
| — | `apps/server/src/template_engine/frontends/data_cleaner/` | 新增（直接使用内核） |
| — | `apps/server/src/template_engine/frontends/slot_function/` | 新增（阶段三） |
| `apps/server/src/parser/` | **删除** | 整个目录删除，消费方迁移到 `template_engine/` |
| `apps/server/src/narrative/` | **删除** | 整个目录删除，消费方迁移到 `template_engine/frontends/narrative/` |

## 13. 已决策

| # | 问题 | 决策 |
|---|------|------|
| 1 | Narrative 语法是否迁移到 `{ }` | **否** — 保持 `{{ }}`（不是因为兼容性，而是 `{{ }}` 本身就是合适的 prompt 模板语法） |
| 2 | 错误标记字符串何时移除 | **立刻切换** — 阶段二直接重写返回类型为 `RenderResult`，所有调用方同步改造，不做兼容期 |
| 3 | 阶段三范围：接口骨架 vs POC | **实现 `slot-ref` POC** — 端到端验证内核扩展点；`scope` 块只定义接口（作用域设计是开放问题） |
| 4 | `context_config_resolver.ts` 的 `??` 语法 | **永久并存，代码不合并** — 两者实现同一语义（null-coalescing 路径回退）但处于不同架构层：`resolveConfigValues()` 在配置加载期展开静态配置值（输入 `runtimeObjects` 扁平字典，产出 `PromptVariableRecord` 进入变量池），共享内核 `??` 修饰符在模板渲染期解析动态路径回退（输入 `RenderContext` 含作用域链和 slot 注册表）。让 config resolver 依赖模板内核会制造架构倒置（变量池生产者依赖消费者）。详见 §4 D2 补充说明 |
| 5 | `parser/` 和 `narrative/` 目录是否保留 | **直接删除** — 项目未上线无外部/生产使用者，不做 facade，消费方直接迁移到新路径（详见 §5.4 迁移依赖图） |
| 6 | `packages/contracts` 类型迁移 | **移入 server，contracts 直接删除 `structured_parser.ts`** — 零跨包消费方，不做 re-export |
| 7 | `MacroNode` 的去留 | **移除 `MacroNode`（含 `SlotRefNode`）** — 方案 B（§4.0）下内联 `{{slot_name}}` 统一为 `VariableNode`，渲染时由 `VariableResolver` 查 slot 注册表分流。`MACRO_OPEN`/`MACRO_CLOSE` token 保留，仅 Data Cleaner 前端使用（其 `{ }` ≠ `{{ }}`） |
| 8 | `#each as alias` 解析归属 | **前端各自解析** — 内核 parser 只存原始 `condition` 字符串。Narrative `each` handler 自行解析 `path as alias`；Data Cleaner `each` handler 用 `item`/`index`/`first`/`last` 硬编码 |
| 9 | 诊断系统边界 | **内核产出 diagnostics，前端决定暴露粒度** — Narrative 前端返回 `RenderResult`；Data Cleaner 前端保持返回 `string`（内部丢弃 diagnostics） |
| 10 | `SyntaxConfig` 结构 | **方案 B：扁平 `keywords: string[]` + 注册时声明 `kind`** — `delimiters` 保持当前结构（lexer 零改动）；`blocks` 采用扁平数组；`BlockHandlerRegistration.kind`（`'conditional'|'iteration'|'context'|'custom'`）在注册时附带，用于 diagnostics 自描述。详见 §4.3 D4 补充说明 |
| 11 | 开工范围 | **全部阶段按序推进** — 阶段一 → 阶段二 → 阶段三。阶段五（Rust Sidecar，§5.5）不动 |

## 14. 审查：逻辑断裂与整改项

> 以下问题由代码现实与设计草案交叉审查发现。每条标注严重程度和涉及的章节，供整改时逐条关闭。

### I1 — Rust Sidecar 定位误导（严重，§1, §5.4）

**问题**：§1 将 Rust Sidecar 与两个 TS 模板引擎并列称为"三个独立的模板/宏引擎"，制造了"三大引擎统一"的错觉。实际上 Rust Sidecar 只有 73 行纯插值代码（`render_string_template` — 无条件/迭代/宏/块语法），更接近数据层工具而非模板引擎。

**整改**：§1 已修正——导语区分"两个 TS 模板引擎"和"一个 Rust 数据层插值工具"，表格新增"分类"列明确标注各组件角色。Rust Sidecar 保持不动（§5.4）。

### I2 — "共享内核"叙事与实际增量不匹配（中等，§1, §3, §5.1） — 已整改

**问题**：§1 曾将选择框架为"升级 Parser 为万能引擎"vs"从零构建新系统"，暗示需要大量新基建。但现有 `parser/` 模块已具备完整流水线，真正的增量仅为类型扩展 + Narrative 前端编写。

**整改**：§1 核心矛盾已重写为准确描述（NarrativeResolver 正则瓶颈 → AST 替代；`parser/` 已有基建，增量为 `RenderScope→RenderContext` + Narrative 前端）；§3 新增说明段落明确内核从 `parser/` 搬迁+扩展；§5.1 步骤标注了搬迁 vs 重构的具体边界。

### I3 — Narrative 前端的 `{{ }}` 分隔符歧义导致 AST 节点无法区分（严重，§4.1, §6, §7.1） — 已整改

**问题**：§4.1 曾定义 `VAR_OPEN/CLOSE` 和 `MACRO_OPEN/CLOSE` 两套分隔符，但 Narrative 前端只有一对 `{{ }}`，lexer 无法在 tokenize 阶段区分 `VariableNode` 和 `SlotRefNode`。

**整改**：采用方案 B（§4.0 新增关键决策章节）——Narrative 前端统一将 `{{ }}` 解析为 `VariableNode`，区分逻辑从 lexer 层移到渲染层 `VariableResolver`（查询 slot 注册表分流）。`SlotRefNode` 从 AST 节点类型中移除。连锁更新：§4.1 类型定义、§4.2 `RenderContext`（移除 `resolveSlotRef` 字段）、§6 兼容性矩阵、§7.1 slot 引用映射、决策 #7、§12 命名表。

### I4 — `context_config_resolver.ts` 的 `??` 与共享内核 `??` 双重实现（中等，§4 D2, 决策 #4） — 已整改

**问题**：决策#4 曾只简单说"保持独立，代码不合并"，未说明理由。

**整改**：决策#4 已扩展为详细说明（架构层差异、生产者/消费者关系、为何合并会制造架构倒置）。§4 D2 新增补充说明段落，以表格对比两者在时机/输入/上下文/产出/角色上的差异，明确标注"永久并存，不合并"。

### I5 — 权限模型迁移路径缺失（中等，§4 D1, §8） — 已整改

**问题**：曾未说明权限检查从 `NarrativeResolver.buildVisiblePool` 预过滤迁移到新架构后的行为。

**整改**：§4.3 D1 新增"权限模型迁移"补充说明——采用方案 A（保持预过滤）：`canAccess()`/`buildVisiblePool()` 逻辑从 `NarrativeResolver` 搬到 Narrative 前端 `createNarrativeRenderer()` 工厂，构造时一次性检查。明确标注行为规范（检查时机、拒绝后输出、消费方无变更）和不采用延迟检查的理由。附工厂函数代码示例。

### I6 — "无使用者"声明不准确（中等，§2 目标5, §5） — 已整改

**问题**：§2 目标5 和 §5 曾多处声称"项目未上线，无使用者"。但代码库有 6 个活跃内部消费方。更关键的是缺少迁移顺序依赖图。

**整改**：所有"无使用者"已修正为"无外部/生产使用者"。新增 §5.4 迁移依赖图——列出 parser/ 和 narrative/ 的全部消费方、导入内容、迁移策略（类型搬迁 vs API 重写）和自底向上的执行顺序。阶段一和阶段二独立可执行。

### I7 — `ParserDiagnostic` → `TemplateError` 演化路径未定义（低，§8, §10） — 已整改

**问题**：曾未说明 `ParserDiagnostic` 与 `TemplateError` 的关系和转换路径。

**整改**：§8 新增"`ParserDiagnostic` → `TemplateError` 演化"段落——`ParserDiagnostic` 保留为 parser 内部类型，renderer 构建 `RenderDiagnostics` 时转换。附 4 种 `kind` → `code` 完整映射表。渲染阶段新增错误直接产出 `TemplateError`，不经 `ParserDiagnostic`。

### I8 — §9 性能对比表对 Parser 模块的改进有误导性（低，§9） — 已整改

**问题**：曾将 Narrative 和 Data Cleaner 的性能特征混在同一表格中，且未区分"实际改进"和"上限提升"。

**整改**：§9 拆分为"Narrative 前端改进"（新增"变化性质"列——实际改进/上限提升/轻微退化）和"Data Cleaner 前端"（明确标注迁移无变化）。作用域查找的 O(1)→O(depth) 退化如实标注，同时注明实践中不可感知。

### I9 — `SyntaxConfig.blocks.keywords` 扁平化丢失了块类型语义（中等，决策 #10） — 已整改

**问题**：曾担心扁平 `keywords: string[]` 丢失分类结构中的块类型信息。

**整改**：采用方案 B — `SyntaxConfig.blocks` 保持扁平 `keywords: string[]`，新增 `BlockHandlerKind` 类型（`'conditional' | 'iteration' | 'context' | 'custom'`）和 `BlockHandlerRegistration` 接口（`{ kind, fn }`）。`RenderContext.blockHandlers` 类型从 `Record<string, BlockHandlerFn>` 改为 `Record<string, BlockHandlerRegistration>`。类型元数据在注册时声明，用于 diagnostics 自描述，不参与内核解析逻辑。§4.3 D4 新增补充说明（含代码示例和三方案对比理由）。

### I10 — `SlotRefNode.args` 的"当前不使用，保留扩展"是过早抽象（低，§4.1） — 已随 I3 解决

**问题**：`SlotRefNode.args` 是过早抽象。**I3 方案 B 已移除 `SlotRefNode` 整体**，此问题不再适用。

## 15. 开放问题

→ 以下开放问题由 §14 审查产生，需在整改中逐一关闭。

| # | 问题 | 来源 | 状态 |
|---|------|------|------|
| O1 | Narrative 前端只有一对分隔符 `{{ }}`，lexer 如何区分 `VariableNode` 和 `SlotRefNode`？ | I3 | 已决策：方案 B — 统一为 `VariableNode`，渲染时 `VariableResolver` 查 slot 注册表分流。详见 §4.0 |
| O2 | `context_config_resolver.ts` 的 `??` 与共享内核 `??` 是否永久并存？如果是，理由是什么？ | I4 | 已决策：永久并存，架构层不同（生产者 vs 消费者），合并会制造架构倒置。详见 §4 D2 补充说明 |
| O3 | 权限模型从"预过滤"迁移到"延迟解析+标记"的行为规范是什么？ | I5 | 已决策：方案 A — 不改为延迟解析，保持预过滤。权限检查搬到 `createNarrativeRenderer()` 工厂，消费方无行为变更。详见 §4.3 D1 |
| O4 | `parser/` 和 `narrative/` 删除时内部消费方的迁移顺序依赖图 | I6 | 已补充：§5.4 迁移依赖图列出全部消费方、导入内容、迁移策略和执行顺序 |
| O5 | `ParserDiagnostic` → `TemplateError` 的迁移策略（废弃 vs 共存、`kind` → `code` 映射） | I7 | 已决策：`ParserDiagnostic` 保留为内部类型，renderer 转换。详见 §8 新增段落 |
| O6 | `SyntaxConfig.blocks` 结构最终选择（分类 vs 扁平 + handler kind） | I9 | 已决策：方案 B — 扁平 `keywords: string[]` + `BlockHandlerRegistration.kind`。详见 §4.3 D4 补充说明 |