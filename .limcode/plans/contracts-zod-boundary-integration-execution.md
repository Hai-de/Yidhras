## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [ ] 定义 contract/Zod 接入的验收标准、执行顺序与风险控制  `#plan-contracts-acceptance`
- [ ] 定义 contracts + Zod 接入范围、共享边界、非范围与原则  `#plan-contracts-scope`
- [ ] 列出 packages/contracts、后端 Zod helper、第一批路由接入、前端 contract 请求接入步骤  `#plan-contracts-steps`
<!-- LIMCODE_TODO_LIST_END -->

# Contracts + Zod 边界接入执行文档

## 目标

在 pnpm workspace 已建立的前提下，引入 `packages/contracts` 纯契约包，并在后端接入 Zod 作为 **HTTP/transport 边界校验层**，先覆盖“必须共享”的 contract 与第一批高价值路由。

本次任务遵循原则：**Zod 只负责边界，不负责业务规则**。

---

## 范围

### In Scope

- 新建 `packages/contracts`
- 在 `packages/contracts` 中定义纯契约 schema / types / helpers
- 引入：
  - `zod`
  - 后端使用 `zod-validation-error`
- 建立共享的基础 contract：
  - success/error envelope
  - `ApiSuccessMeta`
  - BigInt string 相关 scalar schema
- 第一批共享 route contract：
  - `system/status/health`
  - `clock`
  - `social`（至少 post 输入、feed query）
  - `inference`（至少 preview/run/jobs submit/retry/replay 的 request schema）
- 后端新增 Zod parse helper：
  - body
  - query
  - params
- 在第一批后端路由中用 schema 替换手工 `req.body as ...` / query 手搓解析
- 前端接入 contract：
  - 用共享 schema/types 组织请求入参
  - 接统一 client/envelope 类型
  - **不做响应运行时 parse**
- 必要的文档同步：
  - `README.md`（仅在命令/契约接入说明必要时）
  - `API.md`（接口输入契约变更或明确化时）
  - `TODO.md`（按里程碑视角补充前端契约层改造项）

### Out of Scope

- 不做 docs/ 目录迁移
- 不做前端 UI 重构
- 不做 response runtime validation（方案 A）
- 不将后端内部 domain / Prisma model 全量 schema 化
- 不在第一轮共享 graph/audit/overview 全量复杂 response schema
- 不引入 OpenAPI 自动生成
- 不引入 Prisma -> Zod 全量生成链路

---

## 原则

### 原则 1：Zod schema 是 transport / contract 层资产
Zod 用于：
- HTTP body/query/params 的 shape 校验
- 基础格式约束
- 共享 DTO 契约

Zod 不直接承载：
- 权限判断
- 状态机
- 数据库存在性
- 跨聚合业务规则

### 原则 2：共享 contract 优先服务 API 边界稳定
`packages/contracts` 第一轮只覆盖“必须共享”的 API 边界契约，不追求覆盖后端全部内部模型。

### 原则 3：BigInt over HTTP 一律是 string
- API 契约层禁止裸 `bigint`
- 前端默认保留 string
- 仅在明确需要数值比较/计算时显式 `BigInt(...)`

### 原则 4：`packages/contracts` 必须保持纯契约包
允许：
- zod schema
- exported types
- contract helper

不允许：
- Prisma client
- 后端 service
- Express/Nuxt 绑定逻辑
- 业务实现

---

## 第一批共享 contract 范围（固定）

### A. Shared scalar / envelope
- `ApiSuccessMeta`
- `ApiSuccess<T>`
- `ApiFailure`
- `ApiEnvelope<T>`
- `bigIntStringSchema`
- `nonNegativeBigIntStringSchema`

### B. Shared request / route contracts
#### system
- `/api/status` 相关 response type（可类型共享）
- `/api/health` body data shape（可类型共享）

#### clock
- `/api/clock`
- `/api/clock/formatted`
- `/api/clock/control` request
- `/api/runtime/speed` request

#### social
- `/api/social/post` request
- `/api/social/feed` query

#### inference（先请求侧）
- `/api/inference/preview` request
- `/api/inference/run` request
- `/api/inference/jobs` submit request
- `/api/inference/jobs/:id/retry` params（如需要）
- `/api/inference/jobs/:id/replay` request

### 暂不纳入第一批
- graph 全量复杂 schema
- audit detail 全量 schema
- overview 全量 response schema
- 内部 workflow snapshot 全链路 schema
- memory/inference 内部模型全量 schema

---

## 建议产物

### 1. `packages/contracts`
建议结构：

