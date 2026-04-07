<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/world-pack-unified-governance-framework-design.md","contentHash":"sha256:47c61f23ce91bba77857fbc1449ceeaac7b5d353b35a916beca9b85f64dec7b9"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 明确 pack runtime storage 收尾策略，并锁定从 sidecar JSON 过渡到 runtime.sqlite engine-owned collections 的实施边界  `#wfbc1_storage_decision`
- [x] 收口 pack runtime storage 实现，将 world_entities/entity_states/authority_grants/mediator_bindings/rule_execution_records 迁移到真实 runtime.sqlite 持久化  `#wfbc2_storage_sqlite`
- [x] 收口 `/api/packs/:packId/overview` 与 `/api/packs/:packId/projections/timeline` 的 packId 语义，并补强 Event bridge 的 pack-scoped 过滤/关联契约  `#wfbc3_pack_api_bridge`
- [x] 冻结兼容接口 `/api/agent/:id/overview` 与 `/api/policy/*` 的最终定位、文档表述与退场条件  `#wfbc4_compat_freeze`
- [x] 提供 Operator 高级视图所需的后端证据/接口契约；前端页面与交互实现明确交由前端团队  `#wfbc5_operator_backend_contract`
- [x] 完成 typecheck/tests 与 design/progress/ARCH/API 同步，确保代码状态、计划与文档一致  `#wfbc6_validation_docs`
<!-- LIMCODE_TODO_LIST_END -->

# Source Design

- 设计来源：`.limcode/design/world-pack-unified-governance-framework-design.md`
- 本计划基于当前代码审计结果生成，用于承接 unified governance framework 在“第一轮收口完成”之后剩余的后端长尾收尾项。

# 当前状态（审计结论）

当前代码已经完成 unified governance framework 的主线落地，并已完成第一轮 runtime boundary / ownership / compat API 收口：

- canonical world-pack contract 已收敛到 `metadata / constitution / variables / prompts / time_systems / simulation_time / entities / identities / capabilities / authorities / rules / storage / bootstrap`
- legacy 输入 `scenario / event_templates / actions / decision_rules` 已退出公开 contract
- runtime 已能 materialize `entities / identities / authorities / mediators / bootstrap.initial_states`
- inference context 已能注入 authority、perception、mediator binding 与 pack runtime 上下文
- invocation / objective enforcement 已取代旧的 pack action 主线
- `/api/entities/:id/overview`、`/api/packs/:packId/projections/timeline`、`/api/packs/:packId/overview` 已成为当前 canonical surface
- `SimulationManager` 已完成第一轮 runtime facade 收口；activation/bootstrap 主流程已抽出到 `apps/server/src/core/runtime_activation.ts`

但审计也表明，仍存在几项“设计主线成立之后的后端收尾差距”：

1. `runtime.sqlite` 路径已经建立，但 engine-owned runtime collections 当前仍通过 `runtime.sqlite.storage-plan.json` sidecar 读写，而非真实 SQLite collection/table 持久化。
2. `packId` 路由语义尚未完全收口：`/api/packs/:packId/overview` 与 `/api/packs/:packId/projections/timeline` 仍部分依赖 active-pack / global bridge 语义，而不是严格 pack-scoped 语义。
3. `Event` 仍承担 kernel-hosted shared evidence bridge，但缺少足够明确的 pack-scoped 过滤/关联契约，导致 narrative timeline 与未来多 pack 语义之间仍有模糊空间。
4. `/api/agent/:id/overview` 与 `/api/policy/*` 已降级，但还缺少最终“冻结/保留/退场”的明确后端实施边界。
5. Operator 高级视图仍主要停留在后端基础证据层；本轮只规划其**后端证据/接口契约**，具体前端页面、交互、工作台编排明确交由前端团队完成。

# 目标

将当前 world-pack unified governance framework 从“主线成立 + 第一轮收口完成”推进到“后端语义更加自洽、pack/runtime 边界更加真实、Operator 高级视图具备可消费的后端证据合同”的状态，重点完成：

- 让 pack runtime storage 的实现与设计表述重新对齐
- 让 pack-centric API 真正具备明确的 `packId` 语义
- 让 `Event` bridge 的 pack/evidence 合同明确下来，而不是继续依赖隐式约定
- 让 compat API 进入冻结或可验证退场状态
- 为 Operator 高级视图补齐后端数据合同，但不承担其前端产品实现

# 非目标

- 本计划不重新引入 `scenario / event_templates / actions / decision_rules`
- 本计划不一次性把全部 kernel-side Prisma 模型迁入 pack runtime
- 本计划不在本轮完成通用多 pack 并发激活架构
- 本计划**不实现 Operator 高级视图前端页面、交互、工作台布局与前端状态管理**
- 本计划不要求一次性重做整套 projection 产品形态，只要求把后端证据与语义边界补齐

