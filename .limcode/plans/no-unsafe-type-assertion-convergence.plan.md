<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/eslint-bypass-analysis.md","contentHash":"sha256:d6cf06535dffe73de431d8cb72044cff1bc56c0f4c151cd72fb72caf1a660fd4"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 确认 apps/server/eslint.config.mjs 中 src/**/*.ts 的 projectService 和 no-unsafe-* 规则实际启用状态：projectService=true，recommendedTypeChecked 启用 no-unsafe-assignment/member-access/call/return/argument，no-unsafe-type-assertion 显式 error  `#phase-7a-config-baseline`
- [x] 运行 eslint JSON 基线统计，记录 @typescript-eslint/no-unsafe-* 各规则数量和文件分布：当前 src/ 统计为 0  `#phase-7a-counts`
- [x] 优先处理 no-unsafe-assignment 与 no-unsafe-member-access 源头污染：当前基线为 0，暂无代码修改项  `#phase-7b-assignment-member-access`
- [x] 处理 no-unsafe-call、no-unsafe-argument、no-unsafe-return 链式剩余问题：当前基线为 0，暂无代码修改项  `#phase-7c-call-argument-return`
- [x] 处理 no-unsafe-enum-comparison、no-unsafe-unary-minus 及其他低频 no-unsafe 规则：当前基线为 0，暂无代码修改项  `#phase-7d-low-frequency`
- [x] 审计 src/**/*.ts 中所有 @typescript-eslint/no-unsafe-* eslint-disable 压制说明：共 502 处，发现并修复 1 处缺少 -- 原因说明的压制  `#phase-7e-disable-audit`
- [x] 运行 eslint src、typecheck、unit test、pnpm lint 完成固化验证：全部 exit 0；pnpm lint 仍有 726 个 warn，均为本阶段范围外 tests/scripts/builtin/web 既有警告  `#phase-7f-final-verify`
- [ ] 采集 tests/ 和 scripts/ warn→error 基线，区分显式质量规则 warning 与其他 warning  `#phase-8a-tests-scripts-baseline`
- [ ] 清理 tests/**/*.ts 中 @typescript-eslint/no-unused-vars 与 no-explicit-any warning  `#phase-8b-tests-unused-any`
- [ ] 分批清理 tests/**/*.ts 中 @typescript-eslint/no-non-null-assertion warning  `#phase-8c-tests-non-null`
- [ ] 复查 scripts/**/*.ts 显式质量规则 warning，并处理非质量类 security warning 的范围归属  `#phase-8d-scripts-scope`
- [ ] 将 tests/ 和 scripts/ 质量规则从 warn 升为 error  `#phase-8e-promote-config`
- [ ] 运行 eslint tests/scripts、typecheck、unit/integration/e2e 按影响面验证  `#phase-8f-tests-scripts-verify`
<!-- LIMCODE_TODO_LIST_END -->

# no-unsafe-type-assertion 渐进收敛计划

**日期**: 2026-05-24
**关联分析**: `.limcode/design/eslint-bypass-analysis.md` #7
**前置**: `.limcode/plans/eslint-coverage-and-enforcement.plan.md` 阶段 0-2 已全部完成

---

## 背景

`@typescript-eslint/no-unsafe-type-assertion` 试跑在 `src/` 下产生 **514 条警告**。按模式分布：

| 模式 | 数量 | 占比 | 修复难度 |
|------|------|------|---------|
| `as Record<string, unknown>` | ~70 | 14% | 中 |
| `as string` / `as number` / `as boolean` | ~60 | 12% | 低 |
| `from any` (从 any 类型断言) | ~30 | 6% | 高 |
| `as never` | ~19 | 4% | 低 |
| 领域特定类型（AppContext, SchedulerRow 等） | ~35 | 7% | 中 |
| 枚举/字面量联合窄化 | ~20 | 4% | 低 |
| 其他杂项窄化断言 | ~280 | 55% | 中 |

**历史状态**: 计划创建时 `@typescript-eslint/no-unsafe-type-assertion` 不在 `eslint.config.mjs` 中，试跑通过 CLI 临时覆盖完成。

