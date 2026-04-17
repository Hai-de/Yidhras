# 世界包与 Prompt Workflow 宏 / 变量系统正式化设计

## 0. 状态说明

本设计承接 `TODO.md` 中第二阶段“世界包与 Prompt Workflow 宏 / 变量系统正式化”。

当前项目尚未上线，历史临时数据与中间状态不作为主要约束；本阶段优先目标是：

1. 尽快把变量与宏系统收敛成正式 contract
2. 减少继续堆积隐式兼容逻辑带来的技术债
3. 在不强依赖旧数据迁移的前提下，尽量保留有限 compatibility bridge
4. 让 Prompt Workflow 已有 runtime/profile/diagnostics 能消费统一变量层

本设计不重做 Prompt Workflow 主体，而是补齐其尚未正式化的 **变量层、宏展开层、作用域/覆盖规则、调试 trace**。

---

## 1. 背景与当前问题

当前代码中，Prompt Workflow Runtime 已具备第一轮正式化骨架：

- `context/workflow/types.ts`
- `context/workflow/runtime.ts`
- `context/workflow/profiles.ts`
- `context/workflow/placement_resolution.ts`
- `context/workflow/section_drafts.ts`

但与变量/宏相关的能力仍存在明显缺口：

### 1.1 变量来源尚未正式分层

当前 `InferenceContext.visible_variables` 主要来自：

- 默认 `pack.variables`
- 如果存在 agent，则直接切换为 `agentContext.variables`

这意味着现在更接近“替换式来源”，而不是“layered merge + scoped lookup”。

### 1.2 NarrativeResolver 能力过弱

当前 `narrative/resolver.ts` 只支持：

- `{{ path.to.value }}` 基础路径替换
- 简单递归展开
- 简单权限过滤
- 缺失时返回 `[RESTRICTED_OR_MISSING]`

尚不支持：

- 默认值
- 条件块
- 列表展开
- 命名空间约束
- 变量来源解释
- step / template 级 trace

### 1.3 多个调用点各自拼上下文

当前 resolver 使用点分散在：

- `inference/prompt_builder.ts`
- `domain/perception/template_renderer.ts`
- `core/simulation.ts`

这导致：

- 变量来源不统一
- 调试难以定位
- 宏规则容易出现不同入口不一致
- 未来 world pack / plugin 再接入时会继续长出新分支

### 1.4 世界包变量、模板变量、运行时变量尚未统一作用域

当前：

- `pack.variables`
- `world prompts`
- 推理上下文临时变量
- actor/request/runtime 派生数据
- plugin executor 未来可能注入的数据

还没有被统一描述为一个正式的 **Variable Context Contract**。

---

## 2. 设计目标

## 2.1 核心目标

1. 定义正式的变量来源层级与命名空间
2. 定义受控宏能力边界，而不是引入通用脚本执行
3. 统一 world pack prompts、Prompt Workflow 模板、perception template 的变量解析行为
4. 为宏展开增加可观察 trace，保证错误可定位
5. 降低继续扩张旧隐式变量机制的风险
6. 与现有 Prompt Workflow Runtime 平滑接轨

## 2.2 非目标

本阶段不追求：

- 引入任意表达式执行引擎
- 支持 pack / plugin 自定义 JS 宏函数
- 建立前端模板编辑器或 playground
- 一次性彻底删除所有 legacy placeholder 写法
- 构建通用 DSL VM

---

## 3. 核心决策

## 3.1 采用显式命名空间变量模型

正式命名空间：

- `system.*`
- `app.*`
- `pack.*`
- `runtime.*`
- `actor.*`
- `request.*`
- `plugin.<pluginId>.*`

### 原则

1. **新模板优先使用命名空间写法**
2. 命名空间访问不依赖优先级覆盖，直接按命名空间解析
3. 未带命名空间的旧写法仅作为 compatibility alias surface
4. plugin 变量不得默认污染顶层 alias 空间

示例：

```txt
{{ pack.metadata.name }}
{{ actor.display_name }}
{{ runtime.world_state.opening_phase }}
{{ request.task_type }}
{{ plugin.memory_tool.summary }}
```

## 3.2 保留受控 alias fallback，但降级为兼容层

对未带 namespace 的写法，例如：

```txt
{{ actor_name }}
{{ world_name }}
```

保留 compatibility alias 解析，但明确其不是 source-of-truth。

### 默认 alias 优先级

```text
request > actor > runtime > pack > app > system
```

### 明确限制

- `plugin.*` 不参与默认 alias fallback
- 若多个 layer 都提供相同 alias，trace 中必须记录命中来源
- 新设计文档、world pack 示例、脚手架默认模板不再推荐无 namespace 写法

## 3.3 宏能力采用受控 Handlebars-like 子集

正式支持的首阶段宏能力：

1. **基础插值**
   - `{{ actor.display_name }}`
