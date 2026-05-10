# 模板引擎统一实现计划

> 关联设计: `.limcode/design/template-engine-unification-design.md`
> 状态: 已完成

## Progress

| Phase | 状态 | 完成日期 |
|-------|------|----------|
| Phase 1 (内核提取 + Data Cleaner 迁移) | ✅ 完成 | 2026-05-06 |
| Phase 2 (NarrativeResolver 重写) | ✅ 完成 | 2026-05-06 |
| Phase 3 (插槽函数前端 + slot-ref POC) | ✅ 完成 | 2026-05-06 |

---

## Phase 1: 内核提取 + Data Cleaner 直接迁移

### 目标

将 `parser/` 模块搬迁到 `template_engine/core/`，扩展 `RenderScope` → `RenderContext`，创建 Data Cleaner 前端，删除原有 `parser/` 目录，更新所有消费方引用路径。

### 1.1 创建目录结构

```bash
mkdir -p apps/server/src/template_engine/core
mkdir -p apps/server/src/template_engine/frontends/data_cleaner
mkdir -p apps/server/src/template_engine/frontends/narrative
mkdir -p apps/server/src/template_engine/frontends/slot_function
```

### 1.2 搬迁核心文件（零逻辑变更）

将以下文件从 `parser/` 原样搬迁到 `template_engine/core/`：

| 源 | 目标 | 说明 |
|---|------|------|
| `parser/lexer.ts` | `template_engine/core/lexer.ts` | 搬迁，Token 结构保持 `type` 字段名不变（`kind` 改名推迟到阶段二） |
| `parser/parser.ts` | `template_engine/core/parser.ts` | 搬迁，解析逻辑完全不变 |
| `parser/renderer.ts` | `template_engine/core/renderer.ts` | 搬迁，渲染骨架不变 |
| `parser/types.ts` | `template_engine/core/types.ts` | 搬迁 + 类型扩展（见 1.3） |
| `parser/builtins.ts` | `template_engine/defaults.ts` | 搬迁，零逻辑变更 |
| `parser/syntax_defaults.ts` | 内容合并到 `template_engine/defaults.ts` | 合并后删除 |

搬迁过程中，每个文件的内部 import 路径改为 `template_engine/core/` 下的 `.js` 相对路径。

### 1.3 类型层重构：`RenderScope` → `RenderContext`

在 `template_engine/core/types.ts` 中，**保留搬迁过来的所有类型不变**，增加以下新类型：

```typescript
// === 新增：RenderContext（扩展 RenderScope） ===

export interface ScopeFrame {
  variables: Record<string, unknown>;
  label?: string;
}

export type VariableResolver = (
  path: string,
  pipeline: PipelineStep[],
  context: RenderContext
) => ResolvedVariable;

export interface ResolvedVariable {
  value: unknown;
  missing: boolean;
  restricted?: boolean;
  trace?: VariableResolutionTrace;
}

// PipelineStep 复用现有 ModifierSpec 结构但语义更明确
// 两者在实现中等价：{ name: string; args: string[] }

export type BlockHandlerKind = 'conditional' | 'iteration' | 'context' | 'custom';

export interface BlockHandlerRegistration {
  kind: BlockHandlerKind;
  fn: BlockHandlerFn;
}

export interface RenderContext {
  variables: Record<string, unknown>;
  resolve: VariableResolver;
  modifiers: Record<string, ModifierFn>;
  blockHandlers: Record<string, BlockHandlerRegistration>;
  scopeStack: ScopeFrame[];
  depth: number;
  maxDepth: number;
  maxLength: number;
  diagnostics: RenderDiagnostics;
}

// === 新增：统一诊断系统 ===

export interface RenderDiagnostics {
  traces: VariableResolutionTrace[];
  missing_paths: string[];
  restricted_paths: string[];
  blocks: BlockExecutionTrace[];
  namespaces_used?: string[];
  output_length?: number;
  template_source?: string;
  errors: TemplateError[];
}

export interface VariableResolutionTrace {
  expression: string;
  resolved_path: string;
  resolved: boolean;
  missing: boolean;
  restricted?: boolean;
  value_preview?: string;
  fallback_applied?: boolean;
  source?: string;
}

export interface BlockExecutionTrace {
  kind: string;
  expression: string;
  executed: boolean;
  iteration_count?: number;
  alias?: string;
}

export interface TemplateError {
  code: string;
  path?: string;
  message: string;
  offset?: number;
}

export interface RenderResult {
  text: string;
  diagnostics: RenderDiagnostics;
}

// === 新增：SyntaxConfig（替代 ParserSyntaxConfig 依赖） ===

export interface SyntaxConfig {
  delimiters: {
    variable: { open: string; close: string };
    macro: { open: string; close: string };
    blockOpen: { open: string; close: string };
    blockClose: { open: string; close: string };
    comment: { open: string; close: string };
    escape: string;
  };
  modifiers: {
    chainSeparator: string;
    argOpen: string;
    argClose: string;
    namedArgSep: string;
  };
  blocks: {
    keywords: string[];
    elseKeyword: string;
    asKeyword: string;
  };
}
```

