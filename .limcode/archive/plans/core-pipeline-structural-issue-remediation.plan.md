## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] P0-A：invocation_type 前缀规范收口 — Constitution Schema 增加校验、Kit 内批量修正、bridging 匹配增加诊断日志 `#core-p0a`
- [x] P0-B：Pack 切换幽灵回退修复 — 加载后验证签名、fallback 路径升级日志级别、消除静默退化 `#core-p0b`
- [x] P1-A：Actor Bridge 映射层实施 — materializer 增加桥接物化、resolveActor 新增 Pack Actor 路径、buildPackStateSnapshot 通过映射表匹配 actor_state `#core-p1a`
- [x] P1-B：调试面与 API 扩展 — inference preview 接受 actor_entity_id、resolvePackVariables 支持 actor_state 变量层 `#core-p1b`
- [x] P2-A：Prompt Workflow 防御性初始化 — context_run.nodes 空值守卫、buildPromptBundle 可独立运行的最小 Context 路径 `#core-p2a`
- [x] P2-B：InferenceContext 接口拆分设计 — 按 ActorResolvable / PackStateResolvable / PromptResolvable 拆分子接口，消除巨型结构体隐式耦合 `#core-p2b`
- [x] P3-A：include_sections 执行层裁剪增强 — section_policy 增加 include_only 模式 `#core-p3a`
- [x] P3-B：state_transform 预计算机制设计 — Pack Constitution 增加 state_transforms 声明与物化阶段存储 `#core-p3b`
<!-- LIMCODE_TODO_LIST_END -->

# 核心链路结构性问题修复实施计划

## 来源

- 问题清单：`Yidhras核心链路结构性问题清单 (Issue Inventory).md`
- 本计划覆盖清单中全部 9 个 Issue，按优先级和依赖关系分阶段实施。

---

## 目标

修复测试阶段暴露的四类结构性缺陷，建立超长期健壮性基础：

1. **消除宿主与 Pack 之间的主体鸿沟**：让 Pack Actor 能被推理系统完整识别和使用。
2. **消除 invocation_type 命名规范断裂**：确保规则匹配链路从头到尾一致。
3. **降低 Prompt Workflow 对完整推理链路的隐式依赖**：使 Pack 级 Prompt 可脱离宿主独立验证。
4. **消除 Pack 运行时切换的静默退化**：确保加载的 Pack 与推理使用的 Pack 始终一致。

---

## 范围

### 纳入本计划

- Issue 1-4：主体与运行时绑定系统性断裂（Actor Bridge 全链路）
- Issue 5：invocation_type 写入链路与 Rule 匹配的前缀不一致
- Issue 6-8：Prompt Workflow 隐式依赖与限制
- Issue 9：Pack 切换幽灵回退

### 不纳入本计划

- 新的重量级产品功能（如多角色并行推理、新 Pack 类型等）
- Rust sidecar 大面积迁移
- multi-pack experimental → stable 稳定化
- AI provider 接入层扩展

---

## Phase 0：紧急补丁（P0）

### P0-A：invocation_type 前缀规范收口 ✅ 已完成

**问题**：`groundDecisionIntent` 将 `decision.action_type` 改写为 capability key（带 `invoke.` 前缀），但 Objective Rules 中 `when.invocation_type` 可能使用裸名，导致精确匹配失败。此问题同时影响 `shouldBridgeToInvocation` 的桥接判定。

**修复方向**：不加运行时归一化逻辑（掩盖规范不一致），改为从源头强制规范。

#### 具体步骤