2. **默认值**
   - `{{ actor.title | default("unknown") }}`
3. **条件块**
   - `{{#if actor.has_bound_artifact}}...{{/if}}`
4. **列表展开**
   - `{{#each runtime.owned_artifacts as artifact}}...{{/each}}`

### 不支持

- 任意 JS 表达式
- eval / Function / script execution
- 算术表达式平台化扩展
- 自定义宏函数注册给 pack 作者自由执行
- 动态写变量 / 跨作用域 mutation

## 3.4 优先统一“变量层 contract”，再扩宏语法

本阶段实现顺序优先：

1. 变量来源正式化
2. resolver 调用入口收口
3. trace 接入 Prompt Workflow
4. 再扩 `default / if / each`

不先做复杂宏语法，以免在 source-of-truth 未收口时继续叠债。

## 3.5 兼容保留，但不以兼容为设计中心

由于项目尚未上线：

- 不把旧临时数据格式当主要约束
- 不为兼容写大量长期桥逻辑
- compatibility 可以保留，但应是“薄桥 + 易删”
- 允许在本阶段对内部变量结构做较直接的整理

---

## 4. 目标架构

建议新增主线：

```text
Variable Sources
  -> PromptVariableLayers
  -> PromptVariableContext
  -> MacroResolver / TemplateRenderer
  -> RenderResult + VariableTrace
  -> Prompt Workflow / Perception / Runtime Callers
```

核心新增对象：

1. `PromptVariableLayer`
2. `PromptVariableContext`
3. `PromptMacroRenderResult`
4. `PromptVariableResolutionTrace`
5. `PromptMacroDiagnostics`

---

## 5. 核心模型设计

## 5.1 PromptVariableNamespace

```ts
type PromptVariableNamespace =
  | 'system'
  | 'app'
  | 'pack'
  | 'runtime'
  | 'actor'
  | 'request'
  | 'plugin';
```

## 5.2 PromptVariableLayer

```ts
interface PromptVariableLayer {
  namespace: PromptVariableNamespace | `plugin.${string}`;
  values: Record<string, unknown>;
  alias_values?: Record<string, unknown>;
  metadata?: {
    source_label: string;
    mutable?: boolean;
    trusted?: boolean;
  };
}
```

### 说明

- `values` 存储命名空间内正式对象
- `alias_values` 仅用于兼容写法投影
- `plugin.<id>` 视为逻辑子命名空间，避免顶层冲突

## 5.3 PromptVariableContext

```ts
interface PromptVariableContext {
  layers: PromptVariableLayer[];
  alias_precedence: string[];
  strict_namespace: boolean;
}
```

### 说明

- `layers` 表示所有可见变量层
- `alias_precedence` 决定未命名空间写法如何 fallback
- `strict_namespace=true` 时，可用于未来逐步禁止新模板使用裸 key

## 5.4 PromptVariableResolutionTrace

```ts
interface PromptVariableResolutionTrace {
  expression: string;
  resolution_mode: 'namespaced' | 'alias_fallback';
  requested_path: string;
  resolved: boolean;
  resolved_layer?: string;
  resolved_path?: string;
  fallback_applied?: boolean;
  missing?: boolean;
  restricted?: boolean;
  value_preview?: string;
}
```

## 5.5 PromptMacroRenderResult

```ts
interface PromptMacroRenderResult {
  text: string;
  diagnostics: {
    template_source?: string;
    traces: PromptVariableResolutionTrace[];
    missing_paths: string[];
    restricted_paths: string[];
    blocks?: Array<{
      kind: 'if' | 'each';
      expression: string;
      executed: boolean;
      iteration_count?: number;
    }>;
  };
}
```

---

## 6. 变量来源与覆盖规则

## 6.1 正式来源层

本阶段按以下语义整理来源：

### A. `system`
平台内建常量、保底运行时信息。

示例：

- `system.name`
- `system.version`
- `system.timezone`

### B. `app`
部署配置、运行节点配置、feature flags 等。

示例：

- `app.features.ai_gateway_enabled`
- `app.runtime.environment`

### C. `pack`
world pack manifest/static contract 派生值。

示例：

- `pack.metadata.*`
- `pack.variables.*`
- `pack.prompts.*`
- `pack.ai.*`

### D. `runtime`
当前 active pack runtime state、tick、world state、projection snapshot。

示例：

- `runtime.current_tick`
- `runtime.world_state.*`
- `runtime.owned_artifacts`
- `runtime.latest_event`

### E. `actor`
当前 actor / identity / binding / agent snapshot。

示例：

- `actor.identity_id`
- `actor.display_name`
- `actor.role`
- `actor.agent_snapshot.*`

### F. `request`
当前请求/task/workflow 层输入。

示例：

- `request.task_type`
- `request.strategy`
- `request.attributes.*`
- `request.profile_id`

