# CalendarConfig 双轨类型统一重构

## 范围

- `apps/server/src/clock/types.ts` — `CalendarConfig` 和 `TimeUnit` 接口（手写）
- `apps/server/src/packs/schema/constitution_schema.ts` — `calendarConfigSchema` 和 `timeUnitSchema`（Zod）
- `apps/server/src/index.ts` — 第 213 行 `as unknown as CalendarConfig[]`
- `apps/server/src/core/pack_runtime_instance.ts` — 第 13 行 `as unknown as CalendarConfig[]`
- `apps/server/src/core/runtime_activation.ts` — 第 103 行 `as unknown as CalendarConfig[]`
- `apps/server/src/packs/snapshots/snapshot_restore.ts` — 第 370 行 `as unknown as CalendarConfig[]`
- `apps/server/src/packs/orchestration/pack_runtime_registry_service.ts` — 第 182 行 `as unknown as CalendarConfig[]`

不保留向后兼容。所有引用 `CalendarConfig` 和 `TimeUnit` 的模块同步修改。

---

## 一、问题诊断

### 1.1 同一概念，两套类型定义

**类型 A：手写 TypeScript 接口**

```typescript
// apps/server/src/clock/types.ts
export interface TimeUnit {
  name: string;
  ratio: number;                              // ← required
  irregular_ratios?: number[] | undefined;
}

export interface CalendarConfig {
  id: string;
  name: string;
  is_primary?: boolean | undefined;
  tick_rate: number;
  units: TimeUnit[];
}
```

**类型 B：Zod schema `z.infer<>` 推导**

```typescript
// apps/server/src/packs/schema/constitution_schema.ts
const timeUnitSchema = z.object({
  name: nonEmptyStringSchema,
  ratio: z.number().int().positive().optional(),           // ← optional
  irregular_ratios: z.array(z.number().int().positive()).optional()
}).strict().superRefine((value, ctx) => {
  if (value.ratio === undefined && value.irregular_ratios === undefined) {
    ctx.addIssue({ code: "custom", message: '...' });
  }
});

const calendarConfigSchema = z.object({
  id: nonEmptyStringSchema,
  name: nonEmptyStringSchema,
  is_primary: z.boolean().optional(),
  tick_rate: z.number().int().positive(),
  units: z.array(timeUnitSchema)
}).strict();
```

**`z.infer<typeof timeUnitSchema>` 推导出的类型**：

```typescript
{ name: string; ratio?: number | undefined; irregular_ratios?: number[] | undefined }
```

`ratio` 是 optional，因为 Zod schema 中声明为 `.optional()`。`superRefine` 在运行时保证至少存在 `ratio` 或 `irregular_ratios` 之一，但 TypeScript 无法从 `superRefine` 推导出此约束。

**`z.infer<typeof calendarConfigSchema>` 推导出的类型**：

```typescript
{ id: string; name: string; is_primary?: boolean; tick_rate: number;
  units: Array<{ name: string; ratio?: number; irregular_ratios?: number[] }> }
```

与 `CalendarConfig` 的区别：`units[].ratio` 是 `number | undefined` vs `number`。

### 1.2 五处同样的断言

所有取用 `pack.time_systems` 的地方都必须在同一个不兼容点上强行桥接：

```typescript
// 五个文件，完全相同的模式：
const calendars = (pack.time_systems ?? []) as unknown as CalendarConfig[];
```

`?? []` 处理了 `time_systems` 是 `optional` 的情况。`as unknown as CalendarConfig[]` 处理了 `ratio` optional vs required 的不兼容。

### 1.3 根本原因

没有单一事实来源。`CalendarConfig` / `TimeUnit` 的类型信息存在于两个独立位置：
1. `clock/types.ts`（手写 interface）
2. `constitution_schema.ts`（Zod schema，通过 `z.infer<>` 推导）