1. **✅ Constitution Schema 增加校验**（`apps/server/src/packs/schema/constitution_schema.ts`）
   - 新增 `KERNEL_INTENT_TYPES` 常量（`trigger_event`, `post_message`, `adjust_relationship`, `adjust_snr`）
   - 新增 `objectiveEnforcementWhenSchema`：对 `when.invocation_type` 增加 Zod `superRefine` 校验
   - 规则：`invocation_type` 必须以 `invoke.` 开头（kernel actions 豁免）
   - 校验失败时给出清晰错误信息：`"invocation_type '${value}' must use 'invoke.' prefix for capability-key matching in the enforcement pipeline. Expected format: 'invoke.${value}'. Kernel actions (...) are exempt."`
   - 创建 `objectiveEnforcementRuleSchema = worldRuleDefinitionSchema.extend({ when: objectiveEnforcementWhenSchema })`，在 `rulesSchema` 中替换原有 `worldRuleDefinitionSchema`

2. **✅ Kit 内批量修正现有 Pack 规则**
   - `death_note.yaml` 中所有 `invocation_type` 已使用 `invoke.` 前缀，无需修正
   - `example_pack.yaml` 无 `objective_enforcement` 规则，无需修正

3. **✅ `shouldBridgeToInvocation` 增加诊断日志**（`apps/server/src/domain/invocation/invocation_dispatcher.ts`）
   - 新增 `KERNEL_INTENT_TYPES` 常量
   - 当 `intent_type` 不以 `invoke.` 开头且非 kernel action 时，`console.warn` 输出裸名诊断信息
   - 当 `intent_type` 以 `invoke.` 开头但无 capability 和 rule 匹配时，`console.warn` 输出未匹配诊断信息

4. **✅ 测试修正**
   - `objective_enforcement_engine.spec.ts` — `invocation_type: 'claim_book'` → `'invoke.claim_book'`，补充 `capabilities` + `authorities` + `mediators` 声明以支持完整 capability grant 链路，`mediator_id: 'mediator-book'` 加入 payload，更新 `emitted_events_json` 断言中 `mediator_id`
   - `objective_enforcement_sidecar_diagnostics.spec.ts` — 同上更新 + `mediator_id` 在 payload
   - `objective_enforcement_sidecar_fallback_policy.spec.ts` — 同上更新 + `rule_id` 断言改为 `failed:invoke.claim_book`
   - `objective_enforcement_engine_sidecar.spec.ts` — 同上更新
   - `world_engine_sidecar_client.spec.ts` — `invocation_type` 值改为 `invoke.claim_book`
   - `world_pack_schema.spec.ts` — 新增 2 个测试：(1) 验证裸名 `invocation_type` 被拒绝；(2) 验证 kernel action `trigger_event` 不需要 `invoke.` 前缀

#### 验收标准 ✅

- ✅ Constitution Schema 校验拦截裸名 `invocation_type`
- ✅ 所有 World Pack 的 Objective Rules 使用 `invoke.` 前缀
- ✅ 端到端链路（grounding → intent draft → enforcement）的 `invocation_type` 在全路径中对齐
- ✅ 不具备 `invoke.` 前缀的非 kernel action 在 `shouldBridgeToInvocation` 中产生 warn 日志

---

### P0-B：Pack 切换幽灵回退修复 ✅ 已完成

**问题**：`DefaultActivePackRuntimeFacade` 在 `init()` 时缓存 `activePack`，如果实验性 Pack 加载失败或未正确注册，系统会静默回退到旧 Pack，日志显示新包名但推理使用旧包数据。

#### 具体步骤

1. **✅ 加载后验证签名**（`apps/server/src/core/active_pack_runtime_facade.ts` 的 `init()` 方法）
   - 在 `this.activePack = activated.pack` 之后，增加非空断言守卫
   - 若 `this.activePack` 或 `this.activePack.metadata.id` 为空/null，throw Error 而非静默继续

2. **✅ `buildForPack()` 增加对齐日志**（`apps/server/src/inference/context_builder.ts:518-617`）
   - 在 stable 模式中，`stablePack.metadata.id !== input.pack_id` 时，在 throw 之前输出 `console.error` 日志
   - 在 experimental 模式中，`experimentalHandle` 为 null 时，同样输出 `console.error` 日志
   - 日志包含：请求的 `pack_id`、active pack 的 `metadata.id`、mode（stable/experimental）