### G. `plugin.<id>`
插件注入变量，仅显式命名空间访问。

示例：

- `plugin.memory_tool.summary`
- `plugin.reputation.score`

## 6.2 Alias fallback 规则

旧模板写法解析顺序：

```text
request > actor > runtime > pack > app > system
```

### 理由

- 与当前 prompt/runtime 场景最贴近的是 request/actor
- runtime 比静态 pack 更接近“当前事实”
- app/system 作为更底层默认值
- plugin 不进入该链，避免隐式污染

## 6.3 命中策略

### 显式命名空间

- `pack.metadata.name` -> 只查 `pack`
- 若不存在 -> missing，不尝试 alias fallback

### 兼容 alias

- `actor_name` -> 依次查 alias layer
- 命中后记录 `resolved_layer`
- 如出现多个层同名，只按 precedence 第一命中

---

## 7. 宏语法边界

## 7.1 基础插值

```txt
{{ actor.display_name }}
{{ pack.metadata.name }}
```

规则：

- path lookup only
- 不支持任意表达式
- 标量直接字符串化
- object/array 默认不直接展开为复杂文本，避免意外 dump

## 7.2 默认值

```txt
{{ actor.title | default("unknown") }}
```

规则：

- 仅在 missing / null / empty string 时生效
- default 参数必须为字面量字符串或数字/布尔常量
- trace 记录 fallback_applied

## 7.3 条件块

```txt
{{#if actor.has_bound_artifact}}
持有关键媒介。
{{/if}}
```

规则：

- truthy/falsy 判定受控
- 不支持复杂布尔表达式链
- 首阶段仅支持单路径表达式

## 7.4 列表展开

```txt
{{#each runtime.owned_artifacts as artifact}}
- {{ artifact.id }}
{{/each}}
```

规则：

- 仅对数组生效
- block 内允许访问 loop alias
- 首阶段不支持嵌套太深的 each/if 组合优化
- trace 记录 iteration_count

## 7.5 安全与稳定性限制

- 递归深度受控
- block 嵌套深度受控
- 单模板最大展开长度受控
- 遇到非法语法时返回结构化错误占位，而不是静默吞掉

---

## 8. 与现有模块的整合

## 8.1 NarrativeResolver 演进方向

当前 `NarrativeResolver` 不再仅是“字符串替换器”，建议演进为：

- `PromptMacroResolver`（正式实现）
- `NarrativeResolver`（兼容别名或门面）

### 短期策略

- 保留 `NarrativeResolver` 文件入口，避免一次性打散调用点
- 内部改为委托新的 variable context + macro resolver
- 让 perception/inference/simulation 都走统一实现

## 8.2 InferenceContext 扩展

建议在 `InferenceContext` 中新增正式变量上下文快照，例如：

```ts
interface InferenceContext {
  variable_context?: PromptVariableContext;
  variable_context_summary?: {
    namespaces: string[];
    alias_precedence: string[];
  };
}
```

并逐步降低 `visible_variables` 作为唯一主入口的地位。

### 定位调整

- `visible_variables`：compatibility bridge
- `variable_context`：新 source-of-truth

## 8.3 Prompt Builder 接入

`inference/prompt_builder.ts` 中不再直接：

- 手工拼平铺变量池
- 直接 new resolver 只喂一个 `visible_variables`

而是：

- 从 `InferenceContext.variable_context` 渲染 world/role/system templates
- 记录模板来源与展开 trace
- 将 trace 汇入 Prompt Workflow diagnostics

## 8.4 Perception Template 接入

`domain/perception/template_renderer.ts` 也改走统一 render 入口。

这样保证：

- perception template
- prompt template
- simulation variable resolve

共享同一套变量 contract 与调试语义。

## 8.5 SimulationManager resolvePackVariables 接口

当前 `resolvePackVariables()` 应保留，但降级为 thin wrapper：

- 输入 template
- 调用统一 variable context renderer
- 返回 string

其内部不再维护独立 resolver 逻辑。

---

## 9. Prompt Workflow 诊断接入

## 9.1 新增变量/宏诊断摘要

建议把以下摘要接入：

- `PromptBundle.metadata.workflow_variable_summary`
- `PromptBundle.metadata.workflow_macro_summary`
- `InferenceTrace.context_snapshot.variable_resolution`
- `context_run.diagnostics.orchestration.variable_resolution`

## 9.2 诊断内容

至少包含：

- 使用到的 namespace 列表
- alias fallback 次数
- missing path 列表
- restricted path 列表
- if/each block 执行统计
- 模板来源 -> 渲染结果长度变化

## 9.3 不建议直接持久化完整值

为了避免 trace 膨胀：

- 记录 path、layer、摘要、preview
- 不默认持久化完整对象内容
- 大对象只保留 type/size/keys 摘要