两个定义已经语义分歧：Zod schema 准确反映了"ratio 和 irregular_ratios 至少有一个"的业务规则，但 TypeScript 类型无法表达此约束。手写 interface 选择了简化——让 `ratio` 为 required——但付出了与 Zod schema 不兼容的代价。

---

## 二、目标架构

### 2.1 核心原则

1. **Zod schema 是类型的单一事实来源**——`CalendarConfig` 类型从 `calendarConfigSchema` 推导
2. **运行时验证决定类型**——经过 Zod 验证的数据使用 Zod 推导的类型，不另定义 interface
3. **消除手写类型的重复定义**——`clock/types.ts` 中的 `TimeUnit` 和 `CalendarConfig` 删除，改为从 schema 重新导出

### 2.2 方案：Zod schema 收窄 `TimeUnit` 类型

`timeUnitSchema` 的 `superRefine` 确保了 `ratio` 或 `irregular_ratios` 至少存在一个，但 TypeScript 无法表达此约束。我们改为用 Zod 的 `discriminatedUnion` 或接受 `ratio` 在类型层面为 optional：

```typescript
// apps/server/src/packs/schema/constitution_schema.ts

// 选项 1：接受 ratio 为 optional（与 Zod 定义一致）
// 好处：零断言，类型与 schema 完全同步
// 代价：消费方需要处理 ratio 可能为 undefined 的情况

// 选项 2：定义精确的 Zod 类型（branded type / z.output）
// 使用 .transform() 将验证后的数据转为具体类型

// 选项 3（推荐）：Zod schema 重定义为更精确的结构
```

### 2.3 推荐方案：统一到 Zod 推导类型

**步骤 A：从 schema 导出类型**

```typescript
// apps/server/src/packs/schema/constitution_schema.ts (新增导出)

// 直接从 schema 推导类型，不做手写 interface
export type CalendarConfigFromSchema = z.infer<typeof calendarConfigSchema>;
export type TimeUnitFromSchema = z.infer<typeof timeUnitSchema>;
```

**步骤 B：`clock/types.ts` 改为从 schema 重新导出**

```typescript
// apps/server/src/clock/types.ts

import type { calendarConfigSchema, timeUnitSchema } from '../packs/schema/constitution_schema.js';
import type { z } from 'zod';

// CalendarConfig 和 TimeUnit 从 Zod schema 推导，不再是独立定义
export type TimeUnit = z.infer<typeof timeUnitSchema>;
export type CalendarConfig = z.infer<typeof calendarConfigSchema>;

// TimeFormatted 保持不变（手写类型，来自运行时格式化输出，无对应 schema）
export interface TimeFormatted {
  calendar_id: string;
  calendar_name: string;
  display: string;
  units: Record<string, bigint | number>;
}
```

**步骤 C：处理 `ratio` 为 optional 的后果**

`TimeUnit.ratio` 从 `number`（required）变为 `number | undefined`（optional）。所有消费 `TimeUnit.ratio` 的代码需要处理 undefined 情况。审查消费方：

```bash
grep -rn "\.ratio" --include="*.ts" apps/server/src/clock/
grep -rn "TimeUnit" --include="*.ts" apps/server/src/
```

预期的消费方：
- `clock/` 下的时间计算逻辑（`tick_to_time` 等）——需要处理 `ratio === undefined`（使用 `irregular_ratios`）
- 序列化/格式化逻辑——需要处理
- API 路由——需要处理

这些消费方**本就应该**处理 `irregular_ratios` 的情况——当前代码如果遇到一个只有 `irregular_ratios` 没有 `ratio` 的合法时间单位配置，会因为 `ratio: undefined` 产生 `NaN` 而非报错。`required` 类型反而隐藏了这个运行时风险。

### 2.4 五个调用点的变更

**变更前**：

```typescript
const calendars = (pack.time_systems ?? []) as unknown as CalendarConfig[];
```

**变更后**：

```typescript
const calendars = pack.time_systems ?? [];
```

不再需要任何断言。`pack.time_systems` 的类型就是 `CalendarConfig[] | undefined`（因为 `CalendarConfig` 现在从同一个 Zod schema 推导）。