# 工作流与实施范围

## 1. Pack Runtime Storage 收尾

### 1.1 目标

把当前“有 `runtime.sqlite` 路径，但实际核心 runtime 数据仍主要保存在 sidecar JSON 计划文件中”的中间态，收口为设计与代码都能自洽的状态。

### 1.2 需要解决的问题

- `world_entities`
- `entity_states`
- `authority_grants`
- `mediator_bindings`
- `rule_execution_records`
- `projection_events`

当前这些 engine-owned collections 已在 storage contract 中存在，也已经被 compiler / storage engine 识别，但其 repo 层仍主要读取 `runtime.sqlite.storage-plan.json` 中的数组内容。

### 1.3 实施方向

建议按以下顺序推进：

1. 先显式区分：
   - `runtime.sqlite`：运行时数据宿主
   - `*.storage-plan.json`：安装/编译元数据与必要 schema 快照
2. 为 engine-owned collections 建立清晰的 storage adapter seam，避免 repo 直接绑死到 sidecar JSON。
3. 将 engine-owned runtime collections materialize 到真实 `runtime.sqlite`，并迁移现有 repo 读写逻辑。
4. 保留 `storage-plan.json` 作为编译/安装元数据，而不是继续充当 runtime data store。
5. 为已有 pack 数据准备最小迁移与兼容读取策略，避免直接破坏现有本地环境。

### 1.4 交付要求

- `compile_pack_storage.ts`、`pack_storage_engine.ts`、`packs/storage/*_repo.ts` 的职责边界明确
- engine-owned collections 的真实宿主不再与安装元数据混用
- `data/world_packs/<pack_id>/runtime.sqlite` 的文档表述与实际实现一致
- 新增针对 runtime storage 行为的 unit / integration 覆盖

## 2. Pack-Centric API 与 Event Bridge 语义收尾

### 2.1 目标

把当前已经命名 canonical、但语义上仍存在 active-pack / global-bridge 模糊地带的 API 收口为明确后端合同。

### 2.2 需要重点收口的接口与投影

- `GET /api/packs/:packId/overview`
- `GET /api/packs/:packId/projections/timeline`
- `packs/runtime/projections/entity_overview_service.ts`
- `packs/runtime/projections/narrative_projection_service.ts`
- `kernel/projections/operator_overview_service.ts`
- `kernel/projections/projection_extractor.ts`

### 2.3 实施方向

#### A. `/api/packs/:packId/overview`

需要明确其到底是：

- “仅允许访问当前 active pack，且 packId 只是显式确认参数”
- 还是“真正支持按请求 packId 读取对应 pack 的投影”

无论选哪一种，都要把实现、错误语义、文档说明与测试统一起来，不能继续出现“路由有 packId，但内部仍复用 active pack 结果”的半透明状态。

#### B. `/api/packs/:packId/projections/timeline`

需要明确：

- narrative timeline 是否只返回当前 pack 的事件与 rule execution evidence
- `Event` 作为 kernel-hosted bridge 时，如何携带足够的 pack-scoped 关联信息
- 如果当前仍不引入 `PackOutboxEvent`，那么需要什么最小 bridge contract 来保证 pack 过滤和 operator/narrative 投影可解释

### 2.4 交付要求

- `packId` 路由语义与实现保持一致
- narrative timeline 不再依赖隐式全局事件集合
- `Event` bridge 的 pack-scoped 过滤/关联方式有明确代码与文档表达
- 如继续不引入 `PackOutboxEvent`，需同步记录“不引入”的理由与替代合同

## 3. Compat API 最终冻结

### 3.1 目标

把剩余兼容接口从“已降级”推进到“后端语义冻结，并具备可验证退场条件”的状态。

### 3.2 范围

- `GET /api/agent/:id/overview`
- `POST /api/policy`
- `POST /api/policy/evaluate`

### 3.3 实施方向

#### A. `/api/agent/:id/overview`

- 保持其 compatibility alias 身份，不再承载独立主线聚合逻辑
- 明确是内部转发/复用 canonical entity overview 的兼容壳
- 在文档中进一步降级为 compatibility note，并定义删除条件

#### B. `/api/policy/*`

- 明确其长期仅为 access / projection policy debug surface
- 不再允许被误读为 unified governance framework 的中心入口
- 如需长期保留，需在 API/ARCH 文档中独立标记其边界

### 3.4 交付要求

- 每条 compat API 都有“保留/冻结/退场条件”的结论
- 路由实现、注释、API 文档与 web 调用面表述一致
- 不再为 compat route 增长新的 canonical 逻辑

