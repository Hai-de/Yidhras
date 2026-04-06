## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 盘点 apps/server 现有测试脚本并按 unit / integration / e2e 分类  `#plan-audit-current-tests`
- [x] 分阶段把新测试体系接入 CI，同时保留现有 smoke 安全网  `#plan-ci-rollout`
- [x] 清理 apps/server/package.json 中碎片化 legacy test:* 入口  `#plan-clean-legacy-scripts`
- [x] 建立根级 vitest.workspace.ts 与 web/server 独立配置方案  `#plan-create-vitest-workspace`
- [x] 确定 apps/server/tests/helpers|fixtures|unit|integration|e2e 目录结构  `#plan-define-server-layout`
- [x] 抽离 server 共享 fixture、临时数据库、端口与 runtime helper  `#plan-extract-fixtures`
- [x] 制定并落实 unit / integration / e2e 的并发与隔离策略  `#plan-isolation-policy`
- [x] 优先迁移 3~5 个低风险 server 用例作为模板  `#plan-migrate-low-risk-tests`
<!-- LIMCODE_TODO_LIST_END -->

# 测试体系重构计划（Vitest 统一化，暂不引入 Bun）

## 1. 背景与决策

当前仓库的测试体系已经出现明显分化：

- `apps/web` 已经使用 `Vitest`，并具备一组 `tests/unit/*.spec.ts`。
- `apps/server` 则以 `tsx src/e2e/*.ts` 的独立脚本方式积累了大量测试入口。
- server 侧测试普遍手写 `assert`、`try/catch`、日志、进程启动与 teardown，导致：
  - 入口过多
  - 生命周期不统一
  - setup/teardown 重复
  - 执行与分组方式不清晰
  - CI 接入与失败定位成本上升

结合当前仓库事实：

- 根工作区使用 `pnpm workspace`
- CI 已基于 Node 20 + pnpm 运行
- server 依赖 `Prisma`、`sqlite3`、`child_process`、Node 运行时语义
- web 已经在使用 `Vitest`

本次重构的核心决策为：

1. **统一测试框架到 Vitest**
2. **保留 Node + pnpm 作为正式运行与 CI 基线**
3. **暂不将 Bun 引入为主测试运行时或包管理器**
4. **Bun 仅保留为未来可选 PoC，不纳入本轮重构主线**

---

## 2. 重构目标

### 2.1 主要目标

- 将 server 当前分散的脚本测试收编到统一 runner 下
- 建立清晰的测试分层：`unit / integration / e2e`
- 减少 `package.json` 中碎片化的 `test:*` 入口数量
- 复用并规范化共享 fixture / helper / runtime setup
- 提升本地运行、失败定位、CI 集成与后续扩展体验
- 在不大规模扰动现有业务代码的前提下完成渐进迁移

### 2.2 次要目标

- 为后续增加覆盖率统计、测试标签、按模块筛选运行打基础
- 为后续浏览器级 E2E（如 Playwright）预留空间，但本轮不引入

### 2.3 非目标

- 本轮**不**切换到 Bun 作为默认运行时
- 本轮**不**替换 pnpm
- 本轮**不**大规模重写全部测试逻辑，只做分阶段迁移
- 本轮**不**先追求覆盖率指标，优先解决结构性复杂度

---

## 3. 当前问题拆解

### 3.1 web 侧现状

- 已使用 Vitest
- 目录结构相对清晰：`apps/web/tests/unit`
- 说明团队已经接受 Vitest 的基础用法

### 3.2 server 侧现状

- 大量测试位于 `apps/server/src/e2e/*.ts`
- 通过 `package.json` 中大量 `test:*` 脚本一对一映射执行
- 每个文件自己处理断言、异常、退出码、日志
- 已存在共享 helper（如 server 启停、请求工具、runtime prepare），但仍未进入正式测试框架的 fixture 体系

### 3.3 结构性风险

- SQLite / Prisma / runtime 准备会带来资源竞争与状态串扰
- 独立脚本数量继续增长会放大维护成本
- 测试执行入口过多会削弱团队对测试体系的整体把控

---

## 4. 目标测试架构

## 4.1 分层原则

### unit

适用范围：

- 纯函数
- store / builder / parser / rules
- 不依赖真实数据库与真实服务进程的模块

要求：

- 默认并行
- 不接触真实外部资源
- 运行最快，作为日常开发主反馈层

### integration

适用范围：

- 服务层协作
- Prisma/SQLite 交互
- API handler / service / runtime 局部集成

要求：

- 控制并发
- 使用隔离数据库或临时 runtime 资源
- 允许较慢，但必须保证可重复

### e2e

适用范围：

- 起真实服务进程
- 打通关键业务链路
- smoke / scheduler / workflow 等全链路场景

要求：

- 默认串行或严格受控并发
- 独立端口 / 独立数据库 / 独立运行时目录
- 数量受控，强调业务关键路径而非穷举

