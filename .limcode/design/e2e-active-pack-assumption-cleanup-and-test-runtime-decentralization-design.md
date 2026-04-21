# E2E Active-Pack 假设清理与测试运行时去中心化设计

## 1. 背景

在完成 `death_note` 与宿主核心的文档边界收口、`rule_based` 去特判、以及 runtime 默认语义从 `death_note` 解耦之后，仓库中仍残留一类独立问题：

> **测试体系，尤其是 e2e 与测试辅助环境，仍然隐式假设 active pack 默认是 `death_note`。**

这类问题不再属于 world-pack contract 本身，也不属于核心 runtime 的业务语义边界，而是属于：

- 测试运行时辅助环境设计
- e2e 启动假设
- fixture / route / pack 选择约定
- bundled example 与 active pack 的测试建模方式

当前如果直接把测试辅助环境改为“中性 example_pack + bundled examples 并存”，会立刻撞上大量旧假设：

- 某些 e2e 直接访问 `/api/packs/world-death-note/...`
- 某些 e2e 要求 `/api/status` 中 `runtime_ready === true`
- 某些测试没有显式声明 active pack，却默认认为 active pack 就是 `death_note`
- 某些辅助环境只种入一个 `death_note` 目录，从而把“示例包存在”与“active pack 默认等于该包”混在一起

因此，这一问题需要单独设计治理，不能简单作为字符串替换来处理。

---

## 2. 核心问题定义

本轮要解决的问题不是“把所有 death_note 字样删掉”，而是：

### 2.1 隐式 active-pack 假设

测试当前存在隐式假设：

- 如果 world packs 目录里有 `death_note`
- 且没有显式指定 active pack
- 那么 active runtime 应自然指向 `death_note`

这个假设与“宿主不应默认偏向某个具体 world-pack”的目标冲突。

### 2.2 辅助环境职责混乱

`tests/helpers/runtime.ts` 当前承担了多个职责，但没有清晰分层：

- 创建 isolated workspace
- 提供 `WORLD_PACKS_DIR`
- 准备数据库
- 预热 runtime
- 种入示例包

问题在于：

- “种入哪些 pack”
- “默认 active pack 是谁”
- “某个测试需要哪个 active pack”

这三件事目前没有明确分离。

### 2.3 场景测试与框架测试混在一起

有些 e2e 本质上是：

- **框架级测试**：验证 endpoint、projection、runtime snapshot、plugin surface 是否工作

有些 e2e 本质上是：

- **场景级测试**：验证 `death_note` 题材下的 active-pack 读面、timeline、projection、plugin runtime 路由

但目前它们经常都共享：

- 同一种默认 active pack 假设
- 同一个 helper
- 同一种 world-pack 初始化方式

这使得测试结构无法清晰表达：

- 我是在测框架，还是在测特定参考包。

---

## 3. 目标

本设计的目标是：

1. 让测试辅助环境支持**显式选择 active pack**。
2. 让测试辅助环境支持同时存在：
   - 中性 `example_pack`
   - 参考包 `death_note`
3. 消除 e2e 对“active pack 默认等于 death_note”的隐式依赖。
4. 保留 `death_note` 作为场景测试参考包的能力。
5. 不要求本轮重写全部 e2e，只要求建立清晰、可迁移的测试运行时模式。

---

## 4. 非目标

本轮不直接追求：

1. 不把所有测试中的 `death_note` 字样全部替换掉。
2. 不把所有 e2e 都改造成 `example_pack`。
3. 不改动 `death_note` 包本身语义。
4. 不重构核心 runtime startup 语义。
5. 不处理所有 unit/integration fixture 的命名风格统一。

---

## 5. 设计原则

### 5.1 pack 存在 与 active pack 选择必须分离

测试环境必须明确区分：

- **seeded packs**：当前 workspace 中有哪些 pack 目录存在
- **preferred/active pack**：当前 server/runtime 启动时选中哪个 pack

不能再把：

- “目录里有 death_note”
- 与 “active pack 就是 death_note”

视为同一件事。

### 5.2 场景测试必须显式表达依赖

