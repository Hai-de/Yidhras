<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/world-pack-unified-governance-framework-design.md","contentHash":"sha256:9defd16e0a9644c1ba83218faa2639c642305e65ccb9821767e2092f7c8b348e"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [ ] 审计 `SimulationManager` 当前职责、依赖与调用点，形成可执行的拆分 seam 清单  `#rbc1_simulation_inventory`
- [ ] 收口 `SimulationManager`：抽离 activation / runtime access / peripheral query 三类责任，并保持启动与运行时行为不变  `#rbc2_simulation_closure`
- [ ] 输出 ownership matrix 决策表，明确 `Event/Post/ActionIntent/InferenceTrace/DecisionJob/relationship evidence` 的 retain / migrate / bridge 结论  `#rbc3_ownership_matrix`
- [ ] 收口兼容 API：明确 `/api/agent/:id/overview` 与 `/api/policy/*` 的最终定位、内部转发/隔离方式与退场标准  `#rbc4_compat_api`
- [ ] 完成验证与文档同步：typecheck / tests / progress / ARCH / API 说明一致  `#rbc5_validation_docs`
<!-- LIMCODE_TODO_LIST_END -->

# 背景

在 `.limcode/design/world-pack-unified-governance-framework-design.md` 更新到当前代码状态后，unified governance framework 的主线已经成立，且以下事项已完成：

- legacy world-pack 输入兼容层已移除：`scenario / event_templates / actions / decision_rules`
- `world/schema.ts`、`world/loader.ts` 与 `/api/narrative/timeline` 已退出代码主线
- `death_note` 默认样板已显式使用 mediator 表达

当前剩余的工作，不再是修补 schema / mediator 样板，而是继续完成三项边界收口：

1. `SimulationManager` 收口
2. ownership matrix 收口
3. 兼容 API 收口

本计划用于把这三项尾项从“已识别问题”推进到“实现边界清晰、文档与代码一致”。

> 历史备注：文中提及的 `/api/policy/*` 兼容接口已在后续工作中外提为独立 `/api/access-policy/*` 子系统；此处旧命名仅用于保留当时的计划上下文。

# 目标

将当前后端统一治理框架从“主线已成立但仍有运行时边界尾项”推进到“runtime composition、ownership 与对外接口表面更加纯净”的状态，重点完成：

- 把 `SimulationManager` 从组合巨石收敛为更薄的 runtime 组合外壳
- 对关键 kernel / pack 对象形成明确的 ownership matrix 结论
- 对兼容 API 给出稳定结论：长期兼容 / 内部转发 / 退出

# 非目标

- 本计划不重新引入 `scenario / event_templates / actions / decision_rules`
- 本计划不一次性把所有 kernel-side Prisma 对象迁入 pack runtime
- 本计划不在本轮引入通用多 pack 并发激活模型
- 本计划不一次性做完所有 operator 高级视图产品化
- 本计划不改变已稳定的 pack-local runtime path：`data/world_packs/<pack_id>/runtime.sqlite`

# 设计输入 / 约束

本计划以下列设计结论为前提：

- world governance core 已 pack-owned：`WorldEntity / EntityState / AuthorityGrant / MediatorBinding / RuleExecutionRecord`
- `Event / Post / ActionIntent / InferenceTrace / DecisionJob / relationship runtime evidence` 当前继续位于 kernel-side Prisma，但其长期边界尚待最终决策
- canonical narrative 接口已统一到 `/api/packs/:packId/projections/timeline`
- canonical entity overview 已统一到 `/api/entities/:id/overview`
- `/api/agent/:id/overview` 与 `/api/policy/*` 当前仅剩兼容或 debug surface 地位

# 工作项

## 1. `SimulationManager` 收口

### 1.1 目标

把 `apps/server/src/core/simulation.ts` 从当前的 runtime composition hub 收敛为更清晰的组合外壳，避免继续承担过多初始化、激活、只读查询与 runtime 访问职责。