3. **✅ Fallback 日志升级**（`apps/server/src/app/services/app_context_ports.ts:89`）
   - 将 `console.warn` 升级为 `console.error`
   - 描述性消息：`Fallback to sim for activePackRuntime — injected port is missing, which may indicate incomplete AppContext initialization`

4. **✅ 实验性 Pack 加载验证**（`apps/server/src/core/pack_runtime_registry_service.ts` 的 `load()` 方法）
   - 在 `this.registry.register()` 之后，调用 `this.registry.getHandle()` 验证注册成功
   - 若 `getHandle` 返回 null，输出 `console.error` 级别日志

#### 验收标准 ✅

- ✅ Pack 加载后 mismatch 立即 throw 而非静默继续
- ✅ 所有 inference 路径在 Pack ID 不对齐时产生 `error` 级别日志
- ✅ 不再存在"日志显示包 A 但推理使用包 B"的静默退化路径

---

## Phase 1：Actor Bridge 映射层（P1）

### P1-A：Actor Bridge 核心实现

**问题**：Pack Actor（如 `actor-player`）仅被物化为 `PackWorldEntity` + `PackEntityState`，但在宿主侧没有对应的 `Agent` / `Identity` / `IdentityNodeBinding`，导致 `resolveActor()` 无法识别 Pack Actor，`buildPackStateSnapshot()` 的 `actor_state` 永远为 null。

**架构决策**：采用**一对一映射**方案。原因：
- 当前每个 Pack 是自包含的封闭世界，不需要一个 Host Agent 对应多个 Pack Actor
- 一对一映射简单可验证，代码和测试都可确定性地覆盖
- 动态挂载（运行时绑定）可以在一对一稳定后作为增强实现

#### 数据模型扩展

在 Prisma schema 中增加 Pack Actor 到 Host Identity 的映射记录。设计两种实现路径（需在实施开始时选定一种）：

**路径 A：复用现有 IdentityNodeBinding**

```
Pack Constitution entities.actors[]
  ──materialize──→ Agent (id = "{packId}:{actor.id}")
                    + Identity (id = "{packId}:identity:{identity.id}", type = identity.type ?? 'agent')
                    + IdentityNodeBinding (identity → agent, role='active')
```

- 优点：不增加新模型，复用现有查询路径
- 缺点：Pack Actor 生成的 Agent/Identity 与宿主原生记录混在同一表中，需要 `pack_id` 前缀区分

**路径 B：新增 PackActorBridge 映射表**

```prisma
model PackActorBridge {
  id            String   @id @default(cuid())
  pack_id       String
  actor_entity_id String   // Pack Constitution 中的 actor.id
  host_agent_id String   // 对应的宿主 Agent.id
  host_identity_id String // 对应的宿主 Identity.id
  created_at    DateTime @default(now())
  updated_at    DateTime @updatedAt

  @@unique([pack_id, actor_entity_id])
}
```

- 优点：映射关系独立存储，不污染核心 Identity 表；查询可走专用索引
- 缺点：增加新模型，`resolveActor()` 需要额外查询

**建议选择路径 A**（复用现有模型），原因：
- 当前 `seed_identity.ts` 已证明 `Identity → Agent` 的绑定模式可直接复用
- 不增加新表意味着不需要额外 migration 和查询路径
- 通过 ID 命名约定（`{packId}:identity:{identity.id}`）自然区分 Pack 生成记录与宿主原生记录

#### 具体步骤