**关键决策**：
- `RenderScope` 保留不删（renderer 内部仍用 `RenderScope` 做参数类型），`RenderContext` 是 `RenderScope` 的超集
- `BlockHandlerFn` 签名**阶段一保持不变** `(condition, body, elseBody, scope, renderFn) => string`，阶段二 Narrative 前端需要时再扩展为 `(node, context, renderChildren) => string`
- `blockHandlers` 类型从 `Record<string, BlockHandlerFn>` 改为 `Record<string, BlockHandlerRegistration>`——包装现有处理函数
- `SyntaxConfig` 定义在 `core/types.ts`，**不再依赖 `@yidhras/contracts` 的 `ParserSyntaxConfig`**

### 1.4 适配 lexer/parser/renderer 到新类型

**lexer.ts**：
- 参数类型从 `ParserSyntaxConfig` 改为 `SyntaxConfig`
- 内部 `buildOpenDefs` / `buildCloseDefs` 适配新 `SyntaxConfig.blocks.keywords`（扁平数组）和 `SyntaxConfig.delimiters`（结构不变）

**parser.ts**：
- 参数类型从 `ParserSyntaxConfig` 改为 `SyntaxConfig`
- 块关键字识别从 `syntax.blocks.{conditional,iteration,context}.keyword` 改为 `syntax.blocks.keywords.includes(keyword)`
- `else` 检测从 `syntax.blocks.conditional.elseKeyword` 改为 `syntax.blocks.elseKeyword`

**renderer.ts**：
- 参数类型兼容 `RenderScope`（阶段一 renderer 不碰，仍用旧签名）
- `renderAst` 调用方传入 `scope` 时从 `blockHandlers: Record<string, BlockHandlerRegistration>` 提取 `fn`

### 1.5 创建 Data Cleaner 前端

`template_engine/frontends/data_cleaner/index.ts`：

```typescript
// 包装共享内核的 createParser 工厂，注入 Data Cleaner 领域的默认配置
// 语法：{var} 变量、{{#if}}...{{/if}} 块、{!-- comment --} 注释
// 修饰符：upper, lower, trim, capitalize, pad, truncate, default
// 块：if/else, each, with
// 变量解析：简单 flat key lookup

export const createDataCleanerParser = (overrides?: {
  syntax?: Partial<SyntaxConfig>;
  modifiers?: Record<string, ModifierFn>;
  blockHandlers?: Record<string, BlockHandlerFn>;
}): ParserInstance => {
  // 合并 Data Cleaner 默认配置 + overrides
  // 调用 core 的 createParser
};
```

Data Cleaner 前端的 `VariableResolver` 实现为简单 flat key lookup：

```typescript
const dataCleanerVariableResolver: VariableResolver = (path, _pipeline, context) => {
  const value = context.variables[path];
  return {
    value,
    missing: value === undefined,
    trace: { expression: path, resolved_path: path, resolved: value !== undefined, missing: value === undefined }
  };
};
```

### 1.6 迁移 contracts 类型

`packages/contracts/src/structured_parser.ts` 中的 `ParserSyntaxConfig` 和相关 Zod schema：