**当前状态**: `apps/server/eslint.config.mjs` 已在 `src/**/*.ts` 启用 `projectService: true`；`recommendedTypeChecked` 已覆盖 `@typescript-eslint/no-unsafe-assignment`、`no-unsafe-member-access`、`no-unsafe-call`、`no-unsafe-return`、`no-unsafe-argument` 等 typed no-unsafe 规则；`@typescript-eslint/no-unsafe-type-assertion` 已在 `src/**/*.ts` rules 块中显式设为 `error`。后续工作应以实际 `pnpm --filter yidhras-server exec eslint src/` 输出为准，而不是沿用历史估算。

**核心原则**: 不追求一次性清零。按模式分批处理，每批完成后 lint 确认该模式数量归零。最后确保规则在配置中以 `error` 固化，且 `src/**/*.ts` 全量 lint 通过。

---

## 验证方法（全阶段统一）

基线验证以当前配置为准：

```bash
# 全量检查 src typed lint
pnpm --filter yidhras-server exec eslint src/

# no-unsafe-* 系列按规则统计
pnpm --filter yidhras-server exec eslint src/ --format json > /tmp/yidhras-eslint-src.json || true
node - <<'NODE'
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('/tmp/yidhras-eslint-src.json', 'utf8'));
const counts = {};
for (const file of data) {
  for (const message of file.messages) {
    if (message.ruleId?.startsWith('@typescript-eslint/no-unsafe-')) {
      counts[message.ruleId] = (counts[message.ruleId] ?? 0) + 1;
    }
  }
}
console.log(counts);
NODE

# 每个阶段完成后验证
pnpm typecheck
pnpm --filter yidhras-server test:unit
```

历史阶段 0-6 中提到的 `--rule '@typescript-eslint/no-unsafe-type-assertion: warn'` 仅作为局部回归调查手段保留；当前不应再依赖 CLI 临时规则覆盖判断最终状态。

此方法：
- 使用实际配置，能暴露 CI/开发环境真实 lint 状态
- 能按 `@typescript-eslint/no-unsafe-*` 规则维度统计剩余问题
- 各阶段可独立验证

---

## 阶段划分

### 阶段 0: 建立基础设施（~10 分钟）

**目标**: 创建 `boundaryCast` 工具和单元测试，为后续所有阶段提供统一的边界穿越入口。

**文件**:
- `apps/server/src/utils/type_guards.ts` — 新增
- `apps/server/tests/unit/type_guards.spec.ts` — 新增

```typescript
// src/utils/type_guards.ts

/** 运行时校验 value 是普通对象记录（非 null、非数组） */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 边界穿越：将 unknown 值断言为目标类型。
 * 仅用于系统边界不可消除的断言点（JSON.parse 返回值、Prisma JSON 列、外部 API 响应）。
 * 调用点不会被 no-unsafe-type-assertion 标记——断言集中在函数体内用 eslint-disable 管理。
 */
export function boundaryCast<T>(_value: unknown): T {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return _value as unknown as T;
}
```

**测试覆盖**:
- `isRecord`: 普通对象返回 true；null、数组、string、number 返回 false
- `boundaryCast`: 返回原始值引用（透传），泛型编译期正确

**验证**: `pnpm typecheck && pnpm --filter yidhras-server test:unit`

---

### 阶段 1: 原始类型断言替换（~60 条，最低难度）

**目标模式**: `as string`、`as number`、`as boolean`

**问题**: 代码使用 `x as string` 替代 `typeof x === 'string' ? x : defaultValue`，在运行时无保护。

**修复策略**: 逐个替换为运行时类型守卫：

| 断言 | 替换为 |
|------|--------|
| `x as string` | `typeof x === 'string' ? x : defaultString` |
| `x as number` | `typeof x === 'number' ? x : defaultNumber` |
| `x as boolean` | `typeof x === 'boolean' ? x : defaultBoolean` |

当上下文已通过类型守卫确保类型时（`if (typeof x === 'string') { x as string }`），直接移除断言。

**执行步骤**:
1. `grep -rn " as string\b" src/ --include="*.ts"` 列出全部
2. 按文件逐个替换，每个文件改完跑 `pnpm typecheck` 确认
3. 对 `as number` / `as boolean` 重复
4. 验证：CLI lint 确认这些模式归零

