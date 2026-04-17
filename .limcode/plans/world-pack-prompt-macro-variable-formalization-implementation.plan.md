<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/world-pack-prompt-macro-variable-formalization-design.md","contentHash":"sha256:2c68e6d59c8be386e0e14dc4d5a29df3809e2e3b035ba9e3e7b2a57bf23d7abc"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 改造 prompt_builder、template_renderer、SimulationManager.resolvePackVariables 等调用点接入 variable_context  `#phase2a-caller-integration`
- [x] 在 inference/runtime 上下文构建阶段生成 system/app/pack/runtime/actor/request 层变量上下文与 alias precedence  `#phase2a-context-builders`
- [x] 定义 PromptVariableLayer / PromptVariableContext / trace 等正式类型，并为旧 visible_variables 保留薄兼容投影  `#phase2a-contract-types`
- [x] 把变量解析摘要与 trace 接入 Prompt Workflow / PromptBundle / InferenceTrace diagnostics  `#phase2a-diagnostics`
- [x] 将 NarrativeResolver 收口为统一变量/模板渲染门面，保证 prompt/perception/simulation 共享同一解析入口  `#phase2a-renderer-facade`
- [x] 在统一渲染器上扩展 default、if、each 三类受控宏能力，并设置深度/长度/错误护栏  `#phase2b-macro-runtime`
- [x] 补充单元与集成测试，覆盖命名空间解析、alias precedence、缺失变量、block 执行与兼容桥  `#phase2b-tests`
- [x] 更新 Prompt Workflow / World Pack 文档与示例模板，明确新命名空间规范与兼容边界  `#phase2c-docs-templates`
<!-- LIMCODE_TODO_LIST_END -->

# 世界包与 Prompt Workflow 宏 / 变量系统正式化实施计划

## 0. 来源设计

- 本计划基于已确认设计：`.limcode/design/world-pack-prompt-macro-variable-formalization-design.md`
- 本计划目标不是重做 Prompt Workflow 主体，而是在现有 workflow runtime 之上正式化变量来源、宏能力、作用域规则与诊断链路。

## 1. 实施目标

本轮实施要达成以下结果：

1. 服务端形成正式 `PromptVariableContext` 抽象，而不是继续依赖单一 `visible_variables`
2. 变量来源按 `system / app / pack / runtime / actor / request / plugin.<id>` 命名空间组织
3. `NarrativeResolver` 演进为统一渲染门面，prompt/perception/simulation 共用同一套解析逻辑
4. Prompt Workflow 可记录变量来源、alias fallback、missing/restricted 与宏块执行摘要
5. 支持受控宏子集：基础插值、`default(...)`、`#if`、`#each`
6. 兼容桥保留但不继续扩张，历史清理项延后到专门收尾轮次

## 2. 约束与原则

### 2.1 实施原则

- 优先减少技术债，而不是为旧临时数据扩写复杂兼容层
- 新代码统一依赖 `variable_context`，旧 `visible_variables` 降级为 bridge
- plugin 变量必须显式走 `plugin.<id>` 命名空间，不参与默认 alias fallback
- 不引入任意表达式执行与脚本化模板机制

### 2.2 兼容边界

本轮允许保留：

- 旧 `NarrativeResolver` 文件入口
- `InferenceContext.visible_variables`
- 少量裸 key alias 解析

但这些都必须被明确标记为：

- compatibility bridge
- 非 source-of-truth
- 后续可删除的薄层

## 3. 代码范围与主要落点

### 3.1 核心实现文件

预计主要涉及：

- `apps/server/src/narrative/types.ts`
- `apps/server/src/narrative/resolver.ts`
- `apps/server/src/inference/types.ts`
- `apps/server/src/inference/context_builder.ts`
- `apps/server/src/inference/prompt_builder.ts`
- `apps/server/src/domain/perception/template_renderer.ts`
- `apps/server/src/core/simulation.ts`
- `apps/server/src/context/workflow/runtime.ts`
- `apps/server/src/context/workflow/types.ts`

### 3.2 可能新增文件

建议按职责新增或拆分：