1. **确认零跨包消费方**：`ParserSyntaxConfig` 和 `ParserOutput` 仅在 `parser/` 模块内部使用，无任何 `apps/web/` 或其他 package 引用
2. **直接删除** `packages/contracts/src/structured_parser.ts`
3. 从 `packages/contracts/src/index.ts` 中移除 `export * from './structured_parser.js'`
4. Zod schema 不迁移——新 `SyntaxConfig` 是纯 TS 接口，运行时校验由调用方自行处理

### 1.7 更新消费方引用路径

**parser/ 消费方（3 个文件）**：

| 文件 | 当前 import | 改为 |
|------|------------|------|
| `conversation/entry_renderer.ts` | `import { render } from '../parser/index.js'` | `import { render } from '../template_engine/frontends/data_cleaner/index.js'` |
| `builtin/system_pack/plugins/template-engine/server.ts` | `import { render } from '../../../../src/parser/index.js'` | `import { render } from '../../../../src/template_engine/frontends/data_cleaner/index.js'` |
| `tests/unit/template_engine_plugin.spec.ts` | `await import('../../src/parser/index.js')` | `await import('../../src/template_engine/frontends/data_cleaner/index.js')` |

**测试文件 `tests/unit/structured_parser.spec.ts`**（415 行）：
- 所有 `../../src/parser/` 引用改为 `../../src/template_engine/core/`
- `createParser`, `parseTemplate`, `render` → 从 Data Cleaner 前端导入（或直接从 core 导入，视测试粒度而定）

### 1.8 删除旧 `parser/` 目录

```bash
rm -rf apps/server/src/parser/
```

### 1.9 阶段一验证

- [ ] `pnpm typecheck` 零错误
- [ ] `pnpm lint` 零错误
- [ ] `pnpm --filter yidhras-server test:unit` 全部通过（含 `structured_parser.spec.ts` 和 `template_engine_plugin.spec.ts`）
- [ ] `packages/contracts` 无 `structured_parser` 相关导出残留

---

## Phase 2: NarrativeResolver 重写

### 目标

用共享内核的 AST 能力重写 NarrativeResolver，删除 `narrative/` 目录，更新 6 个消费方 + 2 个脚本 + 1 个测试文件。

### 2.1 创建 Narrative 前端类型定义

`template_engine/frontends/narrative/types.ts`：

从 `narrative/types.ts` 搬迁所有类型定义（`PromptVariableNamespace`, `PromptVariableLayer`, `PromptVariableContext`, `PromptVariableContextSummary`, `PromptVariableResolutionMode`, `PromptVariableValueType`, `PromptVariableRecord`, `PromptVariableValue`），**结构完全不变**。

新增 `NarrativeRenderOptions` 和 `NarrativeSyntaxConfig`：

```typescript
export interface NarrativeRenderOptions {
  variableContext: PromptVariableContext;
  extraContext?: Record<string, unknown>;
  permission?: PermissionContext;
  templateSource?: string;
}

// Narrative 前端的语法配置（{{ }} 分隔符，不同于 Data Cleaner 的 { }）
export const NARRATIVE_SYNTAX: SyntaxConfig = {
  delimiters: {
    variable: { open: '{{', close: '}}' },
    macro: { open: '{{', close: '}}' },        // 与 variable 相同（方案 B）
    blockOpen: { open: '{{#', close: '}}' },
    blockClose: { open: '{{/', close: '}}' },
    comment: { open: '{!--', close: '--}' },
    escape: '\\'
  },
  modifiers: {
    chainSeparator: '|',
    argOpen: '(',
    argClose: ')',
    namedArgSep: '='
  },
  blocks: {
    keywords: ['if', 'each', 'with'],
    elseKeyword: 'else',
    asKeyword: 'as'
  }
};
```

### 2.2 搬迁并重写变量解析逻辑

`template_engine/frontends/narrative/variable_context.ts`：

从 `narrative/variable_context.ts` 搬迁以下函数（**零逻辑变更**）：
- `createPromptVariableLayer`
- `createPromptVariableContext`
- `normalizePromptVariableRecord`
- `createPromptVariableContextSummary`
- `flattenPromptVariableContextToVisibleVariables`
- `detectPromptVariableValueType`
- `previewPromptVariableValue`
- `lookupPromptVariable`
- `mergePromptMacroDiagnostics`
- `collectNamespacesFromTrace`
- `buildEmptyPromptMacroDiagnostics`
- `resolvePromptVariableResolutionMode`

