## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [ ] Milestone A：冻结行为基线与回归护栏  `#bx1`
- [ ] Milestone B：引入 AppContext / createApp / route registration 骨架  `#bx2`
- [ ] Milestone C：按 API 分组迁移 routes 并瘦身 index.ts  `#bx3`
- [ ] Milestone D：抽离 HTTP helpers 与通用校验/序列化能力  `#bx4`
- [ ] Milestone E：整理 system/identity 等服务边界并为 inference 预留模块位  `#bx5`
- [ ] Milestone F：完成重构验收、文档同步与回滚预案校验  `#bx6`
<!-- LIMCODE_TODO_LIST_END -->

# 后端重构正式执行计划

## 1. 计划定位

本计划是对《后端重构路线草案（评估版）》的执行级细化。

它不是抽象建议，而是一个可以真正进入施工排期的方案。

执行原则：

- **轻量重构优先**：先收敛入口和应用层，不做全栈翻修。
- **外部行为稳定**：重构期间尽量不改变对外 API 语义。
- **阶段可停可验**：每一个里程碑都应该可以独立提交、独立验证、独立回滚。
- **服务 M2**：这次重构的核心目标之一，是为 Inference Interface 留出干净接入位。

---

## 2. 当前施工目标

本轮重构的目标不是“重写后端”，而是完成以下 4 项结构性改善：

1. 把 `apps/server/src/index.ts` 从超级入口文件降级为应用装配层。
2. 把共享 HTTP 基础设施从业务定义中抽离出来。
3. 把路由按 API 领域拆分，避免后续继续堆积在入口文件。
4. 给未来 inference 模块预留独立 route/service 接入位置。

---

## 3. 执行边界

## 3.1 本轮包含

- `index.ts` 瘦身
- `createApp()` 装配函数
- `AppContext` 统一依赖传递
- route module 拆分
- middleware / helper / parser / validator 抽离
- 文档同步与 smoke 验证

## 3.2 本轮不包含

- Prisma schema 重构
- SimulationManager 重写
- repository pattern 全面引入
- 全面 service 化所有模块
- 正式 Phase D 工作流持久化
- 大规模测试框架升级

---

## 4. 推荐施工顺序

建议按 6 个里程碑推进，而不是一次性提交。

---

## Milestone A：冻结行为基线与回归护栏

### 目标
明确哪些行为不能变，并把现有 smoke 当成重构护栏。

### 主要动作

1. 记录当前必须保持稳定的接口行为：
   - `/api/status`
   - `/api/health`
   - `/api/runtime/speed`
   - `/api/clock`
   - `/api/clock/formatted`
   - `/api/system/notifications`
   - social/relational/narrative 现有读接口
   - identity/binding/policy 相关接口
2. 明确不可破坏约束：
   - 统一错误包络
   - `X-Request-Id`
   - `503/WORLD_PACK_NOT_READY`
   - BigInt → string
3. 确认当前 smoke 命令作为验收门槛：
   - `npm run smoke:startup --prefix apps/server`
   - `npm run smoke:endpoints --prefix apps/server`

### 文件动作
建议主要是文档和注释级别动作，不急于改代码。

可涉及：
- `README.md`
- `API.md`
- `记录.md`
- `.limcode/plans/backend-refactor-roadmap-draft.md`
- 新增执行记录文档（可选）

### 验收标准
- 基线接口清单明确。
- 重构验收约束明确。
- smoke 命令被正式视为重构回归护栏。

### 回滚成本
极低。

---

## Milestone B：引入 AppContext / createApp / route registration 骨架

### 目标
在不大量迁移业务代码的前提下，先建立新的装配层骨架。

### 建议新增结构

```text
apps/server/src/app/
  context.ts
  create_app.ts
```

### 推荐职责

#### `app/context.ts`
定义 `AppContext`，统一承载：

- `prisma`
- `sim`
- `notifications`
- `startupHealth`
- `getRuntimeReady()`
- `assertRuntimeReady()`

