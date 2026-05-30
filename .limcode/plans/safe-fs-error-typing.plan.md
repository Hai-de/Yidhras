## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [ ] 创建 `SafeFsError` 类 — 继承 `AppError`，携带 fsOperation + targetPath `#SF-1`
- [ ] 重构 `safe_fs.ts` — path traversal → `SafeFsError`，fs 错误包装 cause `#SF-2`
- [ ] 适配调用方 — 需要区分 path traversal vs ENOENT 的 catch 点 `#SF-3`
- [ ] typecheck + unit + integration 全量验证 `#SF-4`
<!-- LIMCODE_TODO_LIST_END -->

# safe_fs 错误类型化

## 背景

`apps/server/src/utils/safe_fs.ts` 是文件系统操作的安全包装，主要功能是 path traversal 检测。当前所有错误都是 `new Error('[safe_fs] ...')`，调用方在 catch 中无法区分：

- **Path traversal 拒绝** — 安全事件，应记录 warn
- **ENOENT (文件不存在)** — 预期内的状态，无需告警
- **EACCES (权限拒绝)** — 配置问题，应记录 error
- **其他 I/O 错误** — 需排查

## 设计

### SF-1: SafeFsError 类

```typescript
import { AppError, ErrorCode } from './errors.js';

export class SafeFsError extends AppError {
  readonly fsOperation: string;
  readonly targetPath: string;

  constructor(
    code: typeof ErrorCode.PARSE_FAIL | typeof ErrorCode.STORAGE_QUERY_FAIL,
    message: string,
    fsOperation: string,
    targetPath: string,
    options?: { cause?: Error }
  ) {
    super(code, message, { cause: options?.cause, context: { fs_operation: fsOperation, target_path: targetPath } });
    this.name = 'SafeFsError';
    this.fsOperation = fsOperation;
    this.targetPath = targetPath;
  }
}
```

### SF-2: safe_fs 重构

- Path traversal 检测 → `throw new SafeFsError(ErrorCode.PARSE_FAIL, 'Path traversal rejected', 'resolve', resolvedPath)`
- 原生 fs 错误 → `throw new SafeFsError(ErrorCode.STORAGE_QUERY_FAIL, err.message, operation, filePath, { cause: err })`

### SF-3: 调用方适配

约 10-15 个调用点需要检查。大部分调用方只关心成功/失败，无需修改。少数需要区分错误类型的调用点改为 `if (err instanceof SafeFsError)` 模式。

## 影响范围

- 1 个文件重构（`safe_fs.ts`）
- 2-5 个调用点适配