### 1.2 需要审计的职责

当前至少需要盘点并分类：

- Prisma 初始化
- SQLite runtime pragma 初始化
- active pack 加载
- `installPackRuntime(pack)`
- `materializePackRuntimeCoreModels(pack, tick)`
- ChronosEngine 初始化与推进
- runtime speed 访问
- graph 数据访问
- active pack metadata 暴露

### 1.3 实施方向

建议按以下三类 seam 进行拆分：

1. **Bootstrap / Activation**
   - 数据库准备
   - pack 加载
   - install / materialize
   - tick 恢复
2. **Runtime State Access**
   - clock
   - runtime speed
   - active pack metadata
3. **Peripheral Query Access**
   - graph / overview / 辅助只读访问

### 1.4 交付要求

- 形成 `SimulationManager` 职责矩阵与调用点清单
- 识别可先抽离的最小模块，不强行大爆炸重构
- 保持现有启动顺序、错误语义与 runtime readiness 行为稳定
- 避免把新的编排逻辑继续堆入 `SimulationManager`

### 1.5 重点文件

- `apps/server/src/core/simulation.ts`
- `apps/server/src/index.ts`
- `apps/server/src/app/context.ts`
- `apps/server/src/app/services/**/*.ts`
- `apps/server/src/app/routes/**/*.ts`
- `apps/server/src/init/**/*.ts`

## 2. Ownership Matrix 收口

### 2.1 目标

把当前“已明确中间态”推进为“有决策、有理由、有后续边界约束”的 ownership matrix，而不是继续仅停留在状态描述层。

### 2.2 需要形成结论的对象

- `Event`
- `Post`
- `ActionIntent`
- `InferenceTrace`
- `DecisionJob`
- relationship runtime evidence
- 是否需要正式 `PackOutboxEvent`

### 2.3 决策维度

对每个对象至少输出以下字段：

- 当前宿主：kernel / pack
- 当前用途：workflow / operator / social / pack-governance / projection bridge
- 建议结论：`retain-in-kernel` / `migrate-to-pack` / `bridge-between-both`
- 结论理由：为什么这样划分
- 若未来迁移：前置条件、迁移顺序、验证面
- 若继续保留：需要增加哪些文档、接口或代码注释约束，避免边界再次漂移

### 2.4 当前建议方向

- 明显服务于全局 workflow / operator / social 的对象，可保留在 kernel-side，但要写清理由
- 明显服务于 pack 内部世界治理的对象，应优先 pack-owned
- 横跨两侧的对象，不直接模糊复用，而是评估 bridge / outbox / projection extraction 边界

### 2.5 交付要求

- 在设计 / 架构 / API 文档中统一表述 ownership matrix
- 必要时增加轻量代码注释、命名或边界封装，避免误把 kernel 对象继续扩展为 pack runtime 主线
- 若 `PackOutboxEvent` 暂不引入，也必须记录“不引入”的理由与替代机制

### 2.6 重点文件

- `apps/server/prisma/schema.prisma`
- `apps/server/src/packs/runtime/projections/*.ts`
- `apps/server/src/kernel/projections/*.ts`
- `apps/server/src/domain/**/*.ts`
- `apps/server/src/app/services/**/*.ts`
- `docs/ARCH.md`
- `docs/API.md`

## 3. 兼容 API 收口

### 3.1 目标

把剩余 compatibility API 从“还在，但说不清”推进到“定位明确、调用稳定、退场条件明确”。

### 3.2 需要处理的接口

- `GET /api/agent/:id/overview`
- `POST /api/policy`
- `POST /api/policy/evaluate`

### 3.3 实施方向

#### A. `/api/agent/:id/overview`

需要明确：

- 是否继续长期保留为兼容路由
- 是否明确标记为内部转发到 `/api/entities/:id/overview`
- 文档中是否继续公开，或降级为 compatibility note
- 前端/调用方是否仍存在真实依赖