**涉及文件估计**: 40-50 个文件
**预计工作量**: 中等（模板化替换）

---

### 阶段 2: never 断言清理（~19 条，低难度）

**目标模式**: `as never`

**分类标准**（扩展后）:

| 类别 | 模式 | 处理方式 |
|------|------|---------|
| a) 穷尽检查 | `default: const _exhaustive: never = x` 或 `throw new Error(...)` | 加 `eslint-disable-next-line` 注释 |
| b) 类型压制 | `x as never as TargetType` | 替换为 `boundaryCast<TargetType>(x)` |
| c) 泛型约束 | `arr.reduce<T>((acc, item) => acc, [] as never[])` | 替换为 `[] as T[]` 或显式类型注解 |
| d) 函数返回占位 | `return undefined as never` (用于 stub) | 加 `eslint-disable-next-line` 注释 |

**执行步骤**:
1. `grep -rn "as never" src/ --include="*.ts"` 列出全部
2. 逐个分类为 a/b/c/d
3. a/d 类：加 `// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- exhaustive check`
4. b 类：替换为 `boundaryCast<T>(x)`
5. c 类：修复类型参数
6. 验证：CLI lint 确认 `as never` 全部消失或被 disable 覆盖

**涉及文件估计**: ~15 个文件
**预计工作量**: 低

---

### 阶段 3: Record<string, unknown> 断言系统化（~70 条，中等难度）

**目标模式**: `as Record<string, unknown>` 及其变体

**问题**: 最高频单一模式。数据跨越 JSON 边界、DB 列、动态属性访问时类型信息丢失。大部分使用是合法边界穿越。

**修复策略**:

对每个 `as Record<string, unknown>` 使用点分类处理：

| 上下文 | 处理方式 |
|--------|---------|
| JSON.parse / YAML.parse / 外部 API 返回值 | `boundaryCast<Record<string, unknown>>(x)` |
| Prisma JSON 列（`manifest_json` 等） | `boundaryCast<Record<string, unknown>>(x)` |
| 已有运行时守卫保护（`typeof x === 'object'`） | 保留断言并加 `eslint-disable-next-line` |
| `as unknown as Record<string, unknown>` 双断言 | 直接替换为 `boundaryCast<Record<string, unknown>>(x)` |

**执行步骤**:
1. `grep -rn "as Record<string, unknown>" src/ --include="*.ts"` 列出全部
2. 逐个文件判断上下文，应用对应策略
3. `grep -rn "as unknown as" src/ --include="*.ts"` 列出全部，替换为 `boundaryCast<T>(x)`
4. 验证：CLI lint 确认 `Record<string, unknown>` 警告全部消除或已 disable

**涉及文件估计**: 50-70 个文件
**预计工作量**: 中高

---

### 阶段 4: from-any 断言清理（~30 条，高难度）

**目标模式**: `assertion from 'any' detected`

**问题**: 断言源类型是 `any`，上游已丢失类型信息。修复需追溯到 `any` 源头。

**源头分类及策略**:

| 源头 | 策略 |
|------|------|
| `JSON.parse()` / `YAML.parse()` | 在解析点引入 Zod schema 或 `isRecord()` 守卫，消除 `any` |
| Prisma `manifest_json` 等动态列 | 使用 `boundaryCast<T>()` |
| 上游 `as any` 压制 | 修复上游类型压制 |
| 无类型声明第三方库 | 使用 `boundaryCast<T>()` 包装，加注释标注库名 |
| 不可追溯或遗留代码 | 加 `eslint-disable-next-line` 注释，标注 `-- from-any: dead-end, <原因>` |

**死胡同处理**: 当 `any` 源无法修复（无类型第三方库、遗留代码依赖链过长），使用带注释的 eslint-disable 而非强行重构引入风险。

**执行步骤**:
1. `pnpm --filter yidhras-server exec eslint --rule '@typescript-eslint/no-unsafe-type-assertion: warn' src/ 2>&1 | grep "from 'any'"` 列出全部
2. 按源头分类
3. 可修复的从源头修复；不可修复的加 disable 注释
4. 验证：from-any 警告归零

