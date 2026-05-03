# TODO

> 本文件只记录用户当前想要最近一段时间的待处理事项，完成后用户会直接移除。
> 稳定架构事实看 `docs/ARCH.md`，业务语义看 `docs/LOGIC.md`，接口契约看 `docs/API.md`，设计/计划/评审过程看 `.limcode/`。

## 当前重点 / Current Focus

### 大型任务

### 插件拓展

- [x] 实现插件加载顺序表 → `apps/server/src/plugins/dependency_resolver.ts` — `resolveLoadOrder()`
- [x] 实现插件之间的依赖确定 → 接口依赖 + 硬依赖 + 反向依赖检查

#### 数据的策略性清洗接口

> 已建立 DataCleaner 统一抽象（`packages/contracts/src/data_cleaner.ts`），全局注册表在 `apps/server/src/plugins/extensions/data_cleaner_registry.ts`。
> 两个内置实现放在系统 pack (`apps/server/builtin/system_pack/`) 中。
> 设计文档: `.limcode/design/plugin-expansion-design.md`

- [x] 1. 正则引擎 → `data_cleaner.regex` — 含 ReDoS 防护（长度限制、嵌套量词检测、超时、匹配计数上限）
- [x] 4. 基础字符串方法 → `data_cleaner.string` — 7 种模式（trim/lowercase/uppercase/collapse_ws/strip_html/strip_control/strip_punctuation）
- [ ] 2. 结构化语法解析器
- [ ] 3. 专用语义提取/验证库
- [ ] 5. 自然语言处理（NLP）与模糊技术
- [ ] 6. 规则引擎与决策流
- [ ] 7. 设计接口让机器学习辅助清洗
- [ ] 8. 向量化字符串操作

#### 测试覆盖

- 23 单元测试（dependency_resolver: 16, data_cleaner_registry: 7）
- 10 集成测试（依赖检查 enable/disable、global-scope、load order）
- 7 e2e 测试（HTTP API 端到端）

### 提示词流水线升级

阶段二的 上下文构建（Context Builder）：
- 项目尚未上线也没有使用者，需要清理上下文构建（Context Builder）中的兼容性别名，且允许提供别名，只要是符合特定的语法（语法设置的方式尚未决定）

#### 阶段三：提示词构建（Prompt Workflow） — ✅ 完成

> 设计文档：`.limcode/design/prompt-workflow-system-b-advancement-design.md`
> 推进计划：`.limcode/plans/prompt-workflow-system-b-advancement-plan.md`

System B 六个 Phase 全部完成（2026-05-03）：

- [x] Phase 1: executor 接口验证（试点 `token_budget_trim`）+ pipeline runner
- [x] Phase 2: 汇合后统一 executor（`placement_resolution`、`fragment_assembly`、`permission_filter`、`bundle_finalize`）+ profile 更新
- [x] Phase 3: 模板轨（`runTemplateTrack`）— YAML slot → section_drafts，宏展开在轨道内完成
- [x] Phase 4: 节点轨（`runNodeTrack`）— ContextNode → section_drafts，含策略过滤、摘要压缩、节点分组
- [x] Phase 5: 路径统一 + 轻量路径（`profile.tracks`）+ 快照轨（`runSnapshotTrack`）+ alias 清理（`buildExtendedInferenceContext`、删除硬编码 fallback、`task_prompt_builder` 支持预构建 bundle）
- [x] Phase 6: 清理 System A 废弃代码（删除 5 个 processor + `runPromptWorkflowV2` + `PromptTreeProcessor` + `ai_message_projection`）

> 架构：多轨汇合（模板轨 + 节点轨 + 快照轨）→ section_drafts → pipeline（placement → assembly → permission → budget_trim → finalize）→ bundle

##### 已确认的决策