1. **`materializer.ts` 增加 `materializeActorBridges()`**
   - 位置：`apps/server/src/packs/runtime/materializer.ts`
   - 在 `materializePackRuntimeCoreModels()` 末尾新增步骤
   - 对 `pack.entities.actors` 中每个 actor：
     - 创建 `Agent` 记录：`{ id: "{packId}:${actor.id}", name: actor.label, type: 'active', snr: 1.0 }`
     - 查找 `pack.identities` 中 `subject_entity_id === actor.id` 的 identity 定义
     - 创建 `Identity` 记录：`{ id: "{packId}:identity:${identity.id}", type: identity.type ?? 'agent', name: identity.id, provider: 'pack' }`
     - 创建 `IdentityNodeBinding`：`{ identity_id → Identity, agent_id → Agent, role: 'active', status: 'active' }`
   - 将这些 Prisma 创建操作加入 `result` 返回，确保与 `installPackRuntime()` 的事务一致
   - 对所有生成的 ID 使用 `{packId}:` 前缀约定，确保全局唯一且可追溯来源

2. **`resolveActor()` 增加 Pack Actor 路径**
   - 位置：`apps/server/src/inference/context_builder.ts:151-245`
   - 在当前 `agent_id` → `identity_id` → system fallback 三条路径基础上，新增第四条路径：
   ```ts
   // 4. Pack Actor Entity resolution
   if (input.actor_entity_id && packId) {
     const bridgedAgentId = `${packId}:${input.actor_entity_id}`;
     const agentSnapshot = await getAgentContextSnapshot(context, bridgedAgentId);
     if (agentSnapshot) {
       // 查找对应的 IdentityNodeBinding 确定 identity 和 role
       return constructResolvedActorFromBridge(bridgedAgentId, agentSnapshot, context);
     }
   }
   ```
   - 需要扩展 `InferenceRequestInput` 类型，增加可选字段 `actor_entity_id?: string`

3. **`buildPackStateSnapshot()` 修改 actor_state 匹配逻辑**
   - 位置：`apps/server/src/inference/context_builder.ts:343-410`
   - 当前逻辑：`row.entity_id === resolvedAgentId`（精确匹配宿主 Agent ID 与 Pack Entity ID）
   - 修改为通过映射表查找：
   ```ts
   // 方案：建立 resolvedAgentId → packEntityId 的映射
   const actorEntityIdMapping = buildActorEntityIdMapping(packId, resolvedAgentId);
   // actor_state 匹配条件改为：
   if (resolvedAgentId) {
     const packEntityId = actorEntityIdMapping.get(resolvedAgentId);
     if (packEntityId && row.entity_id === packEntityId && row.state_namespace === 'core') {
       actorState = row.state;
     }
   }
   ```
   - 同时保留对非映射场景的兼容：如果 `resolvedAgentId` 直接等于某个 `entity_id`（如 `system` 直接对应 `__world__`），仍走原有逻辑

4. **物化清理**
   - 在 Pack 卸载路径（如果存在）中增加清理：删除 `{packId}:` 前缀的 Agent、Identity、IdentityNodeBinding 记录
   - 如果当前没有 Pack 卸载路径，在 `PackRuntimeRegistryService.unload()` 或 `SimulationManager.reset()` 中增加级联清理
   - 确保清理操作在数据库事务中执行

5. **`seed_identity.ts` 协调**
   - 确保 Package 生成的 `Agent` / `Identity` ID 不会与 `seed_identity.ts` 预置的记录冲突
   - 当前种子数据使用 `system`, `user-001`, `agent-001/002/003` 等短 ID，而包生成的使用 `{packId}:{actor.id}` 格式，天然不冲突

#### 验收标准

- `POST /api/inference/preview` 传入 `actor_entity_id: "actor-player"` 时，能正确解析到桥接的 Agent 和 Identity
- `packet_state` 响应中 `actor_state` 不再为 null，而是返回正确的 Pack Actor 状态
- Pack 卸载后桥接记录被清理
- 现有的 `agent_id` 和 `identity_id` 路径不受影响

---

### P1-B：调试面与 API 扩展 ✅ 已完成

#### 具体步骤