**涉及文件估计**: 25-30 个文件
**预计工作量**: 高（需追溯 any 来源）

---

### 阶段 5: 领域特定和杂项断言（~335 条，中等难度）

**目标模式**: 剩余所有 `no-unsafe-type-assertion` 警告

**子阶段拆分**:

#### 5a: 枚举/字面量联合窄化（~20 条，低难度）
- 模式: `as IdentityBindingStatus`、`as SomeEnum` 等
- 策略: Zod enum parse 或运行时值校验
- 涉及文件: ~15 个

#### 5b: 领域类型断言（~35 条，中难度）
- 模式: `as AppContext`、`as RawSchedulerRow`、`as SimulationManager` 等
- 策略: DB rows 和 sidecar transport 类使用 `boundaryCast<T>()`；Express `req` 扩展属性使用 `eslint-disable-next-line`（Express 类型系统的已知限制）
- 涉及文件: ~25 个

#### 5c: 类型窄化补充（~40 条，低难度）
- 模式: `as HTMLElement`、`as Error`、`as Date` 等内置类型窄化
- 策略: `instanceof` 检查或运行时守卫，无法守卫的加 disable 注释
- 涉及文件: ~30 个

#### 5d: 数组/泛型窄化（~50 条，中难度）
- 模式: `as string[]`、`as T[]`、`as Map<K,V>` 等泛型容器窄化
- 策略: `Array.isArray` + 元素类型守卫；泛型容器使用 `boundaryCast`
- 涉及文件: ~35 个

#### 5e: 杂项（~190 条，中难度）
- 其余未能归类到上述子模式的断言
- 策略: 逐案判断。优先级：运行时守卫 > `boundaryCast` > eslint-disable 注释
- 涉及文件: ~80 个

**执行步骤**:
1. 按子模式依次进行，每批完成后 CLI lint 验证
2. 每批 20-30 个文件
3. 5e（杂项）按目录分批：`ai/` → `domain/` → `app/` → `packs/` → 其他

**涉及文件估计**: 100+ 个文件
**预计工作量**: 中等（批量操作，模板化）

---

### 阶段 6: 收尾 — 将规则固化到配置

**前置条件**: 阶段 1-5 全部完成，CLI lint 零命中。

**执行步骤**:
1. `pnpm --filter yidhras-server exec eslint src/` 确认零错误
2. 确认 `apps/server/eslint.config.mjs` 的 `src/**/*.ts` rules 块中存在：
   ```js
   '@typescript-eslint/no-unsafe-type-assertion': 'error',
   ```
3. 确认 `recommendedTypeChecked` 仍只作用于 `src/**/*.ts`，且 `projectService: true` 未被移除
4. 在 AGENTS.md 中添加或校准该规则说明
5. 验证 `pnpm lint` 通过

---

### 阶段 7: 追加任务 — `@typescript-eslint/no-unsafe-*` 系列规则收敛

**目标规则**:

| 规则 | 典型问题 | 首选修复方式 |
|------|----------|--------------|
| `@typescript-eslint/no-unsafe-assignment` | `any` 赋值给具体类型或隐式污染局部变量 | 将源头改为 `unknown`，再用 schema/type guard 窄化 |
| `@typescript-eslint/no-unsafe-member-access` | 对 `any` 直接访问属性 | 在访问前用 `isRecord()`、Zod schema 或具体类型守卫收窄 |
| `@typescript-eslint/no-unsafe-call` | 调用 `any` 值 | 给函数来源补类型；不可补时用边界 wrapper 隔离 |
| `@typescript-eslint/no-unsafe-return` | 从函数返回 `any` | 修复返回表达式源头类型，或改函数返回 `unknown` 后在调用端窄化 |
| `@typescript-eslint/no-unsafe-argument` | 将 `any` 传给强类型参数 | 在调用点前窄化；或调整上游 API 返回类型 |
| `@typescript-eslint/no-unsafe-enum-comparison` | 枚举与非枚举值比较 | 统一比较双方类型，避免 string/enum 混比 |
| `@typescript-eslint/no-unsafe-unary-minus` | 对 `any` 使用一元负号 | 先用 `typeof value === 'number'` 窄化 |
| `@typescript-eslint/no-unsafe-type-assertion` | 已由阶段 0-6 覆盖 | 按阶段 0-6 策略处理 |