如果一个测试依赖 `death_note` 成为 active pack，则必须在测试配置中显式声明，而不是借 helper 默认行为隐式获得。

### 5.3 通用框架测试尽量使用中性 pack

对于主要测试：

- status
- startup
- projection framework
- scheduler / runtime loop
- plugin runtime infrastructure

若不依赖 `death_note` 特定语义，应逐步切换为：

- 使用 `example_pack`
- 或至少不依赖 `world-death-note` 路由常量

### 5.4 helper 只提供机制，不隐式表达题材立场

测试 helper 应提供：

- seed 哪些 pack
- active pack 选谁
- 是否 bootstrap

而不是默认表达：“当然就是 death_note”。

---

## 6. 设计方案

本轮拆成三个层次：

- **Layer A：测试 helper 去中心化**
- **Layer B：e2e active-pack 显式化**
- **Layer C：测试分层迁移策略**

---

## 6.1 Layer A：测试 helper 去中心化

### A1. 扩展 `createIsolatedRuntimeEnvironment` 的 pack seeding 模型

当前 helper 建议从“只 seed death_note”演进为：

- 默认支持 seed 多个 bundled/example packs
- 但是否启用由选项控制

建议新增配置概念：

```ts
interface CreateIsolatedRuntimeEnvironmentOptions {
  appEnv?: string;
  databaseFileName?: string;
  envOverrides?: Record<string, string>;
  seededPackRefs?: string[];
}
```

推荐语义：

- `seededPackRefs` 未指定时：
  - 默认 seed `['death_note']` 或 `['example_pack', 'death_note']` 需谨慎选择
- 更安全的推荐方式：
  - 调用方显式指定自己要的 packs

### A2. 提供更上层的 active-pack 选项

建议在 `withIsolatedTestServer` 或相关辅助入口中增加显式 active pack 选择能力，例如：

```ts
interface IsolatedTestServerOptions {
  activePackRef?: string;
  seededPackRefs?: string[];
}
```

辅助逻辑负责把它映射到：

- `WORLD_PACK=<activePackRef>`
- 或对应 runtime config override

这样测试不再需要自己到处手写：

- `envOverrides: { WORLD_PACK: 'death_note' }`

而是更语义化地写：

- `activePackRef: 'death_note'`

### A3. 让 helper 能表达“仅 seed，不设 active pack”

某些测试只关心：

- world packs 可用列表
- runtime registry
- experimental load/unload

这类测试可以：

- seed 多个 pack
- 不强制 active pack
- 或显式要求某个 active pack

这样就能把“active runtime”与“available packs”区分清楚。

---

## 6.2 Layer B：e2e active-pack 显式化

### B1. 识别依赖 active death_note 的 e2e 测试

建议将现有 e2e 按依赖类型分组：

#### Group 1：明确依赖 active `death_note`

例如：

- `/api/packs/world-death-note/projections/timeline`
- `trigger-event` 中直接断言 death_note 场景
- plugin runtime active pack route 直接使用 `world-death-note`

这类测试必须显式写明：

- `activePackRef: 'death_note'`

#### Group 2：只依赖“有 active pack”，不依赖 death_note

例如：

- `/api/status`
- `/api/overview/summary`
- scheduler status / startup status

这类测试应逐步改为：

- 使用 `example_pack`
- 或不写死 pack route id

#### Group 3：依赖多 pack 场景

例如：

- experimental runtime load/unload
- pack registry / operator API

这类测试应明确写：

- `seededPackRefs: ['example_pack', 'death_note']`
- `activePackRef: 'example_pack'` 或其它明确选择

### B2. 为 route 常量引入更清晰命名

当前很多测试有：

- `ACTIVE_PACK_ROUTE_NAME = 'world-death-note'`
- `PACK_ROUTE_NAME = 'world-death-note'`

建议分两类命名：

#### 场景测试

允许：

- `DEATH_NOTE_ACTIVE_PACK_ID`
- `DEATH_NOTE_PACK_REF`

#### 框架测试

改为：

- `ACTIVE_PACK_ID`
- `ACTIVE_PACK_REF`
- `EXAMPLE_PACK_ID`
- `EXAMPLE_PACK_REF`