#### B. `/api/policy/*`

需要明确：

- 是否长期保留为 access / projection policy debug surface
- 是否需要从 unified governance 主文档中进一步降级
- 是否应进一步隔离到更明确的 access-policy 子系统边界
- 是否存在误用为世界治理主入口的风险

### 3.4 交付要求

- 为每条兼容接口给出“保留 / 冻结 / 隔离 / 删除”的明确结论
- 若保留，要求内部实现不再承载独立主线逻辑
- 若删除，要求给出替代调用面与迁移路径
- 文档与路由实现语义保持一致

### 3.5 重点文件

- `apps/server/src/app/routes/agent.ts`
- `apps/server/src/app/routes/policy.ts`
- `apps/server/src/app/services/agent.ts`
- `apps/server/src/app/services/policy.ts`
- `docs/API.md`
- `docs/ARCH.md`
- web 端相关调用点（如存在）

## 4. 验证与文档同步

实施后至少执行：

- `pnpm --filter yidhras-server typecheck`
- `pnpm --filter yidhras-server test:unit -- --runInBand`
- `pnpm --filter yidhras-server test:integration -- --runInBand`
- `pnpm --filter yidhras-server test:e2e -- --runInBand`

并同步：

- `.limcode/design/world-pack-unified-governance-framework-design.md`
- `.limcode/progress.md`
- `docs/ARCH.md`
- `docs/API.md`
- 必要的 TODO / 计划快照

# 分阶段建议

## Phase 1：Inventory / Decision

- 审计 `SimulationManager` 职责与调用点
- 盘点 ownership matrix 相关对象的当前宿主与用途
- 盘点 `/api/agent/:id/overview` 与 `/api/policy/*` 的调用方与实现边界
- 先形成决策表，再开始重构

## Phase 2：Runtime Boundary Closure

- 先抽离 `SimulationManager` 中最稳定的 activation / bootstrap seam
- 再收敛 runtime state access 与只读辅助访问
- 保证 `index.ts` 与 `AppContext` 的组合方式更清晰，但不破坏现有行为

## Phase 3：Ownership / API Closure

- 落地 ownership matrix 对应的边界调整、封装或文档约束
- 收口兼容 API 的实现与文档定位
- 避免继续把 compat route / kernel object 当作 pack-governance 主线继续扩展

## Phase 4：Validation / Sync

- 跑通 typecheck / tests
- 同步 design / progress / ARCH / API 文档
- 记录本轮结论与后续仍保留的开放问题

# 风险与控制

### 风险 1：`SimulationManager` 拆分过度，反而引入初始化顺序回归

**控制：**

- 先做 seam 提取，再做结构命名调整
- 不在同一轮中同时改动 runtime activation、clock、graph 等全部调用点

### 风险 2：ownership matrix 讨论停留在文档层，没有落到代码边界

**控制：**

- 每项结论都要对应代码边界、注释、模块职责或接口说明的变更
- 至少要能在 `ARCH/API/design` 三处看到一致表述

### 风险 3：compat API 仍被外部当成 canonical 主线

**控制：**

- 在 route 命名、实现、文档中同时降级其地位
- 如决定保留，必须冻结语义并明确替代接口

### 风险 4：本轮范围膨胀成“大一统重构”

**控制：**

- 本轮优先完成边界澄清与最小必要收口
- 不强求一次性迁移所有 kernel-side 对象或完成多 pack runtime 重构

# 完成判定

满足以下条件视为本计划完成：

1. `SimulationManager` 的职责边界被清单化并完成一轮最小有效收口
2. ownership matrix 对关键对象形成明确 retain / migrate / bridge 结论，并同步到文档与代码边界
3. `/api/agent/:id/overview` 与 `/api/policy/*` 的最终定位被明确并落地一轮
4. 相关 typecheck / unit / integration / e2e 验证通过
5. design / progress / ARCH / API 的表述与代码状态一致