**当前配置事实**:
- `apps/server/eslint.config.mjs` 已通过 `...tseslint.configs.recommendedTypeChecked.map((rc) => ({ ...rc, files: ['src/**/*.ts'] }))` 启用 typed recommended 规则。
- `src/**/*.ts` 的 `languageOptions.parserOptions.projectService` 为 `true`。
- `tests/**/*.ts`、`scripts/**/*.ts` 的 `projectService` 为 `false`，不属于本阶段范围。
- `builtin/**/*.ts` 在 lint 脚本中被包含，但不属于当前 typed `src/**/*.ts` 收敛范围。

**基线采集**:

```bash
pnpm --filter yidhras-server exec eslint src/ --format json > /tmp/yidhras-eslint-src.json || true
node - <<'NODE'
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('/tmp/yidhras-eslint-src.json', 'utf8'));
const counts = new Map();
const files = new Map();
for (const result of data) {
  for (const message of result.messages) {
    if (!message.ruleId?.startsWith('@typescript-eslint/no-unsafe-')) continue;
    counts.set(message.ruleId, (counts.get(message.ruleId) ?? 0) + 1);
    if (!files.has(message.ruleId)) files.set(message.ruleId, new Set());
    files.get(message.ruleId).add(result.filePath);
  }
}
console.log('counts');
for (const [rule, count] of [...counts.entries()].sort()) {
  console.log(`${rule}: ${count}`);
}
console.log('files');
for (const [rule, fileSet] of [...files.entries()].sort()) {
  console.log(`${rule}: ${fileSet.size} files`);
}
NODE
```

**子阶段拆分**:

#### 7a: 基线确认和规则来源确认
- 运行 `pnpm --filter yidhras-server exec eslint --print-config src/index.ts`。
- 确认目标规则在 print-config 中为 error 或符合预期级别。
- 运行基线采集脚本，记录每条 `@typescript-eslint/no-unsafe-*` 的数量和涉及文件数。
- 若基线为零，记录“当前 src 无 no-unsafe-* 命中”，不做无意义代码改动。

#### 7b: assignment/member-access 优先处理
- 优先处理 `no-unsafe-assignment` 和 `no-unsafe-member-access`，因为这两类通常是后续 `call`、`argument`、`return` 的源头。
- 对 JSON/YAML/Prisma JSON/外部 API 边界：源头类型改为 `unknown`，用 Zod schema、`isRecord()` 或专用 type guard 收窄。
- 对局部变量污染：移除 `any` 中间变量，改为显式 `unknown` 或具体类型。
- 对确属不可验证的边界：封装到单点 wrapper，使用带原因的 eslint-disable，不在业务代码中散落压制。

#### 7c: call/argument/return 链式修复
- 在 7b 后重新 lint，避免修复已被源头修复连带消除的问题。
- `no-unsafe-call`: 给回调、插件入口、动态 registry 查询结果补充函数签名或 guard。
- `no-unsafe-argument`: 在传参前完成 schema parse/type guard，不允许直接 `as Target` 绕过。
- `no-unsafe-return`: 修复返回表达式来源；如果函数确实是边界读取函数，返回 `unknown` 或 schema parse 后的具体类型。

#### 7d: 低频 no-unsafe 规则扫尾
- 处理 `no-unsafe-enum-comparison`：统一 enum/string literal 的建模方式，避免混用。
- 处理 `no-unsafe-unary-minus`：先做 number 窄化再计算。
- 处理其他 `@typescript-eslint/no-unsafe-*` 新增命中：按“源头类型修复优先，边界封装次之，disable 最后”的顺序处理。

#### 7e: 压制审计
- 搜索所有 no-unsafe 系列压制：
  ```bash
  grep -R "eslint-disable.*@typescript-eslint/no-unsafe" -n src/ --include="*.ts"
  ```
