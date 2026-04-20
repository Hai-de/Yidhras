# 多世界包同时运行（实验性）设计评估
- 日期: 2026-04-18
- 概述: 评估第五阶段多世界包同时运行为何应保持 experimental、默认关闭，并梳理主要改造面与保守落地路线。
- 状态: 进行中
- 总体结论: 待定

## 评审范围

# 多世界包同时运行（实验性）设计评估

日期：2026-04-18

## 概览

本次评估针对 `TODO.md` 第五阶段“多世界包同时运行（默认 experimental / 默认关闭 / 先 operator / test-only）”展开，目标不是直接实现，而是判断该能力在当前项目中的改造重量、风险边界与保守落地方式。

当前结论：

- 将多世界包同时运行列为 **experimental feature** 是合理且必要的；
- 该阶段本质上不是“加一个功能”，而是把当前单 active-pack 运行时提升为更接近 **runtime container / registry** 的系统能力；
- 不应直接把现有稳定的单 active-pack contract 改成默认 multi-pack；
- 应先以 **默认关闭 + operator / test-only + experimental API** 的方式验证。

## 已审阅模块

- `TODO.md`
- `docs/ARCH.md`
- `docs/API.md`
- `apps/server/src/core/simulation.ts`
- `apps/server/src/app/create_app.ts`
- `apps/server/src/app/services/system.ts`
- `apps/server/src/packs/runtime/projections/active_pack_projection_guard.ts`
- `apps/server/src/plugins/runtime.ts`
- `apps/server/src/inference/context_builder.ts`

## 里程碑

### M1：确认第五阶段应保持 experimental

当前 `TODO.md` 已把第五阶段明确表述为：

- 默认 experimental
- 默认关闭
- 先 operator / test-only

这是合适的产品策略。原因在于：

1. 当前实现到处都存在“单 active pack”假设；
2. 直接把 multi-pack 作为默认模型，会同时冲击 runtime、API、plugin runtime、projection 与前端语义；
3. 项目当前尚无真实使用者，更适合通过小范围试验用户反馈来成熟特性，而不是一次性转正。

### M2：确认当前系统对“单 active pack”依赖面很广

当前代码与文档中，以下位置都明确依赖 active-pack 语义：

- `docs/ARCH.md:281-289`
- `docs/API.md:18-21`
- `docs/API.md:150-152`
- `apps/server/src/core/simulation.ts`
- `apps/server/src/packs/runtime/projections/active_pack_projection_guard.ts`
- `apps/server/src/plugins/runtime.ts`
- `apps/server/src/inference/context_builder.ts`
- `apps/server/src/app/services/system.ts`

这些依赖至少包含：

- `SimulationManager.activePack`
- `context.sim.getActivePack()`
- `/api/status` 返回单个 `world_pack`
- pack projection route 强制 `PACK_ROUTE_ACTIVE_PACK_MISMATCH`
- plugin runtime 只读取当前 active pack
- inference context 默认从 active pack 解析 pack contract

这说明第五阶段不是局部改造，而是要重新定义：

- pack runtime host 是什么；
- request route scope 如何表达；
- operator status 是单 pack 还是多 pack；
- plugin / projection / inference context 怎样按 pack 隔离。

### M3：确认该能力接近 runtime container / registry 升级

从运行时模型看，当前 `SimulationManager` 持有：

- 一个 Prisma host
- 一个 clock
- 一个 activePack
- 一个 runtimeSpeed

若进入多 pack 同时运行，至少需要回答：

- 每个 pack 是否独立 clock？
- 每个 pack 是否独立 runtime speed？
- scheduler partition 是全局还是 pack-local？
- plugin runtime cache 如何按 pack 切分？
- projection / route context 是否需要 `(pack_id, …)` 作用域？

这已经不再是“activePack 改成数组”级别的改动，而更像：

> 在 server 内引入一个 multi-pack runtime registry/container 层。

因此，把它视为“实验性的 runtime container 能力”是准确的判断。

## 主要风险

### 1. API contract 被整体撬动

当前稳定 API 中，`/api/packs/:packId/overview` 与 `/api/packs/:packId/projections/timeline` 仍要求 packId 必须等于当前 active pack。若直接转为 multi-pack 默认模式，将立刻面临：

- 旧 contract 是否失效；
- `/api/status` 的 `world_pack` 单值是否改成数组；
- `PACK_ROUTE_ACTIVE_PACK_MISMATCH` 是否仍成立；
- 旧前端是否还能理解返回值。