---

## 10. World Pack 合同与作者体验

## 10.1 本阶段不急于大改 schema

当前 world pack schema 中：

- `variables` 仍然保留为简单 record
- `prompts` 仍然保留为简单 string record

首阶段不急于将 schema 扩成复杂宏 DSL 配置，以免改动过重。

## 10.2 作者约束通过文档与模板先落地

优先通过以下方式引导：

1. 新 world pack 模板默认使用命名空间写法
2. `docs/WORLD_PACK.md` 补“变量与宏”章节
3. `docs/capabilities/PROMPT_WORKFLOW.md` 补变量上下文与宏诊断章节

## 10.3 未来可扩展方向

后续如有需要，可再为 pack 增加：

- macro policy 配置
- strict namespace mode
- allow_legacy_alias 开关
- template validation 阶段 lint

但这些不作为本阶段强依赖。

---

## 11. 迁移策略

## 11.1 原则

- 允许保留旧模板
- 但新 contract 明确以 namespaced variable context 为准
- compatibility bridge 保留但不继续扩张
- 不为未上线前的临时数据增加复杂迁移逻辑

## 11.2 两阶段迁移

### 阶段 A：Variable Context Formalization

- 新增 variable layers/context
- resolver 统一改走新入口
- 保留 `visible_variables` 兼容投影
- trace 接入 workflow

### 阶段 B：Macro Capability Formalization

- 支持 `default / if / each`
- 更新默认模板与文档
- 增加 template/render 单元测试

## 11.3 延后事项

以下事项可放到后续专门清理轮次：

- 删除所有旧 alias 写法
- 去除 `visible_variables` 字段
- 移除旧 `NarrativeResolver` 命名
- 为所有历史模板自动重写

---

## 12. 风险与控制

### 风险 1：变量 contract 一次改动过大，影响多入口

控制：

- 保留旧 resolver 入口做 facade
- 先内部统一实现，再逐步收调用点

### 风险 2：宏语法扩展导致复杂度失控

控制：

- 只做受控 Handlebars-like 子集
- 不开放脚本执行
- 只支持有限 block 类型

### 风险 3：trace 过大

控制：

- 记录摘要而非完整值
- 对大对象只记录 preview / keys / count

### 风险 4：plugin 变量污染主 prompt

控制：

- plugin 不进入 alias fallback
- 必须显式 `plugin.<id>` 访问

### 风险 5：继续背负 `visible_variables` 旧模型

控制：

- 将其明确标为 compatibility bridge
- 新代码一律读取 `variable_context`

---

## 13. 推荐实施顺序

## Phase 2A：变量层正式化

1. 定义 `PromptVariableLayer / Context / Trace`
2. 在 inference context 构建阶段生成正式 variable context
3. 统一 `prompt_builder / perception / simulation` 走同一 render 入口
4. 把 variable trace 接入 workflow diagnostics

### 验收标准

- 已有模板不回归
- 新模板可使用命名空间访问
- missing/restricted/source hit 可见

## Phase 2B：宏能力扩展

1. 支持 `default(...)`
2. 支持 `#if`
3. 支持 `#each`
4. 补语法错误与边界测试

### 验收标准

- world/role/perception 模板可使用受控 block 语法
- trace 可看到 block 执行摘要

## Phase 2C：文档与示例收口

1. 更新 Prompt Workflow 能力文档
2. 更新 World Pack 文档与模板示例
3. 如有必要，补 template lint / validation 建议

---

## 14. 验收标准

完成本阶段后，应满足：

1. 服务端存在正式 `PromptVariableContext` 抽象
2. 变量来源具备明确命名空间与 alias fallback 规则
3. `NarrativeResolver` 不再只是散落变量替换器，而是统一 renderer/facade
4. Prompt Workflow / perception / simulation 共享一套模板解析语义
5. 受控宏能力至少支持：
   - 基础插值
   - 默认值
   - 条件块
   - 列表展开
6. diagnostics 中可看到变量来源、fallback、missing、block 执行摘要
7. plugin 变量不会隐式污染默认变量空间
8. `visible_variables` 虽可保留，但已被明确降级为 compatibility bridge

---

## 15. 结论

当前项目 Prompt Workflow 主体已经完成第一轮正式化，真正尚未收口的是：

- 变量来源层级
- 变量作用域/覆盖规则
- 宏能力边界
- 调试 trace

因此，本阶段最合理的方向不是重做 Prompt Workflow，而是：

> **把 world pack / runtime / actor / request / plugin 的变量系统正式化，并把 NarrativeResolver 升级为统一的宏展开与变量解析门面。**

在项目尚未上线、临时数据无需强兼容的前提下，本阶段应优先追求：

- 正式 contract
- 低技术债
- 统一入口
- 可解释 trace

而不是继续为旧隐式变量机制增加更多兼容分支。