- 每个压制必须带 `--` 后缀说明不可消除原因。
- 删除已失效压制；能通过 schema/type guard 消除的压制不得保留。
- 不新增裸 `eslint-disable-next-line @typescript-eslint/no-unsafe-*`。

#### 7f: 固化验证
- `pnpm --filter yidhras-server exec eslint src/` 必须通过。
- `pnpm typecheck` 必须通过。
- `pnpm --filter yidhras-server test:unit` 必须通过。
- `pnpm lint` 必须通过；若 tests/scripts/builtin 存在本阶段范围外问题，必须在提交说明中明确区分，不得混入 src no-unsafe 收敛结果。

**完成标准**:
- `src/**/*.ts` 中 `@typescript-eslint/no-unsafe-*` 系列规则零命中，或仅剩带具体原因、经过审计的必要压制。
- 新增或保留的边界转换集中在工具函数、schema parse 或边界 adapter 中，不在业务路径分散 `as any` / 双断言。
- `eslint.config.mjs` 中 `src/**/*.ts` typed lint 配置未被降级或绕开。

---

### 阶段 8: 追加任务 — tests/ 和 scripts/ 质量规则从 warn 升 error

**目标规则（当前在 tests/scripts 中为 warn）**:

| 规则 | tests 当前级别 | scripts 当前级别 | 本阶段目标 |
|------|----------------|------------------|------------|
| `prefer-const` | warn | warn | error |
| `simple-import-sort/imports` | warn | warn | error |
| `simple-import-sort/exports` | warn | warn | error |
| `@typescript-eslint/no-non-null-assertion` | warn | warn | error |
| `@typescript-eslint/no-explicit-any` | warn | warn | error |
| `@typescript-eslint/no-unused-vars` | warn | warn | error |

**当前基线（2026-05-24 采集）**:

命令：

```bash
pnpm --filter yidhras-server exec eslint tests/**/*.ts scripts/**/*.ts --format json > /tmp/yidhras-eslint-tests-scripts.json || true
```

显式质量规则 warning 统计：

| 区域 | 规则 | 数量 | 涉及文件数 |
|------|------|------|------------|
| tests | `@typescript-eslint/no-explicit-any` | 38 | 18 |
| tests | `@typescript-eslint/no-non-null-assertion` | 317 | 56 |
| tests | `@typescript-eslint/no-unused-vars` | 42 | 30 |
| scripts | 显式质量规则 | 0 | 0 |

未命中但仍需在升 error 前复查的规则：
- `prefer-const`
- `simple-import-sort/imports`
- `simple-import-sort/exports`

scripts 额外现状：`scripts/**/*.ts` 当前有 3 条 `security/detect-object-injection` warning，位于 `scripts/manual/permission_demo.ts`，该规则不是本阶段列出的“质量规则 warn→error”目标；除非单独扩展范围，否则不应混入本阶段修复。

**复杂度判断**:
- 总量 **397 条显式质量规则 warning**，全部在 tests 中。
- 主要复杂度来自 `@typescript-eslint/no-non-null-assertion`：317 条、56 个文件。多数测试断言可用 helper、局部 guard、`expect(value).toBeDefined()` 后的显式变量承接替代，但机械替换风险高，容易改变测试可读性或引入重复样板。
- `@typescript-eslint/no-unused-vars`：42 条、30 个文件，低到中等复杂度。多数可删除未使用 import/变量；少数可能是测试意图残留，需要确认是否应补断言而不是删除。
- `@typescript-eslint/no-explicit-any`：38 条、18 个文件，中等复杂度。测试中常见动态 mock、Prisma/Express/HTTP 响应对象、插件 host API。应优先用 `unknown`、`Record<string, unknown>`、局部测试类型、Vitest mock 类型替代；不应批量改成 `never` 或宽泛 `object` 规避。
- scripts 显式目标规则当前为 0，升 error 本身不复杂；但 scripts 仍有非目标 security warning，不能声称 scripts lint 全 warning 清零。

**结论**: 这是中等偏高复杂度任务，不适合一次性全仓机械替换。建议按规则和测试层级分批：先 unused-vars，再 explicit-any，最后 non-null assertion。`no-non-null-assertion` 是决定工作量的主项。