- `apps/server/src/narrative/variable_context.ts`
- `apps/server/src/narrative/macro_renderer.ts`
- `apps/server/src/narrative/trace.ts`

如果实现时发现保留单文件更利于短期收口，也可以不拆，但职责边界必须清晰：

- 变量层构建
- 模板解析/宏展开
- trace 摘要

### 3.3 测试与文档范围

预计涉及：

- `apps/server/tests/**` 中 narrative / inference / workflow 相关测试
- `docs/capabilities/PROMPT_WORKFLOW.md`
- `docs/WORLD_PACK.md`
- 如有必要，更新 world-pack 默认模板示例

## 4. 分阶段实施

## Phase 2A：变量层正式化

### 4.1 A1 — 定义正式 contract 与基础工具

目标：先把变量层抽象立住。

实施内容：

1. 在 `narrative/types.ts` 或独立类型文件中定义：
   - `PromptVariableNamespace`
   - `PromptVariableLayer`
   - `PromptVariableContext`
   - `PromptVariableResolutionTrace`
   - `PromptMacroRenderResult`
2. 明确 alias precedence 默认值：
   - `request > actor > runtime > pack > app > system`
3. 提供基础 helper：
   - 判断 namespaced path
   - 根据 namespace 查值
   - alias fallback 查值
   - 生成 value preview / summary
4. 明确 plugin namespace 表达方式：
   - `plugin.<pluginId>`
   - 不进入 alias fallback

完成标准：

- 类型定义稳定
- 基础查值逻辑可被复用
- 不再要求调用方自行拼隐式变量池

### 4.2 A2 — 在上下文构建阶段生成 variable_context

目标：把 source-of-truth 从 `visible_variables` 前移到统一变量上下文。

实施内容：

1. 在 `inference/context_builder.ts` 中构建正式变量层：
   - `system`
   - `app`
   - `pack`
   - `runtime`
   - `actor`
   - `request`
2. 生成 `InferenceContext.variable_context` 与 summary
3. 继续生成 `visible_variables`，但只作为兼容投影
4. 对 actor/request/runtime/pack 中需要暴露给模板的字段做稳定 shape 归一

完成标准：

- `InferenceContext` 同时具备 `variable_context` 与兼容 `visible_variables`
- 变量来源不再是 pack/agent 二选一替换逻辑
- 模板渲染调用方可以不再依赖平铺对象

### 4.3 A3 — NarrativeResolver 收口为统一门面

目标：统一 render 行为，而不是多个地方各自 new resolver / 拼上下文。

实施内容：

1. 保留 `NarrativeResolver` 入口，但内部改为委托统一渲染器
2. 新渲染入口应支持：
   - namespaced path lookup
   - alias fallback lookup
   - 权限/可见性控制的兼容处理
   - trace 采集
3. 明确 `resolve()` 的输入支持：
   - `PromptVariableContext`
   - 局部 loop / extra context
   - template source label

完成标准：

- prompt/perception/simulation 后续都可共用该入口
- 老调用点仍能工作，但实际逻辑已集中

### 4.4 A4 — 收口现有调用点

目标：让所有关键模板调用都走统一变量 contract。

实施内容：

1. `inference/prompt_builder.ts`
   - world/role/system prompt 渲染改用 `variable_context`
   - 不再手工依赖 `visible_variables` 做主逻辑
2. `domain/perception/template_renderer.ts`
   - 改走统一渲染入口
3. `core/simulation.ts`
   - `resolvePackVariables()` 降级为 thin wrapper
4. 如存在其他零散模板入口，一并收口

完成标准：

- 模板解析语义在三条主链保持一致
- 变量缺失/来源命中逻辑不再分叉

### 4.5 A5 — 接入 workflow diagnostics

目标：让变量解析成为可观察运行时，而不只是字符串黑盒。

实施内容：

1. 在 workflow / prompt bundle metadata 中增加变量解析摘要：
   - 使用到的 namespace
   - alias fallback 次数
   - missing/restricted paths
   - 模板来源与展开长度摘要