内部类型引用路径更新为 `./types.js`。

### 2.3 创建 Narrative 变量解析器

`template_engine/frontends/narrative/resolvers.ts`：

```typescript
// 实现 VariableResolver 签名（匹配 core/types.ts 的 VariableResolver 类型）
// 包装 lookupPromptVariable，将结果转换为 ResolvedVariable

export const createNarrativeVariableResolver = (
  variableContext: PromptVariableContext
): VariableResolver => {
  return (path, pipeline, renderContext) => {
    const result = lookupPromptVariable({
      expression: path,
      path,
      context: variableContext,
      localScope: renderContext.scopeStack[renderContext.scopeStack.length - 1]?.variables
    });
    // 应用 pipeline（default() 等）
    // 返回 ResolvedVariable
  };
};
```

### 2.4 创建 Narrative 块处理器

`template_engine/frontends/narrative/blocks.ts`：

实现 Narrative 领域的块处理器（`if/else`、`each`、`with`），注册到 `RenderContext.blockHandlers`：

- **`if/else`**：解析条件表达式（变量路径），`isTruthyMacroValue` 判断真值，渲染 body 或 elseBody
- **`each`**：解析 `path as alias`，迭代数组，push/pop `scopeStack` 帧
- **`with`**：解析对象路径，展开属性到新 `scopeStack` 帧

块处理器签名适配 `BlockHandlerFn`（阶段一保持的旧签名），内部使用 `RenderContext.scopeStack` 管理作用域。

### 2.5 创建 Narrative 渲染器入口

`template_engine/frontends/narrative/resolver.ts`：

```typescript
export const createNarrativeRenderer = (options: {
  variableContext: PromptVariableContext;
  permission?: PermissionContext;
  templateSource?: string;
}) => {
  // 权限预过滤（保持现有 buildVisiblePool 语义）
  // 注入 Narrative 变量解析器 + default() 修饰符 + ?? 修饰符
  // 注册 if/else, each, with 块处理器
  // 返回 { render: (template: string) => RenderResult }
};

// 替代 renderNarrativeTemplate
export const renderNarrativeTemplate = (input: {
  template: string;
  variableContext: PromptVariableContext;
  extraContext?: Record<string, unknown>;
  permission?: PermissionContext;
  templateSource?: string;
}): RenderResult => {
  // 创建 Narrative 渲染器实例并调用
};
```

**关键变更**：
- 返回类型从 `PromptMacroRenderResult` 改为 `RenderResult`
- 不再返回 `[RESTRICTED_OR_MISSING]` / `[INVALID_TEMPLATE_CONTENT]` 等标记字符串——错误进入 `RenderResult.errors`
- 变量缺失时输出空字符串，路径记录在 `diagnostics.missing_paths`

### 2.6 更新 Narrative 消费方

已确认全部消费方及迁移策略：

**仅类型消费方（3 个文件，只改 import 路径）**：

| 文件 | 当前 import | 改为 |
|------|------------|------|
| `inference/types.ts` | `'../narrative/types.js'` | `'../template_engine/frontends/narrative/types.js'` |
| `inference/context_config_resolver.ts` | `'../narrative/types.js'` | `'../template_engine/frontends/narrative/types.js'` |
| `inference/context_builder.ts` | `'../narrative/types.js'` + `'../narrative/variable_context.js'` | 更新为 `template_engine/frontends/narrative/` |

**行为消费方（需要适配 RenderResult）**：

| 文件 | 导入 | 适配内容 |
|------|------|---------|
| `core/active_pack_runtime_facade.ts` | `renderNarrativeTemplate` + `variable_context` 工具 | `PromptMacroRenderResult` → `RenderResult`；标记字符串检查 → `diagnostics.errors` 检查 |
| `domain/perception/template_renderer.ts` | `renderNarrativeTemplate` + `variable_context` 工具 + 类型 | 同上 |
| `context/workflow/tracks/template_track.ts` | `renderNarrativeTemplate` | 同上 |