### 2. Plugin runtime 隔离不足

当前 plugin runtime 明显是 active-pack-local。若多 pack 同时运行：

- manifest cache
- asset route
- panel mount
- route scope

都需要 pack-local 隔离。否则很容易出现 pack A/B 插件上下文串用。

### 3. Projection / read model scope 不清晰

当前 pack overview / timeline / inference context 都默认 active pack。multi-pack 模式下若 query scope 不先定义清楚，会导致：

- 读接口默认作用域混乱；
- operator 面板不知道自己在看哪个 pack；
- 前后端都出现隐式 pack selection。

### 4. 前端默认假设会被破坏

当前前端大概率仍把系统理解为“当前一个世界正在运行”。若后端先默认 multi-pack，会造成：

- 状态页语义漂移；
- 导航层缺少 pack selector；
- 当前页面组件全部带隐式单 pack 前提。

## 建议的保守方案

### 核心策略

把第五阶段定义为：

> **实验性 multi-pack runtime registry**

而不是：

> “默认把项目升级为多世界包运行平台”。

### 默认策略

- 默认关闭；
- 不修改当前 canonical 单 pack API；
- 只对 operator / test-only 用户开放；
- 明确不承诺稳定 contract。

### 推荐落地顺序

#### Phase 5A：只做 experimental runtime registry

先引入新的 runtime host 概念，例如：

- `PackRuntimeRegistry`
- `WorldPackRuntimeHandle`
- `PackRuntimeHost`

职责：

- load/unload/list pack runtime
- per-pack status / clock / scheduler snapshot
- 生命周期管理

注意：

- 不要直接把 `SimulationManager` 扩张成新的万能 app-service bucket；
- 单 pack 兼容 facade 仍可保留。

#### Phase 5B：只开放 experimental operator API

优先新增：

- `/api/experimental/runtime/packs`
- `/api/experimental/runtime/packs/:packId/status`
- `/api/experimental/runtime/packs/:packId/clock`
- `/api/experimental/runtime/packs/:packId/scheduler/*`

这样可以：

- 不污染当前稳定 API；
- 让实验用户显式知道自己正在使用实验功能；
- 先验证 runtime 隔离是否正确。

#### Phase 5C：再考虑 experimental 前端工作台

先做：

- pack runtime inspector
- pack selector
- 只读状态页

暂不改主导航和主业务工作区默认行为。

## 关键隔离要求

若未来进入第五阶段正式设计，必须优先梳理以下隔离面：

1. **pack clock 隔离**
   - 每个 pack 独立 `current_tick` / pause / runtime speed
2. **scheduler 隔离**
   - 调度单元至少要从 `partition_id` 升级为 `(pack_id, partition_id)`
3. **plugin runtime 隔离**
   - installation / manifest / web route / cache 必须 pack-local
4. **projection / query scope 隔离**
   - overview / timeline / scheduler / graph 查询必须显式 pack scope
5. **startup / health 隔离**
   - 区分 system health 与 per-pack runtime health

## 最终评估结论

第五阶段确实是一个“重构项目运行时模型”的重量级能力，不适合直接以稳定默认特性推进。当前最稳妥的策略是：

- **保持单 active pack 作为稳定模式**；
- **把多世界包同时运行列为 experimental**；
- **默认关闭**；
- **先 operator / test-only**；
- **先做 runtime registry 与实验性只读控制面，再决定是否扩展到主 API / 主 UI**。

这样既能保住当前第四阶段形成的稳定面，也能为未来真正的平台化、多 pack 容器化能力预留演进空间。

## 推荐下一步

建议下一步直接创建一份正式设计文档：

- `.limcode/design/experimental-multi-pack-runtime-registry-design.md`

内容应以“实验性、默认关闭、operator/test-only”为前提，重点描述：

- registry / runtime handle 模型
- pack-local clock / scheduler / plugin / projection 隔离
- experimental API 边界
- 与当前单 active-pack 稳定 contract 的兼容策略

## 评审摘要