---

## 4.2 推荐目录结构

```text
apps/
  server/
    tests/
      helpers/
      fixtures/
      unit/
      integration/
      e2e/
    vitest.config.ts
  web/
    tests/
      unit/
    vitest.config.ts
vitest.workspace.ts
```

说明：

- `apps/server/src/e2e/*.ts` 将逐步迁移到 `apps/server/tests/e2e/*.spec.ts`
- 共享能力从 `src/e2e/helpers.ts` 逐步抽离到 `apps/server/tests/helpers/*`
- web 与 server 各自保留独立 Vitest 配置
- 根目录新增 `vitest.workspace.ts`，统一工作区入口，但仍允许各应用独立执行

---

## 5. 重构阶段计划

## Phase 0：基线冻结与分组盘点

### 目标

先把现有测试资产分类，避免边迁边乱。

### 动作

- 列出现有 server `src/e2e/*.ts` 清单
- 按测试性质标记为：
  - 伪单测（其实不需要起服务）
  - integration
  - e2e
- 识别共享逻辑：
  - assert 工具
  - server 启停
  - HTTP 请求封装
  - runtime prepare
  - DB 清理逻辑
- 明确必须串行执行的测试集合

### 产出

- 一份测试分类表
- 一份共享 helper 清单
- 一份高风险测试清单（数据库锁、全局状态、端口占用）

---

## Phase 1：建立 Vitest 工作区骨架

### 目标

引入统一 runner，但先不大规模迁移用例。

### 动作

- 根目录增加 `vitest.workspace.ts`
- 为 `apps/server` 增加 `vitest.config.ts`
- 为 `apps/web` 显式增加或整理 `vitest.config.ts`
- 在 root / app 级 `package.json` 中定义统一测试入口：
  - `test`
  - `test:unit`
  - `test:integration`
  - `test:e2e`
  - `test:watch`
- 保留旧 server 脚本入口一段过渡期，但标记为 legacy

### 产出

- 工作区统一测试命令可执行
- web 与 server 能通过统一 runner 被调度

### 验收标准

- 开发者可从根目录运行统一测试命令
- 不破坏现有 web Vitest 用例
- server 可先接入空目录或最小示例用例

---

## Phase 2：迁移低风险 server 用例

### 目标

优先把最容易、最稳定、最能形成模板的 server 用例迁入 Vitest。

### 候选优先级

优先迁移：

- 不依赖起真实 HTTP 服务的测试
- 已有明确 helper、状态边界较清晰的测试
- 例如类似 `scheduler_lease` 这类更偏 service/runtime 行为验证的用例

暂后迁移：

- 体量很大、耦合链路很长的复杂流程用例
- 强依赖真实进程、真实 runtime 目录与共享 DB 的脚本
- 例如超长 scheduler 全链路场景

### 动作

- 将独立脚本改写为 `describe / it / beforeAll / afterAll`
- 将手写 `assert` 改为 `expect`
- 将 `try/catch + process.exitCode` 退出模式改为测试失败由 runner 接管
- 把重复 setup/teardown 抽出为 fixture

### 产出

- 第一批 server `integration` 或 `e2e` Vitest 用例
- 一份迁移模板文件，供后续复制使用

### 验收标准

- 至少有一批代表性 server 用例不再依赖 `tsx src/e2e/*.ts` 单独执行
- 失败日志能由 Vitest reporter 正常展示

---

## Phase 3：抽象共享测试基础设施

### 目标

把“脚本时代”的重复逻辑沉淀为可复用测试基础设施。

### 动作

抽离以下能力：

- `createTestDb()` / `createTempRuntime()`
- `startTestServer()` / `stopTestServer()`
- `requestJson()` / `assertJsonShape()`
- `prepareRuntimeOnce()`
- `cleanupDatabase()` / `seedScenario()`
- 专门的端口分配工具与临时目录工具

建议形成：

- `tests/helpers/`：轻量工具
- `tests/fixtures/`：生命周期与资源装配
- `tests/factories/`：构造测试数据

### 关键约束

- 不允许依赖默认共享数据库路径作为唯一运行方式
- 尽量将测试资源参数化，通过环境变量或 helper 注入
- 共享 helper 不应把测试耦死在单个场景上

### 验收标准

- 新增一个 server 测试时，不需要再复制整段脚本启动/清理代码
- 至少 2~3 个测试文件共享同一套 fixture/helper

---

## Phase 4：建立并发与隔离策略

### 目标

降低数据库锁、状态污染、端口冲突等不稳定因素。

### 规则

#### unit
- 默认并行

#### integration
- 受控并发
- 优先使用临时 SQLite 文件或按 worker 隔离的数据目录

#### e2e
- 默认串行
- 使用独立端口
- 使用独立数据库路径 / runtime 目录

### 动作