**脚本消费者（2 个）**：
- `scripts/manual/narrative_demo.ts`：更新为 `template_engine/frontends/narrative/`
- `scripts/manual/permission_demo.ts`：`NarrativeResolver` 类不再存在，改用 `createNarrativeRenderer`

### 2.7 删除旧 `narrative/` 目录

```bash
rm -rf apps/server/src/narrative/
```

### 2.8 阶段二验证

- [ ] `pnpm typecheck` 零错误
- [ ] `pnpm lint` 零错误
- [ ] `pnpm --filter yidhras-server test:unit` 全部通过（`prompt_macro_resolver.spec.ts` 的 134 行需适配新 API）
- [ ] `pnpm --filter yidhras-server test:integration` 全部通过
- [ ] 新增测试：嵌套 `#if`、`else`、`#with`、`??` 回退、结构化错误、递归深度保护
- [ ] `narrative/` 目录已删除，`grep -r "from.*narrative" apps/server/src/` 无残留引用

---

## Phase 3: 插槽函数前端 + `slot-ref` POC

### 目标

验证共享内核扩展点——实现 `slot-ref` 块处理器端到端 POC，定义 `scope` 块接口。

### 3.1 定义 `SlotFunctionContext` 类型

`template_engine/frontends/slot_function/types.ts`：

```typescript
export interface SlotRegistration {
  content: string;
  enabled: boolean;
}

export type SlotRegistry = Record<string, SlotRegistration>;

export interface SlotFunctionContext {
  slots: SlotRegistry;
}
```

### 3.2 实现 `slot-ref` 块处理器

`template_engine/frontends/slot_function/blocks.ts`：

```typescript
// slot-ref 块处理器：{{#slot-ref "system_core"}}fallback{{/slot-ref}}
// - slot 启用时 → 渲染 slot 内容
// - slot 禁用时 → 渲染 body 内容（fallback）
// - slot 不存在时 → 输出空字符串

export const slotRefBlockHandler: BlockHandlerFn = (
  condition,  // slot name（带引号的字符串字面量）
  body,
  _elseBody,
  scope,
  renderFn
) => {
  const slotName = parseSlotRefCondition(condition); // 去除引号
  const slotRegistry = (scope as SlotFunctionRenderScope).slotRegistry;
  const slot = slotRegistry?.[slotName];

  if (!slot) return '';                        // slot 不存在
  if (slot.enabled) return slot.content;       // slot 启用 → 内容
  if (body.length > 0) return renderFn(body, scope); // slot 禁用 → fallback body
  return '';                                   // 无 fallback
};
```

**架构验证点**：此实现直接验证 `BlockHandlerFn` 注入 + `RenderScope` 扩展是否端到端工作。`slotRegistry` 通过扩展作用域传入（`SlotFunctionRenderScope extends RenderScope`），测试内核扩展机制。

### 3.3 在 Narrative 前端集成 slot 自引用

在 Narrative 前端的 `VariableResolver`（`resolvers.ts`）中增加 slot 注册表查询分流：

```typescript
// 变量解析时先查 slot 注册表
// {{system_core}} → VariableNode { path: 'system_core' }
// → VariableResolver 查询 slotRegistry['system_core']
//   → 命中且 enabled → 返回 slot 内容
//   → 命中但 disabled → 返回空字符串
//   → 未命中 → 正常命名空间变量查找
```

### 3.4 定义 `scope` 块接口（仅接口，不实现）

`template_engine/frontends/slot_function/blocks.ts`：

```typescript
// scope 块处理器接口定义
// 语法：{{#scope var_name=value}}...{{/scope}}
// 创建新作用域帧，内部变量遮蔽外层同名变量
// 实现留空——作用域链与 slot 注册表的交互、全局变量定义位置是开放问题

export const scopeBlockHandler: BlockHandlerFn = (_condition, _body, _elseBody, _scope, _renderFn) => {
  // TODO: 待插槽函数核心设计确定后实现
  return '';
};
```

### 3.5 端到端集成测试

新增 `tests/integration/slot_ref.spec.ts`：