- 当前状态: 进行中
- 已审模块: TODO.md, docs/ARCH.md, docs/API.md, apps/server/src/core/simulation.ts, apps/server/src/packs/runtime/projections/active_pack_projection_guard.ts, apps/server/src/plugins/runtime.ts, apps/server/src/inference/context_builder.ts, apps/server/src/app/services/system.ts
- 当前进度: 已记录 1 个里程碑；最新：M1
- 里程碑总数: 1
- 已完成里程碑: 1
- 问题总数: 0
- 问题严重级别分布: 高 0 / 中 0 / 低 0
- 最新结论: 第五阶段的正确方向不是默认多世界包化，而是默认关闭的 experimental multi-pack runtime registry。
- 下一步建议: 如果需要持久化为正式设计产物，应在非 review 模式下把本里程碑内容转写到 .limcode/design/experimental-multi-pack-runtime-registry-design.md。
- 总体结论: 待定

## 评审发现

<!-- no findings -->

## 评审里程碑

### M1 · 第五阶段正式设计草案：experimental multi-pack runtime registry

- 状态: 已完成
- 记录时间: 2026-04-18T09:22:28.540Z
- 已审模块: TODO.md, docs/ARCH.md, docs/API.md, apps/server/src/core/simulation.ts, apps/server/src/packs/runtime/projections/active_pack_projection_guard.ts, apps/server/src/plugins/runtime.ts, apps/server/src/inference/context_builder.ts, apps/server/src/app/services/system.ts
- 摘要:

  ## 设计定位

  第五阶段不应被定义为“默认多世界包运行”，而应被定义为：

  > **实验性 multi-pack runtime registry**

  其产品策略为：

  - 默认关闭；
  - 明确标记 `experimental`；
  - 先 operator / test-only；
  - 不承诺稳定 API contract；
  - 不改变当前单 active-pack 的默认稳定模式。

  ## 目标

  1. 在不破坏当前单 active-pack 稳定模式的前提下，引入一个可加载多个 pack runtime 的 registry；
  2. 为每个 pack 提供独立的 runtime handle，而不是继续依赖全局唯一 `activePack`；
  3. 先提供 experimental operator / debug / test-only 能力，再评估是否进入主 API / 主 UI；
  4. 明确多 pack 运行时的 pack-local 隔离边界：clock、scheduler、plugin runtime、projection、route context。

  ## 非目标

  1. 本阶段不把 multi-pack 设为默认运行模式；
  2. 本阶段不重写当前全部 canonical API；
  3. 本阶段不要求现有前端主导航与主工作区立即支持多 pack；
  4. 本阶段不把 `SimulationManager` 直接扩张成新的万能 app-service bucket；
  5. 本阶段不承诺 experimental API 在短期内保持完全稳定。

  ## 当前系统为什么不适合直接默认 multi-pack

  当前系统大量位置都依赖单 active-pack：

  - `SimulationManager.activePack` / `context.sim.getActivePack()`；
  - `/api/status` 返回单个 `world_pack`；
  - `/api/packs/:packId/overview` 与 `/api/packs/:packId/projections/timeline` 依赖 `PACK_ROUTE_ACTIVE_PACK_MISMATCH`；
  - plugin runtime 以当前 active pack 为 route scope；
  - inference context 默认从当前 active pack 解析 world pack contract；
  - operator 与 projection 层也大量通过 active pack 获取元信息。

  因此，第五阶段是一次**运行时模型升级**，而不是普通功能扩展。

  ## 核心设计结论

  ### 1. 引入新的 registry / handle 模型

  建议新增：

  - `PackRuntimeRegistry`
  - `PackRuntimeHandle`
  - `PackRuntimeHost`（命名可调整）

  职责建议：

  - `PackRuntimeRegistry`
    - 负责 load / unload / list / lookup
    - 负责管理当前已加载 pack runtime 集合
  - `PackRuntimeHandle`
    - 表示某个 pack 的运行时句柄
    - 对外暴露 pack-local clock / scheduler / projection / plugin runtime snapshot
  - `PackRuntimeHost`
    - 负责 pack runtime 生命周期、pack-local state、运行时依赖装配

  而当前 `SimulationManager` 更适合作为：

  - 单 pack 兼容 facade；
  - 或默认 active pack facade；
  - 不继续扩张为 multi-pack 全部能力的最终宿主。

  ### 2. pack-local 隔离必须先于 API 扩展

  至少必须明确以下隔离面：

  #### 2.1 Pack clock 隔离

  每个 pack 应拥有独立：

  - `current_tick`
  - `pause/resume`
  - `runtime speed`
  - `ChronosEngine`

  不能继续共享单一全局 active-pack clock。

  #### 2.2 Scheduler 隔离

  当前 partition 语义需要升级为：

  - `(pack_id, partition_id)` 才是完整调度单元

  意味着：

  - lease
  - cursor
  - worker ownership
  - rebalance recommendation
  - worker runtime state

  都需要支持 pack-local 作用域。

  #### 2.3 Plugin runtime 隔离

  必须隔离：

  - installation scope
  - manifest cache
  - web route namespace
  - asset route
  - route context

  否则不同 pack 的 plugin runtime 会互相污染。

  #### 2.4 Projection / query scope 隔离

  必须明确：

  - overview / timeline / scheduler / graph 查询默认作用域
  - operator 是否允许跨 pack 聚合
  - experimental API 是否一律要求显式 `packId`

  #### 2.5 Startup / health 隔离

  应拆分为：

  - system health
  - per-pack runtime health

  否则 `/api/status` 语义会混乱。

  ## 推荐的保守落地顺序

  ### Phase 5A：只做 experimental runtime registry

  首先只实现：

  - 加载 pack runtime
  - 卸载 pack runtime
  - 列出已加载 pack runtime
  - 查看每个 pack runtime 的 status / clock / scheduler 摘要

  此阶段不改 canonical API，不改主 UI。

  ### Phase 5B：只开放 experimental operator API

  建议新增实验接口，例如：

  - `GET /api/experimental/runtime/packs`
  - `POST /api/experimental/runtime/packs/:packId/load`
  - `POST /api/experimental/runtime/packs/:packId/unload`
  - `GET /api/experimental/runtime/packs/:packId/status`
  - `GET /api/experimental/runtime/packs/:packId/clock`
  - `GET /api/experimental/runtime/packs/:packId/scheduler/*`

  原则：

  - 不污染当前稳定 API；
  - 不替换 `/api/status` 的单 pack contract；
  - 只面向 operator / test-only。

  ### Phase 5C：experimental 只读工作台

  前端若要接入，也先做：

  - pack selector
  - runtime inspector
  - 只读状态页

  不立即改主业务页面与默认导航。

  ### Phase 5D：反馈后再决定是否转正

  只有在小范围试验、得到足够反馈后，再评估：

  - 是否保留 experimental；
  - 是否升级为 beta；
  - 是否开始影响 canonical API；
  - 是否进入主 UI。

  ## 推荐配置与开关

  建议至少新增：

  ```yaml
  features:
    experimental:
      multi_pack_runtime:
        enabled: false
        operator_api_enabled: false
        ui_enabled: false

  runtime:
    multi_pack:
      max_loaded_packs: 2
      start_mode: manual
      bootstrap_packs: []
  ```

  必要时还可增加：

  ```yaml
  scheduler:
    experimental_multi_pack:
      isolate_partitions_per_pack: true
      isolate_worker_state_per_pack: true
  ```

  ## 最终建议

  第五阶段应按如下原则推进：

  - **稳定模式仍是单 active pack**；
  - **multi-pack 只作为 experimental runtime registry**；
  - **默认关闭**；
  - **先 operator / test-only**；
  - **先验证 runtime 隔离，再决定是否扩展到主 API / 主 UI**。

  这既能保护当前第四阶段形成的稳定面，也能为未来真正的平台化 / 容器化运行时留下演进空间。