1. **✅ Inference Preview API 扩展**
   - `packages/contracts/src/inference.ts` — `inferenceRequestSchema` 增加 `actor_entity_id: z.string().optional()`
   - `packages/contracts/src/inference.ts` — `inferenceJobReplayRequestSchema.overrides` 增加 `actor_entity_id: z.string().optional()`
   - `apps/server/src/app/services/inference_workflow/parsers.ts` — `storedRequestInputSchema` 增加 `actor_entity_id`; `replayInputSchema.overrides` 增加 `actor_entity_id`
   - `apps/server/src/inference/types.ts` — `InferenceRequestInput` 增加 `actor_entity_id?: string`; `InferenceJobReplayInput.overrides` 增加 `actor_entity_id?: string`
   - `apps/server/src/inference/service.ts` — Replay override validation 增加 `actor_entity_id` 禁止检查
   - 路由层 (`inference.ts`) 无需修改：`parseBody(inferenceRequestSchema, req.body)` 已自动包含新字段，透传至 `InferenceService`

2. **✅ `resolvePackVariables()` 扩展**
   - `apps/server/src/core/active_pack_runtime_facade.ts` — `resolvePackVariables()` 新增第三参数 `actorState?: Record<string, unknown> | null`
   - 当 `actorState` 非空时，新增 `actor_state` 变量层（`createPromptVariableLayer({ namespace: 'actor_state', ... })`)
   - `apps/server/src/narrative/types.ts` — `PromptVariableNamespace` 联合类型增加 `'actor_state'`
   - `apps/server/src/app/services/app_context_ports.ts` — `ActivePackRuntimeFacade.resolvePackVariables` 接口签名同步更新
   - `apps/server/src/core/simulation.ts` — `SimulationManager.resolvePackVariables` 委托签名同步更新

#### 验收标准 ✅

- ✅ Inference Preview 可直接用 `actor_entity_id` 触发推理（通过 P1-A 已实现的 `resolveActor` 第四路径）
- ✅ `resolvePackVariables` 可解析 `{{actor_state.*}}` 模板变量
- ✅ 所有 unit tests 通过（140/140）
- ✅ Typecheck 通过（仅预存错误）
- ✅ Lint 通过

---

## Phase 2：健壮性增强（P2）

### P2-A：Prompt Workflow 防御性初始化

**问题**：`runPromptWorkflow()` 在 `createInitialPromptWorkflowState()` 中直接访问 `input.context_run.nodes`，如果传入部分填充的 `InferenceContext`，`state.selected_nodes.length` 会是 `undefined` 导致崩溃。

#### 具体步骤

1. **`createInitialPromptWorkflowState()` 增加空值守卫**
   - 位置：`apps/server/src/context/workflow/types.ts:188-213`
   - 修改 `selected_nodes` 和 `working_set` 初始化：
   ```ts
   selected_nodes: input.context_run?.nodes ?? [],
   working_set: input.context_run?.nodes ?? [],
   ```
   - 同样空值守卫其他可能为 undefined 的 `context_run` 字段

2. **`summarizeState()` 安全检查**
   - 位置：`apps/server/src/context/workflow/runtime.ts:77-87`
   - 将 `state.selected_nodes.length` 改为 `(state.selected_nodes?.length ?? 0)`
   - 对 `state.working_set?.length` 等类似访问做同样的安全链式访问

3. **定义最小可用的 `PromptResolvableContext`**
   - 在 `apps/server/src/inference/types.ts` 中增加：
   ```ts
   interface PromptResolvableContext {
     world_prompts: InferenceContext['world_prompts'];
     variable_context: InferenceContext['variable_context'];
     pack_state?: InferenceContext['pack_state'];
     actor_display_name: string;
     tick: bigint;
     strategy: InferenceStrategy;
   }
   ```
   - `buildPromptFragments()` 和 `buildPromptBundle()` 可以接受 `PromptResolvableContext` 作为最小输入
   - 当 `context_run` 不存在时，跳过 policy filter / token budget 阶段，直接进入 fragment assembly