**子阶段拆分**:

#### 8a: 基线确认
- 运行 tests/scripts eslint JSON 统计脚本。
- 分别统计目标质量规则与非目标 warning。
- 确认 scripts 目标质量规则是否仍为 0。

#### 8b: tests unused-vars 与 explicit-any
- 先处理 `@typescript-eslint/no-unused-vars`，删除确实无用的 import/变量。
- 对疑似缺失断言的 unused 变量，补测试断言，不直接删除。
- 处理 `@typescript-eslint/no-explicit-any`：优先改为具体测试类型、`unknown` + guard、`Record<string, unknown>`、Vitest mock 类型。
- 每批 5-10 个文件，运行 `pnpm --filter yidhras-server exec eslint tests/**/*.ts` 和相关测试。

#### 8c: tests non-null assertion 分批清理
- 按测试目录分批：`tests/helpers/` → `tests/unit/` → `tests/integration/` → `tests/e2e/`。
- 替换策略优先级：
  1. 使用断言 helper 返回已窄化值，例如 `expectDefined(value)`。
  2. 在测试内使用 `if (value === undefined) throw new Error(...)` 后承接局部变量。
  3. 对数组索引使用显式长度断言后封装 helper 获取元素。
  4. 对 DOM/HTTP header/map 查询等边界值使用专用 helper。
- 不使用 `as NonNullable<T>` 批量绕过；这会把 non-null assertion 迁移成 unsafe assertion 风险。

#### 8d: scripts 范围复查
- 运行 `pnpm --filter yidhras-server exec eslint scripts/**/*.ts --format json`。
- 若目标质量规则仍为 0，只记录无需修改。
- `security/detect-object-injection` 当前 3 条 warning 不属于本阶段升 error 范围；若要处理，应另开安全规则任务。

#### 8e: 配置升 error
- 在 `apps/server/eslint.config.mjs` 的 tests rules 中将目标质量规则从 `warn` 改为 `error`。
- 在 scripts rules 中将目标质量规则从 `warn` 改为 `error`。
- 同步更新注释，移除“pre-existing violations exist”的过期说明。

#### 8f: 验证
- `pnpm --filter yidhras-server exec eslint tests/**/*.ts scripts/**/*.ts`
- `pnpm --filter yidhras-server test:unit`
- 涉及 integration/e2e helper 或流程测试时运行对应：
  - `pnpm --filter yidhras-server test:integration`
  - `pnpm --filter yidhras-server test:e2e`
- `pnpm lint`

**完成标准**:
- tests/scripts 中上述 6 条目标质量规则为 `error`。
- tests/scripts 中上述 6 条目标质量规则零命中。
- scripts 中非目标 security warning 若仍存在，必须在交付说明中明确为范围外。

---

## 执行优先级排序

```
阶段 0 (基础设施) ──→ 创建 boundaryCast + 测试
  ↓
阶段 1 (原始类型, ~60条) + 阶段 2 (as never, ~19条) ──→ 可并行
  ↓
阶段 3 (Record<string, unknown>, ~70条) ──→ 依赖阶段 0 的工具
  ↓
阶段 4 (from-any, ~30条) ──→ 依赖阶段 0 的工具
  ↓
阶段 5a → 5b → 5c → 5d → 5e (领域+杂项, ~335条) ──→ 分批扫尾
  ↓
阶段 6 (固化 no-unsafe-type-assertion 到配置)
  ↓
阶段 7a → 7b → 7c → 7d → 7e → 7f (`@typescript-eslint/no-unsafe-*` 系列收敛)
  ↓
阶段 8a → 8b → 8c → 8d → 8e → 8f (tests/scripts 质量规则 warn→error)
```

---

## 不在此计划内的项

- **builtin/ 目录 typed lint 收敛**：当前 `projectService` 未覆盖该目录。若要对 `builtin/**/*.ts` 启用 typed no-unsafe 系列规则，需要先处理 tsconfig/projectService 覆盖范围和内置插件编译边界。
- **scripts 中 `security/detect-object-injection` warning**：当前 3 条位于 `scripts/manual/permission_demo.ts`，不是本阶段质量规则 warn→error 的目标规则。