2. 将必要摘要挂到：
   - `context.context_run.diagnostics.orchestration`
   - `PromptBundle.metadata`
   - `InferenceTrace.context_snapshot` 相关结构
3. 控制 trace 体积：
   - 只存 path/layer/preview/summary
   - 不默认持久化完整对象

完成标准：

- 出错时可定位到模板、路径、来源层
- trace 不明显膨胀

## Phase 2B：宏能力正式化

### 4.6 B1 — 扩展受控宏能力

目标：在统一变量层之上引入受控宏语法，而不是任意脚本执行。

实施内容：

1. 支持默认值：
   - `{{ actor.title | default("unknown") }}`
2. 支持条件块：
   - `{{#if actor.has_bound_artifact}}...{{/if}}`
3. 支持列表展开：
   - `{{#each runtime.owned_artifacts as artifact}}...{{/each}}`
4. 处理非法语法、嵌套深度与输出长度护栏

完成标准：

- 宏语法只覆盖设计要求的受控子集
- 不引入 eval、任意表达式与可执行脚本

### 4.7 B2 — 宏级诊断摘要

目标：补齐 block 级可解释性。

实施内容：

1. 记录 `if` 是否执行
2. 记录 `each` 迭代次数
3. 记录 default fallback 是否命中
4. 记录宏解析错误与保护性降级结果

完成标准：

- 调试信息能解释模板为何输出/未输出某段文本

## Phase 2C：测试、文档与示例收口

### 4.8 C1 — 测试

补充以下测试维度：

1. namespaced lookup
2. alias precedence
3. plugin namespace 不参与 alias fallback
4. missing / restricted 行为
5. default fallback
6. if block
7. each block
8. prompt/perception/simulation 共用同一语义
9. workflow diagnostics 写入

### 4.9 C2 — 文档与模板

更新：

- `docs/capabilities/PROMPT_WORKFLOW.md`
- `docs/WORLD_PACK.md`
- 如有必要，补 world pack 模板示例

文档重点：

- 新命名空间规范
- alias fallback 的兼容定位
- 受控宏语法边界
- diagnostics 可见性

## 5. 测试与验证策略

### 5.1 单元测试

优先新增 narrative/macro renderer 相关测试：

- path lookup
- alias precedence
- trace 生成
- default/if/each
- 保护性错误处理

### 5.2 集成测试

验证至少三条主链：

1. prompt builder 渲染 world/role prompt
2. perception template 渲染
3. simulation pack variable resolve wrapper

### 5.3 回归关注点

重点观察：

- 现有 prompt 文本是否回归
- `visible_variables` 兼容投影是否仍可支撑旧路径
- diagnostics 是否稳定、不过度膨胀

## 6. 风险与控制

### 风险 A：上下文 shape 不稳定，导致模板路径反复变化

控制：

- 先为 `actor / runtime / request / pack` 定稳定输出 shape
- 不把临时内部对象原样暴露给模板

### 风险 B：兼容桥虽然保留，但再次长成主线

控制：

- 新调用点禁止读取 `visible_variables` 作为主逻辑
- 在实现与注释中明确 bridge 定位

### 风险 C：宏语法扩展造成解析器复杂度快速升高

控制：

- 只实现设计中明确列出的受控子集
- 不做通用模板平台

### 风险 D：trace 过大影响持久化

控制：

- metadata 优先存 summary
- 细粒度 traces 仅在必要时保留必要 preview

## 7. 完成定义

本计划完成后，应满足：

1. `PromptVariableContext` 已进入服务端主线
2. 三个主要调用面（prompt/perception/simulation）共享统一渲染入口
3. `visible_variables` 已降级为兼容桥，不再是主 source-of-truth
4. 支持 `default / if / each` 三类宏能力
5. Prompt Workflow diagnostics 能看到变量与宏摘要
6. 文档与测试已同步更新

## 8. 暂不在本计划内的清理项

以下工作明确后置，不阻塞本轮：

- 批量删除所有历史裸 key 模板
- 完整移除 `visible_variables`
- 删除 `NarrativeResolver` 旧命名
- 做自动模板重写/迁移器

这些事项待本轮正式化落稳后，再进入单独负债清理轮。