#### `app/create_app.ts`
负责：

- 创建 express app
- 注册基础 middleware
- 注册 route modules（即使初期仍然部分委托给旧逻辑）

### 对 `index.ts` 的要求
先不大拆业务，只做第一轮收敛：

- 保留启动流程
- 把 app 创建过程移交给 `createApp(context)`

### 文件清单
建议新增：
- `apps/server/src/app/context.ts`
- `apps/server/src/app/create_app.ts`

建议修改：
- `apps/server/src/index.ts`

### 验收标准
- 服务仍可启动。
- `index.ts` 已不再直接负责 Express app 的完整注册流程。
- `AppContext` 成为后续 route 拆分的依赖入口。

### 风险
- context 设计过大或过小。
- shared mutable state 的生命周期处理不当。

### 回滚策略
- 保持单次提交范围小。
- `createApp()` 只做装配搬迁，不同步做业务重写。

---

## Milestone C：按 API 分组迁移 routes 并瘦身 `index.ts`

### 目标
把当前 route 定义从 `index.ts` 迁出，按 API 领域拆分。

### 建议目录

```text
apps/server/src/app/routes/
  system.ts
  clock.ts
  social.ts
  relational.ts
  narrative.ts
  identity.ts
  policy.ts
```

### 推荐迁移顺序

#### 第一批：低耦合接口
1. `system.ts`
   - `/api/system/notifications`
   - `/api/system/notifications/clear`
   - `/api/status`
   - `/api/health`
2. `clock.ts`
   - `/api/clock`
   - `/api/clock/formatted`
   - `/api/clock/control`
   - `/api/runtime/speed`

#### 第二批：中等耦合接口
3. `relational.ts`
4. `narrative.ts`
5. `social.ts`

#### 第三批：高耦合接口
6. `identity.ts`
7. `policy.ts`

原因：
- system/clock 相对规则稳定，适合先拆；
- identity/policy 校验和状态流更多，放后面更稳。

### 文件清单
新增：
- `apps/server/src/app/routes/system.ts`
- `apps/server/src/app/routes/clock.ts`
- `apps/server/src/app/routes/social.ts`
- `apps/server/src/app/routes/relational.ts`
- `apps/server/src/app/routes/narrative.ts`
- `apps/server/src/app/routes/identity.ts`
- `apps/server/src/app/routes/policy.ts`

修改：
- `apps/server/src/app/create_app.ts`
- `apps/server/src/index.ts`

### 验收标准
- routes 已按 API 分组迁移。
- `index.ts` 不再包含长段 route handler 定义。
- 对外 API 行为保持不变。

### 风险
- route 拆分时遗漏共享 helper。
- route 文件间出现复制粘贴逻辑。

### 回滚策略
- 按 route 组分批提交。
- 每迁出 1～2 组就跑一次 smoke。

---

## Milestone D：抽离 HTTP helpers 与通用校验/序列化能力

### 目标
把 route 共享逻辑从入口/route 层抽走，形成应用层基础设施。

### 建议目录

```text
apps/server/src/app/http/
  async_handler.ts
  runtime_guard.ts
  json_safe.ts
  parsers.ts
  validators.ts
apps/server/src/app/middleware/
  request_id.ts
  error_handler.ts
```

### 建议迁移内容

#### `app/http/async_handler.ts`
- `asyncHandler`

#### `app/http/runtime_guard.ts`
- `assertRuntimeReady`

#### `app/http/json_safe.ts`
- `toJsonSafe`

#### `app/http/parsers.ts`
- `parsePositiveStepTicks`
- `parseOptionalTick`
- future query parsers

#### `app/http/validators.ts`
- `validatePolicyConditions`
- future enum/input validators

#### `app/middleware/request_id.ts`
- request id 注入

#### `app/middleware/error_handler.ts`
- 统一错误处理
- 与 `utils/api_error.ts` 对齐

