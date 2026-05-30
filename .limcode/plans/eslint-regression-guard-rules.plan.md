## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 添加 `no-console` 规则 — `CLI/**`、`init/**` 和 `utils/logger.ts` 除外 `#ER-1`
- [x] 添加 `no-empty` catch 检查 — 禁止完全空的 catch 块 `#ER-2`
- [x] 添加 `@typescript-eslint/only-throw-error` — 禁止 throw 原始值 `#ER-3`
- [x] 清理现有违规 — 修复 ESLint 新增规则触发的错误 `#ER-4`
- [x] typecheck + lint 全量验证 `#ER-5`
<!-- LIMCODE_TODO_LIST_END -->

# ESLint 回归防护规则

## 背景

错误日志基础设施重构已完成（见 `error-logging-infrastructure-refactoring.plan.md`）。当前没有 ESLint 规则防止开发者绕过 Logger 直接用 `console.log`，或写出新的空 `catch` 块。

## 目标

建立三个 ESLint 规则作为回归防护，确保：
1. 新代码不能直接使用 `console.*` — 强制使用结构化 Logger
2. 新代码不能有空 `catch` 块 — 每个 catch 至少记录 `captureError`
3. 新代码不能 `throw` 原始值 — 只能 throw `Error` 对象

## 规则详情

### ER-1: `no-console`

```javascript
rules: {
  'no-console': ['error', { allow: ['warn', 'error'] }],
}
```

**例外文件**（通过 `overrides` 配置）:
- `src/utils/logger.ts` — Logger 自身需要用 `console.*`
- `src/cli/**/*.ts` — CLI 工具输出就是用户界面

### ER-2: 禁止空 catch

```javascript
rules: {
  'no-empty': ['error', { allowEmptyCatch: false }],
}
```

位置要求：每个 catch 块至少包含一行代码。默认 `allowEmptyCatch: false`。

### ER-3: `@typescript-eslint/only-throw-error`

```javascript
rules: {
  '@typescript-eslint/only-throw-error': 'error',
}
```

禁止 `throw 'string'` 或 `throw undefined`。只允许 `throw new Error(...)` 或 `throw existingError`。

## 影响范围

预计 10-20 处违规需要手动修复，主要是 CLI 脚本中的 `console.log` 调用。

## 不纳入

- `no-warning-comments` — 代码中 "TODO" "FIXME" 注释已有 backlog 管理
- `@typescript-eslint/no-floating-promises` — 已启用
- 更严格的 `security/detect-*` 规则 — 已启用