- 为 server 测试定义环境注入策略
- 为需要串行的套件设置单独 project 或 execution policy
- 把当前 helper 里的重试逻辑保留为兜底，而不是主稳定性来源

### 验收标准

- 数据库锁冲突显著下降
- 重跑稳定性提升
- e2e 用例不会因前一个用例残留资源而随机失败

---

## Phase 5：清理 legacy 脚本入口

### 目标

减少 `package.json` 中碎片化脚本，把统一入口变成主路径。

### 动作

- 删除或下线大部分 `test:*` 单文件脚本
- 将 legacy 脚本迁移状态记录到文档中
- 对确实需要保留的脚本改名为：
  - `manual:*`
  - `debug:*`
  - `ops:*`

### 验收标准

- `apps/server/package.json` 不再维护几十个测试入口
- 团队常用入口收敛到少数几个稳定命令

---

## Phase 6：CI 收口与回归保护

### 目标

在不扰动当前稳定基线的情况下，把新测试体系接入 CI。

### 动作

- 保留现有 `server-smoke.yml` 作为过渡期安全网
- 新增或扩展 CI 任务：
  - web unit
  - server unit
  - server integration
  - 关键 e2e / smoke
- 将最慢、最脆弱的套件放在后续阶段再并入默认 PR 检查

### 建议策略

- PR 默认跑：unit + 轻量 integration + smoke
- 夜间或手动任务跑：重型 e2e 全集

### 验收标准

- CI 输出能明确指出失败层级与失败文件
- 不因一次性纳入所有重型测试而导致 CI 垮掉

---

## 6. 包与脚本策略建议

## 根目录

建议收敛为：

- `pnpm test`
- `pnpm test:unit`
- `pnpm test:integration`
- `pnpm test:e2e`

内部通过 workspace filter 调度 web/server。

## apps/web

保留并规范：

- `test`
- `test:unit`
- `test:watch`

## apps/server

新增并规范：

- `test`
- `test:unit`
- `test:integration`
- `test:e2e`
- `test:watch`

legacy 单文件脚本只在迁移期保留。

---

## 7. Bun 的处理策略

### 本轮结论

**不正式引入 Bun。**

### 原因

- 当前主要痛点是测试组织与生命周期管理，而非 Node 启动速度
- server 依赖 Prisma、sqlite3、Node 进程语义，迁移收益不明显
- 当前 CI、workspace、包管理器都已围绕 Node + pnpm 建立
- 过早引入 Bun 会增加双运行时维护成本

### 可接受的后续动作

在主重构完成后，可做一个非常小的 PoC：

- 仅选择少量纯 unit test
- 不改 CI
- 不改正式命令
- 只比较本地体验与速度

如果没有显著收益，则不继续推进。

---

## 8. 风险与缓解

### 风险 1：迁移初期新旧体系并存，命令更乱

缓解：

- 在文档中明确 legacy 与 canonical 命令
- 设定清晰的下线时间点

### 风险 2：SQLite/Prisma 导致并发不稳定

缓解：

- 先把 e2e 串行化
- 引入临时数据库与临时 runtime 目录
- 逐步提升并发，而不是一开始全部并行

### 风险 3：复杂 server 场景迁移成本高

缓解：

- 先迁低风险用例建立模板
- 对超长场景采用“外包裹迁移”：先保留逻辑，先换 runner

### 风险 4：CI 时间膨胀

缓解：

- 按层级分批接入
- 重型场景延后纳入默认 PR 检查

---

## 9. 完成定义（Definition of Done）

满足以下条件即可视为本轮重构成功：

1. web 与 server 均在 Vitest 体系下有正式测试入口
2. server 至少一批核心测试已从 `tsx` 独立脚本迁入 Vitest
3. server 共享测试基础设施已抽离为 helper / fixture
4. `package.json` 中测试脚本显著收敛
5. CI 能按层级运行新测试体系
6. Bun 未进入主线依赖路径，Node + pnpm 仍是唯一正式基线

---

## 10. 推荐执行顺序

1. 盘点与分类
2. 建立 Vitest workspace 骨架
3. 迁移 3~5 个低风险 server 用例
4. 抽离 fixtures/helpers
5. 处理 DB/端口/运行时隔离
6. 批量迁移剩余 server 测试
7. 清理 legacy 脚本
8. CI 收口

---

## 11. 本计划的直接实施建议

如果下一步进入执行，建议第一批只做以下最小集合：

- 新建 `vitest.workspace.ts`
- 新建 `apps/server/vitest.config.ts`
- 整理 `apps/web/vitest.config.ts`
- 增加 root / server 统一测试脚本
- 迁移 1 个轻量 server 集成测试
- 迁移 1 个 server e2e 测试模板
- 抽出第一版 `tests/helpers`

这样可以在较低风险下拿到完整闭环，并为后续批量迁移建立模板。