### 文件清单
新增：
- `apps/server/src/app/http/async_handler.ts`
- `apps/server/src/app/http/runtime_guard.ts`
- `apps/server/src/app/http/json_safe.ts`
- `apps/server/src/app/http/parsers.ts`
- `apps/server/src/app/http/validators.ts`
- `apps/server/src/app/middleware/request_id.ts`
- `apps/server/src/app/middleware/error_handler.ts`

修改：
- `apps/server/src/app/create_app.ts`
- `apps/server/src/app/routes/*.ts`
- `apps/server/src/index.ts`

### 验收标准
- route 层不再内联大段通用 helper。
- request id / error envelope / runtime gating 逻辑已稳定抽离。
- `index.ts` 进一步瘦身。

### 风险
- helper 之间相互依赖不清，形成新一层耦合。

### 回滚策略
- helper 抽离按类别分批进行，不要一次性全部迁移。

---

## Milestone E：整理 system / identity 等服务边界，并为 inference 预留接入位

### 目标
让应用层调用路径更稳定，并明确 future inference 放在哪里。

### 本阶段不是大改领域逻辑
重点是：

- 明确 route → service / manager 的调用路径
- 避免 route 直接知道过多底层细节
- 给 inference 准备独立位置

### 建议结构补充

```text
apps/server/src/inference/
  (暂为空或仅放 README/placeholder)
```

或至少在：
- `app/routes/inference.ts`
- `inference/service.ts`

层面预留命名与位置。

### 对现有模块的建议

#### system 方向
逐步形成更稳定的应用服务边界，例如：
- runtime status snapshot
- runtime speed mutation
- startup health snapshot

#### identity / policy 方向
维持：
- route 层做参数收集
- service / policy engine 做业务判断

#### social / narrative / relational 方向
暂不强求立即 service 化，但应避免 route 持续直接膨胀。

### 文件清单
可能新增：
- `apps/server/src/app/routes/inference.ts`（占位或最小骨架）
- `apps/server/src/inference/README.md` 或占位文件（可选）

可能修改：
- `apps/server/src/app/create_app.ts`
- `apps/server/src/identity/service.ts`
- `apps/server/src/identity/policy_engine.ts`
- 其他 route modules

### 验收标准
- inference 的接入位置在结构上已经明确。
- system / identity 等模块的调用边界更清晰。
- route 层不继续向业务细节扩张。

### 风险
- 在这一阶段忍不住顺手做太多业务抽象。

### 回滚策略
- 明确这一步只做“边界整理”，不做“业务重写”。

---

## Milestone F：完成重构验收、文档同步与回滚预案校验

### 目标
确认重构完成后，系统仍然稳定，文档没有漂移，并且保留失败时的收敛路径。

### 主要动作

1. 跑回归验证：
   - `npm run lint --prefix apps/server`
   - `npm run typecheck --prefix apps/server`
   - `npm run smoke:startup --prefix apps/server`
   - `npm run smoke:endpoints --prefix apps/server`
2. 检查 `README.md` / `AGENTS.md` / `ARCH.md` / `API.md` 是否需要同步。
3. 在 `记录.md` 中记录这次重构的结果与约束。
4. 复核 `index.ts` 是否已经真正瘦身，而不是仅搬家未减责。

### 验收标准
- lint/typecheck/smoke 全通过。
- 文档口径同步完成。
- 入口文件职责清晰。
- future inference 接入位明确。

### 回滚策略
- 保留按 milestone 切分的提交历史。
- 如果后续 M2 施工中发现结构不适，应优先局部回调 route/helper 设计，而不是推翻整体装配层。

---

## 5. 推荐提交粒度

为了控制风险，我建议按以下粒度提交，而不是一个大提交完成全部：

### Commit Group 1
- 引入 `AppContext`
- 引入 `createApp()`
- `index.ts` 只做最小接线修改

### Commit Group 2
- 拆 `system.ts` 与 `clock.ts` routes

### Commit Group 3
- 拆 `social.ts` / `relational.ts` / `narrative.ts`

### Commit Group 4
- 拆 `identity.ts` / `policy.ts`