- 结论:

  第五阶段的正确方向不是默认多世界包化，而是默认关闭的 experimental multi-pack runtime registry。
- 下一步建议:

  如果需要持久化为正式设计产物，应在非 review 模式下把本里程碑内容转写到 .limcode/design/experimental-multi-pack-runtime-registry-design.md。

## 最终结论

第五阶段的正确方向不是默认多世界包化，而是默认关闭的 experimental multi-pack runtime registry。

## 评审快照

```json
{
  "formatVersion": 4,
  "kind": "limcode.review",
  "reviewRunId": "review-mo44ncmn-00a39f",
  "createdAt": "2026-04-18T00:00:00.000Z",
  "updatedAt": "2026-04-18T09:22:28.540Z",
  "finalizedAt": null,
  "status": "in_progress",
  "overallDecision": null,
  "header": {
    "title": "多世界包同时运行（实验性）设计评估",
    "date": "2026-04-18",
    "overview": "评估第五阶段多世界包同时运行为何应保持 experimental、默认关闭，并梳理主要改造面与保守落地路线。"
  },
  "scope": {
    "markdown": "# 多世界包同时运行（实验性）设计评估\n\n日期：2026-04-18\n\n## 概览\n\n本次评估针对 `TODO.md` 第五阶段“多世界包同时运行（默认 experimental / 默认关闭 / 先 operator / test-only）”展开，目标不是直接实现，而是判断该能力在当前项目中的改造重量、风险边界与保守落地方式。\n\n当前结论：\n\n- 将多世界包同时运行列为 **experimental feature** 是合理且必要的；\n- 该阶段本质上不是“加一个功能”，而是把当前单 active-pack 运行时提升为更接近 **runtime container / registry** 的系统能力；\n- 不应直接把现有稳定的单 active-pack contract 改成默认 multi-pack；\n- 应先以 **默认关闭 + operator / test-only + experimental API** 的方式验证。\n\n## 已审阅模块\n\n- `TODO.md`\n- `docs/ARCH.md`\n- `docs/API.md`\n- `apps/server/src/core/simulation.ts`\n- `apps/server/src/app/create_app.ts`\n- `apps/server/src/app/services/system.ts`\n- `apps/server/src/packs/runtime/projections/active_pack_projection_guard.ts`\n- `apps/server/src/plugins/runtime.ts`\n- `apps/server/src/inference/context_builder.ts`\n\n## 里程碑\n\n### M1：确认第五阶段应保持 experimental\n\n当前 `TODO.md` 已把第五阶段明确表述为：\n\n- 默认 experimental\n- 默认关闭\n- 先 operator / test-only\n\n这是合适的产品策略。原因在于：\n\n1. 当前实现到处都存在“单 active pack”假设；\n2. 直接把 multi-pack 作为默认模型，会同时冲击 runtime、API、plugin runtime、projection 与前端语义；\n3. 项目当前尚无真实使用者，更适合通过小范围试验用户反馈来成熟特性，而不是一次性转正。\n\n### M2：确认当前系统对“单 active pack”依赖面很广\n\n当前代码与文档中，以下位置都明确依赖 active-pack 语义：\n\n- `docs/ARCH.md:281-289`\n- `docs/API.md:18-21`\n- `docs/API.md:150-152`\n- `apps/server/src/core/simulation.ts`\n- `apps/server/src/packs/runtime/projections/active_pack_projection_guard.ts`\n- `apps/server/src/plugins/runtime.ts`\n- `apps/server/src/inference/context_builder.ts`\n- `apps/server/src/app/services/system.ts`\n\n这些依赖至少包含：\n\n- `SimulationManager.activePack`\n- `context.sim.getActivePack()`\n- `/api/status` 返回单个 `world_pack`\n- pack projection route 强制 `PACK_ROUTE_ACTIVE_PACK_MISMATCH`\n- plugin runtime 只读取当前 active pack\n- inference context 默认从 active pack 解析 pack contract\n\n这说明第五阶段不是局部改造，而是要重新定义：\n\n- pack runtime host 是什么；\n- request route scope 如何表达；\n- operator status 是单 pack 还是多 pack；\n- plugin / projection / inference context 怎样按 pack 隔离。\n\n### M3：确认该能力接近 runtime container / registry 升级\n\n从运行时模型看，当前 `SimulationManager` 持有：\n\n- 一个 Prisma host\n- 一个 clock\n- 一个 activePack\n- 一个 runtimeSpeed\n\n若进入多 pack 同时运行，至少需要回答：\n\n- 每个 pack 是否独立 clock？\n- 每个 pack 是否独立 runtime speed？\n- scheduler partition 是全局还是 pack-local？\n- plugin runtime cache 如何按 pack 切分？\n- projection / route context 是否需要 `(pack_id, …)` 作用域？\n\n这已经不再是“activePack 改成数组”级别的改动，而更像：\n\n> 在 server 内引入一个 multi-pack runtime registry/container 层。\n\n因此，把它视为“实验性的 runtime container 能力”是准确的判断。\n\n## 主要风险\n\n### 1. API contract 被整体撬动\n\n当前稳定 API 中，`/api/packs/:packId/overview` 与 `/api/packs/:packId/projections/timeline` 仍要求 packId 必须等于当前 active pack。若直接转为 multi-pack 默认模式，将立刻面临：\n\n- 旧 contract 是否失效；\n- `/api/status` 的 `world_pack` 单值是否改成数组；\n- `PACK_ROUTE_ACTIVE_PACK_MISMATCH` 是否仍成立；\n- 旧前端是否还能理解返回值。\n\n### 2. Plugin runtime 隔离不足\n\n当前 plugin runtime 明显是 active-pack-local。若多 pack 同时运行：\n\n- manifest cache\n- asset route\n- panel mount\n- route scope\n\n都需要 pack-local 隔离。否则很容易出现 pack A/B 插件上下文串用。\n\n### 3. Projection / read model scope 不清晰\n\n当前 pack overview / timeline / inference context 都默认 active pack。multi-pack 模式下若 query scope 不先定义清楚，会导致：\n\n- 读接口默认作用域混乱；\n- operator 面板不知道自己在看哪个 pack；\n- 前后端都出现隐式 pack selection。\n\n### 4. 前端默认假设会被破坏\n\n当前前端大概率仍把系统理解为“当前一个世界正在运行”。若后端先默认 multi-pack，会造成：\n\n- 状态页语义漂移；\n- 导航层缺少 pack selector；\n- 当前页面组件全部带隐式单 pack 前提。\n\n## 建议的保守方案\n\n### 核心策略\n\n把第五阶段定义为：\n\n> **实验性 multi-pack runtime registry**\n\n而不是：\n\n> “默认把项目升级为多世界包运行平台”。\n\n### 默认策略\n\n- 默认关闭；\n- 不修改当前 canonical 单 pack API；\n- 只对 operator / test-only 用户开放；\n- 明确不承诺稳定 contract。\n\n### 推荐落地顺序\n\n#### Phase 5A：只做 experimental runtime registry\n\n先引入新的 runtime host 概念，例如：\n\n- `PackRuntimeRegistry`\n- `WorldPackRuntimeHandle`\n- `PackRuntimeHost`\n\n职责：\n\n- load/unload/list pack runtime\n- per-pack status / clock / scheduler snapshot\n- 生命周期管理\n\n注意：\n\n- 不要直接把 `SimulationManager` 扩张成新的万能 app-service bucket；\n- 单 pack 兼容 facade 仍可保留。\n\n#### Phase 5B：只开放 experimental operator API\n\n优先新增：\n\n- `/api/experimental/runtime/packs`\n- `/api/experimental/runtime/packs/:packId/status`\n- `/api/experimental/runtime/packs/:packId/clock`\n- `/api/experimental/runtime/packs/:packId/scheduler/*`\n\n这样可以：\n\n- 不污染当前稳定 API；\n- 让实验用户显式知道自己正在使用实验功能；\n- 先验证 runtime 隔离是否正确。\n\n#### Phase 5C：再考虑 experimental 前端工作台\n\n先做：\n\n- pack runtime inspector\n- pack selector\n- 只读状态页\n\n暂不改主导航和主业务工作区默认行为。\n\n## 关键隔离要求\n\n若未来进入第五阶段正式设计，必须优先梳理以下隔离面：\n\n1. **pack clock 隔离**\n   - 每个 pack 独立 `current_tick` / pause / runtime speed\n2. **scheduler 隔离**\n   - 调度单元至少要从 `partition_id` 升级为 `(pack_id, partition_id)`\n3. **plugin runtime 隔离**\n   - installation / manifest / web route / cache 必须 pack-local\n4. **projection / query scope 隔离**\n   - overview / timeline / scheduler / graph 查询必须显式 pack scope\n5. **startup / health 隔离**\n   - 区分 system health 与 per-pack runtime health\n\n## 最终评估结论\n\n第五阶段确实是一个“重构项目运行时模型”的重量级能力，不适合直接以稳定默认特性推进。当前最稳妥的策略是：\n\n- **保持单 active pack 作为稳定模式**；\n- **把多世界包同时运行列为 experimental**；\n- **默认关闭**；\n- **先 operator / test-only**；\n- **先做 runtime registry 与实验性只读控制面，再决定是否扩展到主 API / 主 UI**。\n\n这样既能保住当前第四阶段形成的稳定面，也能为未来真正的平台化、多 pack 容器化能力预留演进空间。\n\n## 推荐下一步\n\n建议下一步直接创建一份正式设计文档：\n\n- `.limcode/design/experimental-multi-pack-runtime-registry-design.md`\n\n内容应以“实验性、默认关闭、operator/test-only”为前提，重点描述：\n\n- registry / runtime handle 模型\n- pack-local clock / scheduler / plugin / projection 隔离\n- experimental API 边界\n- 与当前单 active-pack 稳定 contract 的兼容策略"
  },
  "summary": {
    "latestConclusion": "第五阶段的正确方向不是默认多世界包化，而是默认关闭的 experimental multi-pack runtime registry。",
    "recommendedNextAction": "如果需要持久化为正式设计产物，应在非 review 模式下把本里程碑内容转写到 .limcode/design/experimental-multi-pack-runtime-registry-design.md。",
    "reviewedModules": [
      "TODO.md",
      "docs/ARCH.md",
      "docs/API.md",
      "apps/server/src/core/simulation.ts",
      "apps/server/src/packs/runtime/projections/active_pack_projection_guard.ts",
      "apps/server/src/plugins/runtime.ts",
      "apps/server/src/inference/context_builder.ts",
      "apps/server/src/app/services/system.ts"
    ]
  },
  "stats": {
    "totalMilestones": 1,
    "completedMilestones": 1,
    "totalFindings": 0,
    "severity": {
      "high": 0,
      "medium": 0,
      "low": 0
    }
  },
  "milestones": [
    {
      "id": "M1",
      "title": "第五阶段正式设计草案：experimental multi-pack runtime registry",
      "status": "completed",
      "recordedAt": "2026-04-18T09:22:28.540Z",
      "summaryMarkdown": "## 设计定位\n\n第五阶段不应被定义为“默认多世界包运行”，而应被定义为：\n\n> **实验性 multi-pack runtime registry**\n\n其产品策略为：\n\n- 默认关闭；\n- 明确标记 `experimental`；\n- 先 operator / test-only；\n- 不承诺稳定 API contract；\n- 不改变当前单 active-pack 的默认稳定模式。\n\n## 目标\n\n1. 在不破坏当前单 active-pack 稳定模式的前提下，引入一个可加载多个 pack runtime 的 registry；\n2. 为每个 pack 提供独立的 runtime handle，而不是继续依赖全局唯一 `activePack`；\n3. 先提供 experimental operator / debug / test-only 能力，再评估是否进入主 API / 主 UI；\n4. 明确多 pack 运行时的 pack-local 隔离边界：clock、scheduler、plugin runtime、projection、route context。\n\n## 非目标\n\n1. 本阶段不把 multi-pack 设为默认运行模式；\n2. 本阶段不重写当前全部 canonical API；\n3. 本阶段不要求现有前端主导航与主工作区立即支持多 pack；\n4. 本阶段不把 `SimulationManager` 直接扩张成新的万能 app-service bucket；\n5. 本阶段不承诺 experimental API 在短期内保持完全稳定。\n\n## 当前系统为什么不适合直接默认 multi-pack\n\n当前系统大量位置都依赖单 active-pack：\n\n- `SimulationManager.activePack` / `context.sim.getActivePack()`；\n- `/api/status` 返回单个 `world_pack`；\n- `/api/packs/:packId/overview` 与 `/api/packs/:packId/projections/timeline` 依赖 `PACK_ROUTE_ACTIVE_PACK_MISMATCH`；\n- plugin runtime 以当前 active pack 为 route scope；\n- inference context 默认从当前 active pack 解析 world pack contract；\n- operator 与 projection 层也大量通过 active pack 获取元信息。\n\n因此，第五阶段是一次**运行时模型升级**，而不是普通功能扩展。\n\n## 核心设计结论\n\n### 1. 引入新的 registry / handle 模型\n\n建议新增：\n\n- `PackRuntimeRegistry`\n- `PackRuntimeHandle`\n- `PackRuntimeHost`（命名可调整）\n\n职责建议：\n\n- `PackRuntimeRegistry`\n  - 负责 load / unload / list / lookup\n  - 负责管理当前已加载 pack runtime 集合\n- `PackRuntimeHandle`\n  - 表示某个 pack 的运行时句柄\n  - 对外暴露 pack-local clock / scheduler / projection / plugin runtime snapshot\n- `PackRuntimeHost`\n  - 负责 pack runtime 生命周期、pack-local state、运行时依赖装配\n\n而当前 `SimulationManager` 更适合作为：\n\n- 单 pack 兼容 facade；\n- 或默认 active pack facade；\n- 不继续扩张为 multi-pack 全部能力的最终宿主。\n\n### 2. pack-local 隔离必须先于 API 扩展\n\n至少必须明确以下隔离面：\n\n#### 2.1 Pack clock 隔离\n\n每个 pack 应拥有独立：\n\n- `current_tick`\n- `pause/resume`\n- `runtime speed`\n- `ChronosEngine`\n\n不能继续共享单一全局 active-pack clock。\n\n#### 2.2 Scheduler 隔离\n\n当前 partition 语义需要升级为：\n\n- `(pack_id, partition_id)` 才是完整调度单元\n\n意味着：\n\n- lease\n- cursor\n- worker ownership\n- rebalance recommendation\n- worker runtime state\n\n都需要支持 pack-local 作用域。\n\n#### 2.3 Plugin runtime 隔离\n\n必须隔离：\n\n- installation scope\n- manifest cache\n- web route namespace\n- asset route\n- route context\n\n否则不同 pack 的 plugin runtime 会互相污染。\n\n#### 2.4 Projection / query scope 隔离\n\n必须明确：\n\n- overview / timeline / scheduler / graph 查询默认作用域\n- operator 是否允许跨 pack 聚合\n- experimental API 是否一律要求显式 `packId`\n\n#### 2.5 Startup / health 隔离\n\n应拆分为：\n\n- system health\n- per-pack runtime health\n\n否则 `/api/status` 语义会混乱。\n\n## 推荐的保守落地顺序\n\n### Phase 5A：只做 experimental runtime registry\n\n首先只实现：\n\n- 加载 pack runtime\n- 卸载 pack runtime\n- 列出已加载 pack runtime\n- 查看每个 pack runtime 的 status / clock / scheduler 摘要\n\n此阶段不改 canonical API，不改主 UI。\n\n### Phase 5B：只开放 experimental operator API\n\n建议新增实验接口，例如：\n\n- `GET /api/experimental/runtime/packs`\n- `POST /api/experimental/runtime/packs/:packId/load`\n- `POST /api/experimental/runtime/packs/:packId/unload`\n- `GET /api/experimental/runtime/packs/:packId/status`\n- `GET /api/experimental/runtime/packs/:packId/clock`\n- `GET /api/experimental/runtime/packs/:packId/scheduler/*`\n\n原则：\n\n- 不污染当前稳定 API；\n- 不替换 `/api/status` 的单 pack contract；\n- 只面向 operator / test-only。\n\n### Phase 5C：experimental 只读工作台\n\n前端若要接入，也先做：\n\n- pack selector\n- runtime inspector\n- 只读状态页\n\n不立即改主业务页面与默认导航。\n\n### Phase 5D：反馈后再决定是否转正\n\n只有在小范围试验、得到足够反馈后，再评估：\n\n- 是否保留 experimental；\n- 是否升级为 beta；\n- 是否开始影响 canonical API；\n- 是否进入主 UI。\n\n## 推荐配置与开关\n\n建议至少新增：\n\n```yaml\nfeatures:\n  experimental:\n    multi_pack_runtime:\n      enabled: false\n      operator_api_enabled: false\n      ui_enabled: false\n\nruntime:\n  multi_pack:\n    max_loaded_packs: 2\n    start_mode: manual\n    bootstrap_packs: []\n```\n\n必要时还可增加：\n\n```yaml\nscheduler:\n  experimental_multi_pack:\n    isolate_partitions_per_pack: true\n    isolate_worker_state_per_pack: true\n```\n\n## 最终建议\n\n第五阶段应按如下原则推进：\n\n- **稳定模式仍是单 active pack**；\n- **multi-pack 只作为 experimental runtime registry**；\n- **默认关闭**；\n- **先 operator / test-only**；\n- **先验证 runtime 隔离，再决定是否扩展到主 API / 主 UI**。\n\n这既能保护当前第四阶段形成的稳定面，也能为未来真正的平台化 / 容器化运行时留下演进空间。",
      "conclusionMarkdown": "第五阶段的正确方向不是默认多世界包化，而是默认关闭的 experimental multi-pack runtime registry。",
      "evidence": [],
      "reviewedModules": [
        "TODO.md",
        "docs/ARCH.md",
        "docs/API.md",
        "apps/server/src/core/simulation.ts",
        "apps/server/src/packs/runtime/projections/active_pack_projection_guard.ts",
        "apps/server/src/plugins/runtime.ts",
        "apps/server/src/inference/context_builder.ts",
        "apps/server/src/app/services/system.ts"
      ],
      "recommendedNextAction": "如果需要持久化为正式设计产物，应在非 review 模式下把本里程碑内容转写到 .limcode/design/experimental-multi-pack-runtime-registry-design.md。",
      "findingIds": []
    }
  ],
  "findings": [],
  "render": {
    "rendererVersion": 4,
    "bodyHash": "sha256:404fbb259a3132b1d630ffbffd8a5144cfb258c872bffb39e50bd86a01ca78ce",
    "generatedAt": "2026-04-18T09:22:28.540Z",
    "locale": "zh-CN"
  }
}
```