```typescript
// 测试用例：
// 1. 内联 {{slot_name}} → slot 启用时输出 slot 内容
// 2. 内联 {{slot_name}} → slot 禁用时输出空字符串
// 3. 块 {{#slot-ref "name"}}fallback{{/slot-ref}} → slot 启用时输出 slot 内容
// 4. 块 {{#slot-ref "name"}}fallback{{/slot-ref}} → slot 禁用时输出 fallback
// 5. slot 不存在时输出空字符串
// 6. 变量路径与 slot 同名时，slot 优先
```

### 3.6 阶段三验证

- [ ] `pnpm typecheck` 零错误
- [ ] `pnpm lint` 零错误
- [ ] `slot_ref.spec.ts` 全部通过
- [ ] 共享内核扩展点（`BlockHandlerFn` 注入、`RenderScope` 扩展、`VariableResolver` 扩展）全部端到端验证通过

---

## 受影响文件总览

### 新建文件

```
apps/server/src/template_engine/
├── core/
│   ├── lexer.ts                    # 从 parser/lexer.ts 搬迁
│   ├── parser.ts                    # 从 parser/parser.ts 搬迁
│   ├── renderer.ts                  # 从 parser/renderer.ts 搬迁
│   └── types.ts                     # 从 parser/types.ts 搬迁 + 扩展
├── defaults.ts                      # parser/builtins.ts + parser/syntax_defaults.ts 合并
├── frontends/
│   ├── data_cleaner/
│   │   └── index.ts                 # Data Cleaner 前端入口
│   ├── narrative/
│   │   ├── types.ts                 # 从 narrative/types.ts 搬迁
│   │   ├── variable_context.ts      # 从 narrative/variable_context.ts 搬迁
│   │   ├── resolvers.ts             # 新增：Narrative VariableResolver
│   │   ├── blocks.ts                # 新增：Narrative 块处理器
│   │   └── resolver.ts              # 新增：NarrativeRenderer 入口
│   └── slot_function/
│       ├── types.ts                 # 新增：SlotFunctionContext
│       └── blocks.ts                # 新增：slot-ref + scope 块处理器
```

### 删除文件/目录

```
apps/server/src/parser/             # 整个目录删除
apps/server/src/narrative/          # 整个目录删除
packages/contracts/src/structured_parser.ts  # 删除
```

### 修改文件

**阶段一（5 个文件）**：
- `conversation/entry_renderer.ts` — import 路径
- `builtin/system_pack/plugins/template-engine/server.ts` — import 路径
- `tests/unit/structured_parser.spec.ts` — import 路径
- `tests/unit/template_engine_plugin.spec.ts` — import 路径
- `packages/contracts/src/index.ts` — 移除 re-export

**阶段二（9 个文件）**：
- `inference/types.ts` — import 路径
- `inference/context_config_resolver.ts` — import 路径
- `inference/context_builder.ts` — import 路径
- `core/active_pack_runtime_facade.ts` — import 路径 + API 适配
- `domain/perception/template_renderer.ts` — import 路径 + API 适配
- `context/workflow/tracks/template_track.ts` — import 路径 + API 适配
- `tests/unit/prompt_macro_resolver.spec.ts` — import 路径 + API 适配
- `scripts/manual/narrative_demo.ts` — import 路径
- `scripts/manual/permission_demo.ts` — import 路径 + 类引用改为函数引用

**阶段三（0 个修改文件，仅新增）**

---

## 执行顺序

1. **Phase 1** — 独立，先执行（阶段二依赖共享内核）
2. **Phase 2** — 依赖阶段一完成
3. **Phase 3** — 依赖阶段二完成（需要 Narrative 前端作为 slot 解析的宿主）

每个阶段内部按自底向上顺序：类型/基础设施 → 核心逻辑 → 消费方迁移 → 旧代码删除。

## 校验方式

- `pnpm typecheck && pnpm lint` 零错误
- `pnpm test` 全部通过
- `grep -r "from.*\.\./parser" apps/server/src/` 无残留（阶段一后）
- `grep -r "from.*\.\./narrative" apps/server/src/` 无残留（阶段二后）
- `grep -r "structured_parser" packages/contracts/` 无残留（阶段一后）
- 新增嵌套 `#if` / `else` / `#with` / `??` 模板渲染正确
- `slot-ref` POC 端到端通过