```text
packages/contracts/
  package.json
  tsconfig.json
  src/
    index.ts
    scalars.ts
    envelope.ts
    clock.ts
    system.ts
    social.ts
    inference.ts
```

### 2. 后端 Zod helper
建议新增一层 transport helper，例如放在：
- `apps/server/src/app/http/zod.ts`

提供能力：
- `parseBody(schema, req.body)`
- `parseQuery(schema, req.query)`
- `parseParams(schema, req.params)`
- 将 `ZodError` 统一转 `ApiError(400, ...)`
- 使用 `zod-validation-error` 生成可读 message

### 3. 前端 contract 请求接入
先补统一 API 基础设施，例如：
- `apps/web/.../api client`
- 使用共享 request types/schema 组织入参
- 使用共享 envelope type 帮助静态类型收敛
- 不做统一 response parse

---

## 后端接入顺序

### 第一批
1. `system` / `status` / `health`
2. `clock`
3. `social`

### 第二批
4. `identity`
5. `policy`

### 第三批
6. `inference`
7. `audit`
8. `graph`

说明：本次执行文档至少覆盖第一批，并为后续批次留下统一模式。

---

## 实施步骤

### Step 1：建立 contracts 包骨架
- 新建 `packages/contracts/package.json`
- 配置导出入口
- 建立基础 tsconfig
- 增加 envelope / scalar schema

### Step 2：定义第一批共享 schema
- `system.ts`
- `clock.ts`
- `social.ts`
- `inference.ts`

优先定义 request/query/params schema，与必要的 response types。

### Step 3：后端引入 Zod 基础设施
- 安装 `zod`
- 安装 `zod-validation-error`
- 新增统一 parse helper
- 新增 ZodError -> ApiError 转换约定

### Step 4：替换第一批路由手工解析
优先改：
- `apps/server/src/app/routes/system.ts`
- `apps/server/src/app/routes/clock.ts`
- `apps/server/src/app/routes/social.ts`

目标：
- 移除 `req.body as ...`
- 尽量减少分散的 query 手工解析
- 保留业务约束在 service 层

### Step 5：前端接入 contract 请求层
- 建立统一 request 入口/轻量 API client
- 修正 `apps/web/stores/clock.ts` 的旧 envelope 假设
- 使用共享类型/schema 组织请求参数
- BigInt string 规则显式写入消费逻辑

### Step 6：补充验证与文档
- 更新相关 E2E / smoke 断言（如入参错误包络有变化）
- `TODO.md` 中记录前端契约层改造目标
- `API.md` 中同步第一批接口输入契约说明

---

## 风险点

### 1. 把业务规则错误塞进 schema
需要严格区分：
- schema 校验 shape
- service 校验业务规则

### 2. contracts 包膨胀
如果不控制范围，容易把内部模型也塞进去，导致包失控。

### 3. 前端误用 response parse
本次明确采用方案 A：不做统一 response runtime validation，避免与现阶段目标冲突。

### 4. BigInt 处理失焦
如果前端开始无差别把所有 string tick 转为 `BigInt`，会引入不必要复杂度。

### 5. 一次改太多 route
应按批次推进，先打样 system/clock/social，再复制模式。

---

## 回滚点

建议将本任务拆为若干独立提交：
1. `packages/contracts` 骨架 + 基础 schema
2. 后端 Zod helper
3. 第一批 route 接入
4. 前端 contract 请求层接入

若失败，可按提交粒度回滚，而不影响 pnpm workspace 基线。

---

## 验收标准

### 必须满足
- `packages/contracts` 已创建，且仍是纯契约包
- 已存在共享 envelope / BigInt string schema
- 后端已存在统一 Zod parse helper
- 第一批路由已接入 schema：
  - system/status/health
  - clock
  - social
- 后端已使用 `zod-validation-error` 将 ZodError 转为稳定 4xx 错误
- 前端已完成最小 contract 请求层接入
- `apps/web/stores/clock.ts` 已修复旧 envelope 假设
- 未引入统一 response runtime validation

### 本次不要求
- 不要求 graph/audit/overview 全量 schema 化
- 不要求 docs 目录迁移
- 不要求前端 UI 重做

---

## 执行顺序建议

本任务应作为三条主线中的**第二条**执行：
1. pnpm / workspace 迁移
2. contracts + Zod 边界接入
3. docs 目录迁移与原则固化

并在内部继续按以下顺序推进：
1. contracts 骨架
2. 后端 parse helper
3. system/clock/social 打样
4. 前端最小接入
5. 再扩展到 identity/policy/inference 等后续批次