## 4. Operator 高级视图：后端合同补齐，前端明确交接

### 4.1 目标

补齐 Operator 高级视图所需的后端证据合同，使前端团队能够基于稳定数据面独立完成页面与交互。

### 4.2 本轮明确只做后端的内容

围绕以下视角，规划或补齐后端 evidence / projection / API 合同：

- Authority Inspector
- Rule Execution Timeline
- Perception Diff

本轮后端工作可以包括：

- 明确数据模型与字段约定
- 统一 provenance / mediator / capability / rule execution 的输出格式
- 如有必要，补充专用 projection/service 或细化现有 overview/timeline 输出
- 为前端提供明确的 contract 示例与使用说明

### 4.3 明确不做的内容

以下事项**明确交由前端团队完成，不纳入本计划实现范围**：

- 具体页面 UI
- 交互流程与状态管理
- 工作台布局与导航整合
- 组件视觉表达、筛选器、列表编排、可视化呈现

### 4.4 交付要求

- 后端证据合同足够支撑前端独立实现 Authority Inspector / Rule Execution Timeline / Perception Diff 页面
- 必要时补充 API/contract 文档示例
- 计划与 progress 中明确标注“前端实现不在本计划范围内”

## 5. 验证与文档同步

实施后至少要求：

- `pnpm --filter yidhras-server typecheck`
- `pnpm --filter yidhras-server test:unit -- --runInBand`
- `pnpm --filter yidhras-server test:integration -- --runInBand`
- `pnpm --filter yidhras-server test:e2e -- --runInBand`

并同步：

- `.limcode/design/world-pack-unified-governance-framework-design.md`
- `.limcode/progress.md`
- `docs/ARCH.md`
- `docs/API.md`
- 必要的测试、TODO 快照与 handoff 说明

# 建议实施阶段

## Phase 1：Storage Truthing

- 先完成 storage current-state inventory
- 决定 `runtime.sqlite` 与 `storage-plan.json` 的最终职责
- 建立最小迁移方案与 repo adapter seam

## Phase 2：Pack-Scoped API / Event Bridge Closure

- 收口 `packId` 路由的真实语义
- 补齐 `Event` 与 pack/rule execution 的最小关联合同
- 让 narrative/operator 投影对 pack 过滤更明确

## Phase 3：Compat Freeze + Operator Backend Contract

- 冻结 compat API 的最终定位
- 补齐 Operator 高级视图需要的后端 contract
- 产出前端 handoff 说明，明确前端负责的实现范围

## Phase 4：Validation / Docs / Progress Sync

- 运行验证
- 同步 design / progress / ARCH / API
- 记录本轮最终收尾结论与剩余长期开放问题

# 风险与控制

### 风险 1：Storage 收尾演变成大规模基础设施重写

**控制：**

- 优先让 engine-owned collections 的真实宿主与现有 repo 边界对齐
- 不在同一轮中顺手引入过多新的 storage abstraction
- 先收口事实语义，再决定是否继续演进 projection DB / 多 pack 基础设施

### 风险 2：`packId` 路由继续保持“名义 pack 化、实际 active-pack 化”的灰色状态

**控制：**

- 在实现、错误码、文档、测试四处统一 contract
- 若短期仍保留单 active pack 假设，也要明确写进 API 语义，而不是隐含依赖

### 风险 3：Operator 高级视图范围失控，变成全栈产品大项目

**控制：**

- 本计划只负责后端 evidence / contract / projection 能力
- 前端页面、交互、状态管理与工作台集成交由前端团队
- 通过 handoff 说明切清前后端责任

### 风险 4：Compat API 虽然继续存在，但没有真正冻结

**控制：**

- 对 compat route 明确“不新增主线逻辑”的约束
- 为保留与删除都设置可验证条件
- 保证 canonical route 继续是唯一优先调用面

# 完成判定

满足以下条件视为本计划完成：

1. pack runtime storage 的实现与设计表述重新对齐，engine-owned runtime data 不再依赖 `storage-plan.json` 充当主数据宿主
2. `/api/packs/:packId/overview` 与 `/api/packs/:packId/projections/timeline` 的 `packId` 语义明确、实现一致、测试覆盖齐全
3. `Event` bridge 的 pack-scoped 过滤/关联合同明确，且 narrative/operator 投影能够自洽解释
4. `/api/agent/:id/overview` 与 `/api/policy/*` 进入明确冻结状态，并具备文档化退场条件
5. Operator 高级视图的后端 evidence / projection / API contract 已具备前端接入条件，且计划中明确前端实现交由前端团队
6. typecheck / unit / integration / e2e 与 design / progress / ARCH / API 同步完成
