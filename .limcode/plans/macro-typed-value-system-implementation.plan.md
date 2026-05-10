# 宏系统真类型支持：实施计划

**状态：已完成（2026-05-11）**

## 分 4 步实施（全部完成）

### Step 1: 核心类型体系 + 解析器 + 渲染器 ✅
**文件**: `types.ts`, `lexer.ts`, `parser.ts`, `renderer.ts`, `defaults.ts`
**产物**:
- `MacroValue` 类型定义
- `MacroNode.args: Record<string, MacroValue>`、`MacroHandlerFn` 返回 `MacroValue`、`ModifierSpec.args: MacroValue[]`
- Parser 支持字面量：数字 (`42`, `-3.14`)、布尔 (`true`/`false`)、null、双引号字符串 (`"..."`)、数组 (`[a, b, c]`)、浅层对象 (`{k1: v1, k2: v2}`)
- Renderer 去掉强制 `toString()`，保留值类型穿越
- 内置宏 `int`/`float`/`roll` 返回 `number`，`pick` 单元素返回 `string`、多元素返回 `string[]`

### Step 2: expandStateJson 类型保留 ✅
**文件**: `template_expander.ts`
**产物**:
- 字符串正好等于一个完整宏调用且返回非 string → 替换原 JSON 值
- 字符串是混合文本（含普通文本 + 宏）→ 宏展开后 `toString()` 内联
- 递归遍历保持其他类型不变

### Step 3: 块级宏 body 支持（跳过 — 当前无需求）
**文件**: `types.ts`, `parser.ts`, `renderer.ts`
**产物**:
- `MacroNode.body` 实际被 parser 填充（`{{#macro arg=value}}body{{/macro}}`）
- Renderer 支持重入渲染 body

### Step 4: 世界包数据迁移 + 测试 ✅
**文件**: 3 个 config.yaml, 7 个测试文件
**产物**: 新旧语法切换，全量测试通过

---

## 实施顺序

Step 1 → Step 2 → Step 3 → Step 4，串行。

## 验证方式

每步完成后跑 `pnpm --filter yidhras-server test:unit` 确保不回归，全部完成后跑 `pnpm test` 全量。