4. **Pack 级 Prompt 单元测试入口**
   - 在 `apps/server` 的测试目录中增加 `tests/unit/prompt/` 测试目录
   - 提供一个 `buildMinimalPromptContext()` 辅助函数，构造满足 `PromptResolvableContext` 的最小 mock

#### 验收标准

- 传入部分填充的 InferenceContext 时不再崩溃
- Pack  作者可以用最小 mock Context 验证 Prompt 渲染
- 完整 InferenceContext 路径不受影响

---

### P2-B：InferenceContext 接口拆分设计

**说明**：此步骤仅产出设计文档和类型定义，不修改主路径运行时代码。

#### 具体步骤

1. **分析 InferenceContext 全部 20+ 字段的消费方**
   - 逐个字段梳理哪些模块读取、哪些是必需、哪些是可选
   - 形成字段-消费方矩阵

2. **设计子接口分离方案**
   ```ts
   interface ActorResolvable {
     actor_ref: InferenceActorRef;
     identity: IdentityContext;
     binding_ref: InferenceBindingRef | null;
     resolved_agent_id: string | null;
   }

   interface PackStateResolvable {
     pack_state: InferencePackStateSnapshot;
     pack_runtime: InferencePackRuntimeContract;
     world_pack: InferenceWorldPackRef;
   }

   interface PromptResolvable extends ActorResolvable, PackStateResolvable {
     world_prompts: Record<string, string>;
     variable_context: PromptVariableContext;
     context_run: ContextRun;
     memory_context: MemoryContextPack;
     tick: bigint;
     strategy: InferenceStrategy;
   }
   ```

3. **生成设计文档**（`.limcode/design/` 目录）
   - 文档名：`inference-context-interface-decomposition-design.md`
   - 包含完整的字段-消费方矩阵、子接口定义、迁移路径（渐进式拆分，不破坏现有调用方）

#### 验收标准

- 设计文档产出，经 review 后归档
- 子接口类型定义已写入代码但不改变运行时行为
- 主路径代码仍使用 `InferenceContext` 完整类型

---

## Phase 3：增强功能（P3）

### P3-A：include_sections 执行层裁剪

**问题**：`include_sections` 当前只作为 Hint 写入 Developer Message，不驱动实际裁剪。

#### 具体步骤

1. **`section_policy` 枚举扩展**
   - 位置：`apps/server/src/context/workflow/profiles.ts` 或相关类型文件
   - 在现有 `section_policy` 值（`'minimal' | 'standard' | 'expanded'`）基础上增加 `'include_only'`
   - 当 `include_sections` 非空且 `section_policy === 'include_only'` 时，只渲染 `include_sections` 列出的 sections

2. **Workflow 阶段增加裁剪步骤**
   - 在 `fragment_assembly` 阶段，检查 `include_sections` 配置
   - 如果配置非空，将不在列表中的 section 标记为 `skipped`
   - 保留 global_prefix、system_append、agent_initial_context 不受裁剪

3. **文档标注**
   - 在 `docs/WORLD_PACK.md` 或 `constitution_schema.ts` 注释中明确：
     - `include_sections` 的作用范围（哪些 section 受控、哪些不受控）
     - 与 `section_policy` 的交互关系

#### 验收标准

- Pack 配置 `include_sections: ["memory_projection", "summary_compaction"]` 时，只有这两个 section 被渲染
- 不配置或配置空数组时，行为与当前完全一致
- global_prefix、system_append 不受裁剪

---

### P3-B：state_transform 预计算机制

**问题**：Pack 作者尝试在模板中写复杂条件表达式，但模板引擎只支持插值、`default()`、`#if`、`#each`。

#### 具体步骤

1. **Constitution Schema 增加 `state_transforms` 定义**
   - 位置：`apps/server/src/packs/schema/constitution_schema.ts`
   - 新增可选字段 `state_transforms`：
   ```yaml
   state_transforms:
     - source: public_opinion        # 源状态键
       ranges:                        # 区间映射
         - [0, 30]: "low"
         - [31, 70]: "medium"
         - [71, 100]: "high"
       target: public_opinion_stage   # 目标状态键
   ```
   - Schema 校验：source 和 target 都必须是已声明实体的有效 state 键路径