- [x] 权限过滤：策略过滤归入节点轨，ACL 过滤为独立 `permission_filter` executor（§12.1 选 C）
- [x] 宏展开时序：各轨道产出保证已展开文本，宏展开是模板轨内部责任（§12.2 选 A）
- [x] Section type 与 Slot 映射：`section_type` 为元数据，`slot` 字段驱动路由（§12.3 选 A）
- [x] `section_policy`：废弃并全量删除（§12.4 选 C）
- [x] 轨道函数诊断：`TrackTrace` + `track_traces`（§12.5 选 A）
- [x] State 变更模型：mutate-in-place + `StepSnapshotSummary`（§12.6 选 A）
- [x] `ai_message_projection` 步骤类型：从联合类型中移除（§12.7 选 B）
- [x] 轻量路径机制：`profile.tracks` 配置控制轨道启用/跳过（§12.8 选 A）
- [x] `PromptTree.metadata.profile_id` 填充时机：`createInitialPromptWorkflowState` 时从 profile 写入（§12.9 选 B）
- [x] 模板轨 slot 归属：只为有模板的 slot 生成 section_draft（§12.10 选 A）
- [x] 节点轨内部编排：硬编码顺序，不引入子 registry（§12.11 选 A）
- [x] 试点验证覆盖：`fragment_assembly` 实现后已追加集成回归（§12.12）
- [x] Step trace 结构化：`StepSnapshotSummary` + `notes`（§12.13 选 C）
- [x] `denied_reason` 结构化：推迟，波及 `PromptFragmentV2` 类型变更（§12.1 关联）

##### 多轮对话
- 实现多轮对话的功能，加入一个内置的slot来容纳
- 这个slot将会容纳对话消息存储，模型回复内容传递，记忆压缩，跨推理因果链条，工具调用，增量上下文构建
- 这个多轮对话的具体的内容会被某些规则控制和修改，不论是压缩还是结构变化
- 需要讨论多轮对话内容的格式的是什么，工具调用记录和内容和还有混入其他奇奇怪怪的东西，组织结构需要讨论
- 给多轮对话的内容打上足够的tag，让其更好的定位，方案未定
- ⚠ 多轮对话需要跨请求持久化和增量上下文构建，超出当前单次推理的 `PromptWorkflowState` 生命周期模型，需要独立架构设计

思考的问题： 多轮对话中，是否每一次都需要经历整个提示词的流水线？对于一些简单的请求是否也需要经历这么重量级别的提示词流水线？
> 设计文档 §12.8 已记录：pipeline runner 需要支持 profile 配置跳过轨道和步骤的轻量路径

##### 插槽函数（链表）

- 内置slot既然可以被关闭，那自然可以使用类似的宏语法或者函数名"{{system_core}}"来指代原来已经被禁用的内置slot
- 内置的slot可以被关闭，但始终存在用来定位， slot 定义加入绝对位置和相对位置的动态定位功能，方便其他的动态的slot在slot之间插入和移除
> ⚠ 当前 System B 只有 fragment 层面的 anchor/placement，没有 slot 之间的位置关系。Slot 定位系统需要独立设计，`PromptFragmentPlacementMode` 可作为基础类型扩展

- 引入函数的内联/嵌套/封装/作用域概念，让插槽函数升级为顶层空间，
- 允许在顶级空间之外定义变量作为全局变量，包括宏定义也是
> ⚠ 当前 System B 将宏展开限制为单次扁平替换。嵌套/作用域需要独立的宏系统设计

- 高级功能：允许执行（需要图灵完备的）代码，处理： 深度/顺序/触发概率/群组权重/扫描深度/逻辑匹配/始终激活/条件激活/黏性（出发后保留次数）/触发后冷却时间/延迟触发/延迟递归/不可递归/防止进一步递归/无视上下文长度/关键字匹配/向量化触发 等等高级且复杂的功能，尚不确定使用脚本语言lua/js/rust或者是其他方式实现核心模块，但毫无疑问需要被隔离
> ⚠ `SectionDraft.metadata: Record<string, unknown>` 可作为触发概率、冷却时间等元数据的扩展点，未来 executor 可消费这些字段

- 双重模块设置，一个是当前的Prompt Tree V2，另一个是更复杂拥有插槽函数的核心
> ⚠ 双模块路线与当前 System B 的线性 pipeline 架构有根本性差异（图灵完备 vs 声明式 pipeline），需要在插槽函数核心设计启动时明确边界