这样可以避免所有“active pack”都默认被写成 death_note。

### B3. 统一“pack id”与“pack ref/dir”术语

测试里目前经常混用：

- `death_note`（目录名 / pack ref）
- `world-death-note`（metadata.id / pack id）

建议在测试命名中明确：

- `packRef = 'death_note'`
- `packId = 'world-death-note'`

这能降低很多测试维护时的混乱感。

---

## 6.3 Layer C：测试分层迁移策略

### C1. 先建立显式机制，再迁移测试

推荐顺序：

1. 先改 helper，支持：
   - `activePackRef`
   - `seededPackRefs`
2. 再改依赖最强的场景测试
3. 再逐步改通用框架测试

而不是先对大量测试做字符串替换。

### C2. 把 `death_note` 留在“场景测试层”

`death_note` 不需要从测试里完全消失。

更合理的定位是：

- 作为场景型测试 reference pack 保留
- 只是不再被误当成所有测试的默认 active pack

### C3. `example_pack` 用于“框架默认测试层”

`example_pack` 适合承担：

- startup smoke
- status / overview
- generic projection / generic runtime behavior
- 不依赖复杂 world semantics 的测试

---

## 7. 建议实施范围

## 第一批应修改

### helper / support

- `apps/server/tests/helpers/runtime.ts`

### e2e 中显式依赖 active death_note 的测试

优先处理：

- `apps/server/tests/e2e/world_pack_projection_endpoints.spec.ts`
- `apps/server/tests/e2e/trigger-event.spec.ts`
- `apps/server/tests/e2e/plugin-runtime-startup-gap.spec.ts`
- `apps/server/tests/e2e/plugin-runtime-web.spec.ts`
- `apps/server/tests/e2e/experimental-projection-compat.spec.ts`
- `apps/server/tests/e2e/experimental-runtime.spec.ts`

## 第二批可后续处理

### 通用 status/startup/scheduler 类测试

例如：

- `smoke-startup.spec.ts`
- `overview-summary.spec.ts`
- `scheduler-runtime-status.spec.ts`
- `scheduler-queries.spec.ts`
- `access-policy-contracts.spec.ts`

### unit / integration 中的命名技术债

例如：

- `available_world_packs: ['world-death-note']`
- fixture 中 `pack_id: 'world-death-note'`

这些可在下一轮统一迁移，不要求与 e2e helper 改造绑死。

---

## 8. 风险与缓解

## 风险 1：helper 改动后，大量 e2e 同时失效

缓解：

- 先引入兼容模式
- 先保持旧默认可用
- 逐个迁移显式 active-pack 测试

## 风险 2：`example_pack` 过于简单，无法支撑部分测试

缓解：

- 不强迫所有测试改成 `example_pack`
- 场景测试仍可继续使用 `death_note`

## 风险 3：`packRef` / `packId` 混用继续制造混乱

缓解：

- 在 helper API 和测试命名中统一术语
- 明确 `activePackRef` 与 `expectedPackId` 两个层次

---

## 9. 完成定义

本轮“测试运行时去中心化治理”完成时，应满足：

1. 测试 helper 能显式表达：
   - seed 哪些 pack
   - active pack 是谁
2. 场景测试不再依赖“death_note 被默认选中”的隐式行为。
3. 通用框架测试开始可迁移到中性 `example_pack`。
4. `death_note` 在测试中仍可作为 reference pack 存在，但不再承担默认 active pack 的角色。

---

## 10. 推荐后续动作

在本设计获确认后，建议下一步只做 **helper API 与第一批 e2e 显式 active-pack 改造**：

1. 扩展 `tests/helpers/runtime.ts`
2. 为 `withIsolatedTestServer` 引入 `activePackRef` / `seededPackRefs`
3. 迁移第一批强依赖 active death_note 的 e2e
4. 验证这些测试在显式 active-pack 模式下仍稳定通过

之后，再开下一轮处理：

- status/startup/scheduler 类通用测试的 `example_pack` 迁移
- unit / integration fixture 的命名去中心化