2. **物化阶段求值**
   - 在 `materializer.ts` 的 `materializePackRuntimeCoreModels()` 末尾（或在 simulation loop tick 处理中），对 `state_transforms` 进行求值
   - 将求值结果写入对应实体状态的 `state` 字段
   - 这确保模板中可以直接使用 `{{actor_state.public_opinion_stage}}`

3. **设计文档**
   - 此步骤仅产出设计和 Schema 定义，实际求值引擎实现需要视优先级安排

#### 验收标准

- `state_transforms` 的 Schema 定义通过校验
- 物化阶段能识别并存储 transform 定义（实际求值逻辑可后续实现）
- 模板引擎文档明确声明不支持原生 JS 表达式，状态区间应通过 `state_transforms` 预计算

---

## 里程碑

### M0：P0 紧急补丁完成
- invocation_type 前缀规范校验生效
- Pack 切换幽灵回退消除
- 所有现有 World Pack 规则已修正

### M1：P1 Actor Bridge 核心链路贯通
- Pack Actor 能通过推理 API 正常触发
- actor_state 不再为 null
- API 支持 actor_entity_id 参数

### M2：P2 健壮性增强完成
- Prompt Workflow 可脱离完整链路独立运行
- InferenceContext 子接口设计文档归档

### M3：P3 增强功能完成
- include_sections 执行层裁剪生效
- state_transform Schema 落地

---

## 风险与注意事项

1. **Actor Bridge ID 冲突**
   - 风险：Pack 生成的 `Agent`/`Identity` ID 与宿主种子 ID 冲突
   - 控制：使用 `{packId}:` 前缀约定，种子数据使用短 ID，天然不冲突
   - 附加措施：在 `seed_identity.ts` 和 `materializeActorBridges()` 中增加前缀冲突检测

2. **Actor Bridge 生命周期管理**
   - 风险：Pack 重载或切换后，旧的桥接记录不清理
   - 控制：在 `installPackRuntime()` 和 `unload()` 中增加级联清理
   - 使用数据库事务保证原子性

3. **resolveActor 新路径的回退兼容**
   - 风险：新路径引入 bug 导致现有 `agent_id`/`identity_id` 路径退化为错误行为
   - 控制：新路径仅在 `actor_entity_id` 提供且 `packId` 可用时激活；现有路径逻辑完全不变
   - 增加集成测试覆盖所有四条路径

4. **invocation_type 校验过严导致现有 Pack 加载失败**
   - 风险：Schema 校验使未修正的 Pack 无法加载
   - 控制：先执行 Kit 内批量修正，再部署校验
   - 校验错误信息需指出具体的修正方向

5. **Phase 2/3 不破坏主路径**
   - 所有 P2/P3 修改必须是增量式：不改变现有路径的签名和语义
   - `createInitialPromptWorkflowState` 的空值守卫不改变正常路径行为
   - `section_policy` 新增 `'include_only'` 模式是纯新增，不改变现有模式的语义

6. **P2-B 仅设计不实施**
   - InferenceContext 拆分是长期架构改善，本轮只产出类型定义和设计文档
   - 不在主路径中使用子接口类型，避免破坏性变更

---

## 完成判据

本计划完成后，应满足：

1. Pack Author 可以通过 `actor_entity_id` 触发推理，获得正确的 actor_state 反馈
2. 所有 Objective Rules 的 `invocation_type` 以 `invoke.` 前缀对齐，Schema 拦截裸名
3. Pack 加载与推理使用的 Pack 严格一致，不存在幽灵回退
4. Prompt Workflow 可以用最小 mock Context 独立运行，不再必须传入完整推理链路
5. `include_sections` 配置能实际控制 Prompt Section 的渲染
6. 测试覆盖全部新增路径，现有路径无退化