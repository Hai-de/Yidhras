<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/ai-registry-hot-reload.md","contentHash":"sha256:081785ac5c1aaa8dc82ca70f5318dfd9bee993d42f5fccd3ba4c73bf8574f860"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 修改 ai/registry.ts — 导出 BUILTIN_AI_REGISTRY_CONFIG, aiRegistryConfigSchema, promptSlotRegistrySchema  `#t1`
- [x] 新建 ai/registry_watcher.ts — 核心热加载逻辑（fs.watch + debounce + validate + reload）  `#t2`
- [x] 接入 index.ts — 启动 watcher + SIGINT/SIGTERM 清理  `#t3`
- [x] 更新 TODO.md — 标记注册表热加载完成  `#t4`
<!-- LIMCODE_TODO_LIST_END -->

# AI 注册表热加载 实施计划

## 设计来源

详见 `.limcode/design/ai-registry-hot-reload.md`

---

## 任务分解

### T1: 修改 `ai/registry.ts` — 导出 watcher 所需的内部符号

**文件**: `apps/server/src/ai/registry.ts`

**变更**:
1. 导出 `BUILTIN_PROMPT_SLOTS_PATH`（当前是 `private const`，改为 `export const`）
2. 导出 `aiRegistryConfigSchema` 和 `promptSlotRegistrySchema`（或提供校验辅助函数），使 watcher 可以独立执行 parse+merge 校验，而无需复制粘贴合并逻辑

**验收**: watcher 可以直接 `import { ... } from './registry.js'` 使用这些导出

---

### T2: 新建 `ai/registry_watcher.ts` — 核心热加载逻辑

**文件**: `apps/server/src/ai/registry_watcher.ts`（新建）

**实现**:

```ts
// 对外接口
export function startAiRegistryWatcher(options: {
  aiModelsConfigPath: string;
  promptSlotsDefaultPath: string;
}): { close(): void }
```

**内部结构**:
- `debounceTimers: Map<string, NodeJS.Timeout>` — 每个文件独立 debounce
- `scheduleReload(filePath)` — debounce 入口
- `validateAndReloadAiModels(filePath)` — 校验 ai_models.yaml → `resetAiRegistryCache()`
- `validateAndReloadPromptSlots(filePath)` — 校验 prompt_slots.yaml → `resetPromptSlotRegistryCache()`
- `extractErrorMessage(err)` — 格式化错误信息

**关键实现细节**:
1. `fs.watch(filePath, { persistent: false })` 监听每个文件
2. 事件触发时调 `scheduleReload(filePath)`，300ms debounce
3. 校验时用 try-catch 包裹，失败只 warn 不抛
4. 文件不存在时 `fs.watch` 会等文件创建后开始监听（不额外处理）
5. 返回 `{ close: () => watchers.forEach(w => w.close()) }`

**错误处理矩阵**（按设计文档 7）:

| 场景 | 行为 |
|------|------|
| 文件不存在 | fs.watch 等待创建 |
| YAML 语法错误 | warn + 保留旧缓存 |
| Zod schema 失败 | warn + 列出 ZodError issues + 保留旧缓存 |
| merge 后不合法 | warn + 保留旧缓存 |
| fs.watch 异常 | catch + warn |

**日志格式**（按设计文档 8）:
- 成功: `[ai_registry] {filename} 变更，重新加载成功`
- 失败: `[ai_registry] {filename} 校验失败，保留旧配置`
- 跳过: `[ai_registry] {filename} 不存在或为空，跳过热加载`

---

### T3: 接入 `index.ts` — 启动/停止 watcher

**文件**: `apps/server/src/index.ts`

**变更**:
1. 在文件顶部添加 `import { startAiRegistryWatcher } from './ai/registry_watcher.js'`
2. 在 `start()` 函数中，`app.listen(...)` 之后（或 runtime ready 之后），调用 `startAiRegistryWatcher()`
3. 注册进程退出清理:

```ts
const registryWatcher = startAiRegistryWatcher({
  aiModelsConfigPath: getAiModelsConfigPath(),
  promptSlotsDefaultPath: resolveWorkspacePath(
    'apps/server/src/ai/schemas/prompt_slots.default.yaml'
  ),
});

const cleanup = () => { registryWatcher.close(); };
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
```

**注意**: 需要在 `start()` 作用域内，且不与其他 `process.on` 冲突（当前 index.ts 没有注册 SIGINT/SIGTERM handler）

---

### T4: 更新 TODO.md — 标记完成

**文件**: `TODO.md`

将第 17 行 `- [ ] 注册表热加载...` 改为 `- [x] 注册表热加载...`

---

## 文件变更总览

| 文件 | 操作 | 规模 |
|------|------|------|
| `ai/registry.ts` | 修改（导出 2-3 个符号） | ~3 行 |
| `ai/registry_watcher.ts` | **新建** | ~100 行 |
| `index.ts` | 修改（import + 启动 + 清理） | ~15 行 |
| `TODO.md` | 标记完成 | 1 行 |

---

## 不涉及

- 不添加外部 npm 依赖
- 不修改 `config/loader.ts`、`config/runtime_config.ts`
- 不修改 inference 模块
- 不添加测试（手动验证，测试基础设施未就绪）