---

## 三、实施步骤

### 步骤 1：从 `constitution_schema.ts` 导出类型

在 `calendarConfigSchema` 和 `timeUnitSchema` 定义后添加显式类型导出：

```typescript
export type CalendarConfig = z.infer<typeof calendarConfigSchema>;
export type TimeUnit = z.infer<typeof timeUnitSchema>;
```

### 步骤 2：重写 `clock/types.ts`

将 `CalendarConfig` 和 `TimeUnit` 的定义替换为从 `constitution_schema.ts` 的重新导出。保留 `TimeFormatted`（无对应 schema）。

### 步骤 3：更新所有导入

`clock/types.ts` 现在是重新导出点。所有 `import { CalendarConfig, TimeUnit } from '../../clock/types.js'` 保持不变——导入路径不变，只是类型来源变了。

### 步骤 4：移除五处断言

逐个文件修改：

| 文件 | 变更 |
|------|------|
| `index.ts:213` | 移除 `as unknown as CalendarConfig[]`，保留 `?? []` |
| `core/pack_runtime_instance.ts:13` | 同上 |
| `core/runtime_activation.ts:103` | 同上 |
| `packs/snapshots/snapshot_restore.ts:370` | 同上 |
| `packs/orchestration/pack_runtime_registry_service.ts:182` | 同上 |

### 步骤 5：修复 `ratio` optional 导致的消费方差错

搜索所有访问 `TimeUnit.ratio` 的代码，确认它们处理了 `undefined` 情况。对于时间计算逻辑，`ratio === undefined` 时应使用 `irregular_ratios` 数组。当前代码可能已经处理了（因为 runtime 通过 Zod 验证，`superRefine` 保证至少一个存在），但类型层面从未强制。

### 步骤 6：类型检查与测试

```bash
pnpm typecheck
pnpm --filter yidhras-server test:unit -- clock
pnpm --filter yidhras-server test:integration
```

---

## 四、替代方案评估

### 方案 B：`CalendarConfig` 改为使用 `.transform()` 输出更精确的类型

```typescript
const calendarConfigSchema = z.object({
  // ...
  units: z.array(timeUnitSchema.transform(unit => ({
    ...unit,
    // transform 无法改变 z.infer<> 的输出类型
    // 此方案本质上不解决静态类型问题
  })))
});
```

评估：Zod 的 `.transform()` 会改变 `z.output<>` 类型但不改变 `z.infer<>` 类型。对于验证+使用的场景（我们的场景），`z.infer<>` 才是关键。因此 `.transform()` 不适合。

### 方案 C：创建 discriminated union 替代 superRefine

```typescript
const timeUnitSchema = z.discriminatedUnion('_type', [
  z.object({ name: ..., ratio: z.number(), _type: z.literal('regular') }),
  z.object({ name: ..., irregular_ratios: z.array(...), _type: z.literal('irregular') }),
]);
```

评估：给运行时数据添加了人工的 `_type` 鉴别字段。过于侵入性，与 YAML 配置格式冲突。不采用。

### 推荐方案确认

方案 A（统一到 Zod 推导类型）是唯一不需要修改运行时行为、不影响 YAML 配置格式、且消除所有断言的方案。`ratio` 变为 optional 是正确的类型表示——它本就可能不存在。

---

## 五、验证标准

```bash
# 五处 time_systems 断言全部清除
grep -rn "time_systems.*as unknown as CalendarConfig" apps/server/src/
# 预期：空

# CalendarConfig 只在一处定义（从 schema 重新导出不算重复定义）
# clock/types.ts 应为重新导出，constitution_schema.ts 为 schema 定义

# 类型检查通过
pnpm typecheck

# 时钟相关测试通过
pnpm --filter yidhras-server test:unit -- clock

# 时间格式化逻辑正确（手动验证：启动服务，查看时钟端点输出）
pnpm dev:server
# curl localhost:3001/api/clock → 验证格式化时间输出正确
```
