# 消除多重 `as` 断言 — 总览

## 范围总表

| # | 设计文档 | 根因 | 断言数 | 涉及文件 | 可消除比例 |
|---|---------|------|--------|---------|-----------|
| 1 | `eliminate-multi-as-assertions-di-container.md` | `ServiceProvider.useFactory` deps 类型为 `Record<string, unknown>` | ~20 | 16 provider 文件 + provider.ts | 100% → 容器内部 1 处 `as any` |
| 2 | `eliminate-multi-as-assertions-world-engine-boundary.md` | `WorldEngineSessionContext` 五个数组类型为 `ReadonlyArray<Record<string, unknown>>` | ~14 | 合约层 1 文件 + 引擎层 2 文件 + 插件代理 1 文件 | 100%（内部路径）→ 插件边界的传输 schema 保留 `Record<string, unknown>` |
| 3 | `eliminate-multi-as-assertions-calendar-config.md` | Zod schema `ratio: optional` vs 手写 interface `ratio: required` 矛盾 | 5 | constitution_schema.ts + clock/types.ts + 5 个使用点 | 100% |
| 4 | `eliminate-multi-as-assertions-app-context-lie.md` | 函数签名接受窄类型 `AppInfrastructure`，实现需要宽类型 `AppContext`；Zod `.loose()`；`deepMerge` 泛型缺失 | ~6 | 投影层 1 文件 + 快照 1 文件 + 插件代理 1 文件 + AI 工具层 2 文件 | 100% |
| 5 | `eliminate-multi-as-assertions-json-parse-and-boundaries.md` | `JSON.parse` 返回 `any`（TS 标准库缺陷）；边车 IPC 缺少契约类型 | ~40 | ~30 文件（JSON.parse）+ 2 文件（边车） | JSON.parse: 收敛到工具函数（断言不消失但集中化）; 边车: 100% |

**合计**：~85 处多重/不安全断言，分布于 ~55 个文件。其中 ~70 处可彻底消除，~15 处（JSON.parse 收敛）集中到工具函数。

---

## 问题分类的本质

五个问题不是同等级别。按性质分为三层：

### 层一：类型架构缺陷（问题 1、2、3）

这些问题不是"某处缺了一个类型标注"——是**系统级的类型架构决策导致了断言在多个调用方扩散**。

- **DI 容器**（问题 1）：容器接口设计时选择了 `Record<string, unknown>` 作为 deps 类型，导致每个 provider（16 个文件）都需要断言。修复容器接口一处，16 个文件获益。
- **World Engine 边界**（问题 2）：合约类型选择了最低公分母 `Record<string, unknown>`，导致所有提供消费双方都需要断言。修复合约类型一处，10+ 处使用点获益。
- **CalendarConfig 双轨**（问题 3）：同一概念在两个位置独立定义，已经语义分歧。统一为单一事实来源，5 处断言消失。

### 层二：局部类型谎言（问题 4）

函数签名声明需要 X，实现需要 Y（Y extends X），通过断言弥合。每处独立，修复方式各不相同，但模式一致：**签名说谎，断言补漏**。

### 层三：语言/平台边界（问题 5）

`JSON.parse` 返回 `any` 是 TypeScript 标准库决定的，不是项目代码能改变的。`as unknown` 是行业标准防御实践。此类断言不是"问题"——它们是**TypeScript 的 JSON 处理中最安全的模式**。

边车 IPC 属于另一类：跨进程序列化的类型擦除不可避免，但可以通过 Zod schema 在序列化前后提供验证，将"断言"替换为"验证"。

---

## 实施顺序

按"收效最大、风险最低"排序：

```
Phase 1: CalendarConfig 统一（问题 3）
  ├─ 影响 5 个文件，每处删除一行代码
  ├─ 修改 constitution_schema.ts 导出类型 + clock/types.ts 重导出
  ├─ 运行时不变量：ratio 从 required → optional（正确反映现实）
  └─ 预估：1–2 小时

Phase 2: AppInfrastructure 签名修复（问题 4）
  ├─ 影响 4–5 个文件
  ├─ 每个修复独立，可逐个提交
  ├─ 无运行时行为变更
  └─ 预估：2–3 小时

Phase 3: DI 容器类型安全（问题 1）
  ├─ 影响 ~17 个文件，但变更是机械性的
  ├─ 按 deps 数量从少到多逐个迁移
  ├─ 无运行时行为变更
  └─ 预估：4–6 小时

Phase 4: World Engine 边界类型（问题 2）
  ├─ 影响 3–5 个文件
  ├─ 可能涉及 bigint→string 转换逻辑
  ├─ 合约层变更影响插件 API（需审查插件实现）
  └─ 预估：3–5 小时

Phase 5: JSON.parse + 边车 IPC（问题 5）
  ├─ JSON.parse 收敛：创建工具函数 + 逐步替换（可选）
  ├─ 边车 IPC：为每个边车方法定义 Zod 契约
  ├─ 边车变更风险较高（涉及 Rust 端响应结构审查）
  └─ 预估：4–8 小时（取决于边车审查深度）
```

---

## 不变量的守护

所有重构必须满足：

1. **`pnpm typecheck` 零错误**——每个 phase 结束后验证
2. **现有测试不退化**——`pnpm test:unit` 和 `pnpm test:integration` 在每个 phase 后通过
3. **服务器可正常启动**——`pnpm dev:server` 无启动错误
4. **运行时行为不变**——除类型定义外，不改变任何运行时逻辑（除非原断言遮盖了 bug）

### 特别警告

- **Phase 3（DI 容器）**：`ServiceContainer.resolve()` 内部的 `deps as any` 无法消除——这是所有 TypeScript DI 容器的固有局限。这是容器内部实现细节，不会扩散到 provider 文件。
- **Phase 1（CalendarConfig）**：`TimeUnit.ratio` 变为 `number | undefined` 后，所有消费 `ratio` 的代码需要处理 undefined。当前的 `required` 类型可能遮盖了 `irregular_ratios` 路径的 bug（当 `ratio` 缺失时产生 `NaN` 而非报错）。
- **Phase 4（World Engine）**：合约类型从 `ReadonlyArray<Record<string, unknown>>` 改为具体 snapshot 类型后，插件代码中的 `StepContributor` 实现需要同步更新类型签名。如果插件代码不在本仓库中（外部插件），需要提供过渡期。

---

## 各文档路径

- [DI 容器](./eliminate-multi-as-assertions-di-container.md)
- [World Engine 边界](./eliminate-multi-as-assertions-world-engine-boundary.md)
- [CalendarConfig 双轨统一](./eliminate-multi-as-assertions-calendar-config.md)
- [AppInfrastructure → AppContext 签名谎言](./eliminate-multi-as-assertions-app-context-lie.md)
- [JSON.parse / 边车 IPC / 存储边界](./eliminate-multi-as-assertions-json-parse-and-boundaries.md)