### Commit Group 5
- 抽离 `http/` helpers 与 middleware

### Commit Group 6
- 整理文档、补验收、为 inference 预留位置

这样做的好处：

- 每一步回归范围明确；
- 更容易定位问题；
- 遇到结构不适也容易停在中间状态。

---

## 6. 推荐文件落位蓝图

建议目标结构如下：

```text
apps/server/src/
  app/
    context.ts
    create_app.ts
    http/
      async_handler.ts
      json_safe.ts
      parsers.ts
      runtime_guard.ts
      validators.ts
    middleware/
      error_handler.ts
      request_id.ts
    routes/
      clock.ts
      identity.ts
      inference.ts
      narrative.ts
      policy.ts
      relational.ts
      social.ts
      system.ts
  core/
    runtime_speed.ts
    simulation.ts
  identity/
    middleware.ts
    policy_engine.ts
    service.ts
    types.ts
  inference/
    (Phase B implementation later)
  narrative/
    resolver.ts
    types.ts
  utils/
    api_error.ts
    notifications.ts
  world/
    bootstrap.ts
    loader.ts
  index.ts
```

说明：

- 这是目标蓝图，不要求一次性全部填满；
- `inference/` 可以先占位，后续再按 M2 进入；
- 当前重点是 `app/` 层，不是深挖所有 existing domain 目录。

---

## 7. 本计划对 M2 的直接帮助

完成这轮重构后，M2 inference 将获得以下收益：

1. 可以新增 `app/routes/inference.ts`，不污染入口文件。
2. 可以通过 `AppContext` 安全获得：
   - sim
   - runtime ready state
   - Prisma
   - notifications
3. 可以复用已有：
   - error handler
   - async handler
   - runtime guard
   - json safe
4. inference service 更容易保持为独立模块，而不是 route 拼装脚本。

所以这轮重构不是与 M2 抢时间，而是在降低 M2 开工后的结构摩擦成本。

---

## 8. 计划风险与控制点

### 风险 1：结构先行过度
控制点：
- 每一步都问“是否真的减少了入口复杂度”。

### 风险 2：抽 helper 时产生新耦合
控制点：
- helper 只做一类职责，不做大杂烩工具箱。

### 风险 3：AppContext 失控
控制点：
- `AppContext` 只放装配必需依赖，不把所有东西都塞进去。

### 风险 4：route 拆分后仍保留大量重复代码
控制点：
- 先拆 route，再回头抽共性，不要一开始就过度抽象。

### 风险 5：重构时间拉长，挤压 M2
控制点：
- 优先完成 Milestone B/C/D。
- E/F 可以与 M2 设计冻结阶段轻度交错。

---

## 9. 推荐启动顺序

如果你决定按这个执行计划推进，我建议起手顺序是：

### 第一优先级
- Milestone B：`AppContext + createApp()`

### 第二优先级
- Milestone C：拆 `system/clock` routes

### 第三优先级
- Milestone D：抽 `asyncHandler / runtimeGuard / jsonSafe`

也就是说，最稳的开局是：

> **先把装配骨架立起来，再拆最稳定的 routes，再抽共性基础设施。**

这是风险最低、也最容易中途停下来的起手方式。

---

## 10. 执行完成定义

当满足以下条件时，可以认为本轮后端重构基本完成：

1. `index.ts` 只剩启动与装配职责；
2. 主要 route 已迁出；
3. HTTP helper 与 middleware 已抽离；
4. smoke / lint / typecheck 全通过；
5. future inference 的接入位已准备好；
6. 根目录文档已与新结构保持一致。

---

## 11. 最终建议

我的建议是：

- **执行这轮重构**，但控制在“应用层收敛”范围内；
- **不要把它升级成后端架构全面翻新工程**；
- **先完成 B/C/D 三个核心里程碑，再决定是否继续推进 E/F 深化整理**。

简化成一句话：

> 这轮重构最应该做的是“为后续开发扫清结构障碍”，
> 而不是“把后端改造成一套全新哲学”。
