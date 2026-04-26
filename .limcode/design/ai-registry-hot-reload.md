# AI 注册表热加载

## 现状

`ai/registry.ts` 中有两层缓存：

| 缓存 | 变量 | reset 函数 | 数据来源 |
|------|------|-----------|---------|
| AI 注册表 | `aiRegistryCache` | `resetAiRegistryCache()` | `BUILTIN_AI_REGISTRY_CONFIG` + `ai_models.yaml` 覆盖 |
| Prompt Slot 注册表 | `promptSlotRegistryCache` | `resetPromptSlotRegistryCache()` | `prompt_slots.default.yaml` + `prompt_slots.yaml` 覆盖 |

两者均采用 `let cache: T | null = null` 懒加载模式，首次调用 `get*()` 时加载，之后直接返回缓存值。`reset*()` 将缓存置 null，下次访问自动重新加载。

**问题**：`reset*()` 函数已导出，但项目中无任何代码调用它们。修改 YAML 配置后必须重启服务才能生效。

## 目标

- 监听 `ai_models.yaml` 和 `prompt_slots.yaml` 文件变更
- 变更时校验新配置合法性，合法则自动重载缓存
- 校验失败时保留旧缓存，log warning，不中断运行中的服务
- 零外部依赖（使用 Node.js 内置 `fs.watch`）

---

## 设计

### 1. 新建文件：`apps/server/src/ai/registry_watcher.ts`

单一职责：启动/停止对 AI 注册表相关 YAML 文件的监听。

```
registry_watcher.ts
├── startAiRegistryWatcher(paths, options) → { close(): void }
│   ├── 对每个文件建立 fs.watch
│   ├── 变化时 debounce 300ms
│   ├── 尝试 parse + merge（验证合法性）
│   ├── 合法 → resetCache() + console.log
│   └── 不合法 → console.warn + 保留旧缓存
└── (内部) debounce + validateAndReload
```

### 2. 监听的文件

| 文件 | 路径来源 | 触发 reset |
|------|---------|-----------|
| `ai_models.yaml` | `getAiModelsConfigPath()` | `resetAiRegistryCache()` |
| `prompt_slots.yaml` | `getAiModelsConfigPath().replace('ai_models.yaml', 'prompt_slots.yaml')` | `resetPromptSlotRegistryCache()` |

不监听内置默认文件（`BUILTIN_PROMPT_SLOTS_PATH`），因为它在源码目录中，正常运行时不会修改。

### 3. 核心流程

```
fs.watch 事件触发
    │
    ▼
debounce 300ms（合并编辑器连续写入）
    │
    ▼
readYamlFileIfExists(path)  →  空文件？跳过
    │
    ▼
zod parse + merge with builtin  →  parse 失败？
    │                                      │
    ▼                                      ▼
resetCache()                        console.warn + 保留旧缓存
console.log('[ai_registry] ...')
```

### 4. 校验策略

**关键原则：先校验，后重置。** 如果新配置文件 parse 失败（YAML 语法错误、schema 不匹配），绝不清理旧缓存。运行中的服务继续使用最后一次合法的配置。

校验逻辑复用现有函数：

```
ai_models.yaml 变更:
  1. readYamlFileIfExists(path) → rawConfig
  2. aiRegistryConfigSchema.parse({ version: ..., ...rawConfig }) → parsedOverride
  3. mergeAiRegistryConfig(BUILTIN_AI_REGISTRY_CONFIG, parsedOverride) → 验证合并结果
  4. 全通过 → resetAiRegistryCache()

prompt_slots.yaml 变更:
  1. readYamlFileIfExists(path) → rawOverride
  2. readYamlFileIfExists(defaultPath) → rawDefault
  3. promptSlotRegistrySchema.parse(rawDefault) → defaultParsed
  4. promptSlotRegistrySchema.parse(deepMerge(defaultParsed, rawOverride)) → merged
  5. 全通过 → resetPromptSlotRegistryCache()
```

### 5. Debounce 设计

编辑器保存文件时通常触发多次 `fs.watch` 事件（rename → change）。使用 300ms debounce：

```ts
let timer: NodeJS.Timeout | null = null;
const scheduleReload = (filePath: string) => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    validateAndReload(filePath);
  }, 300);
};
```

如果 300ms 内同一文件再次变化，重置计时器。不同文件应独立 debounce（用 Map<filePath, timer>）。

**修正**：由于 `fs.watch` 在某些系统上对单次保存触发多次事件，且 `ai_models.yaml` 和 `prompt_slots.yaml` 是不同的文件，每个文件应有独立的 debounce timer。

### 6. 接入点

在 `apps/server/src/index.ts` 的 `start()` 函数中，app 启动后启动 watcher；进程退出时关闭。

```ts
// index.ts start() 函数末尾
import { startAiRegistryWatcher } from './ai/registry_watcher.js';

// ... 现有初始化代码 ...

const registryWatcher = startAiRegistryWatcher({
  aiModelsConfigPath: getAiModelsConfigPath(),
  promptSlotsDefaultPath: `${resolveWorkspaceRoot()}/${BUILTIN_PROMPT_SLOTS_PATH}`,
});

process.on('SIGINT', () => { registryWatcher.close(); });
process.on('SIGTERM', () => { registryWatcher.close(); });
```

### 7. 错误处理

| 场景 | 行为 |
|------|------|
| 监听的文件不存在 | `fs.watch` 在文件创建后开始触发事件；初始化时 warn，不阻塞 |
| YAML 语法错误 | `YAML.parse` 抛错 → warn + 保留旧缓存 |
| Zod schema 校验失败 | `ZodError` → warn + 列出校验错误详情 + 保留旧缓存 |
| 合并后结果不合法 | merge 后 zod parse → warn + 保留旧缓存 |
| fs.watch 自身异常 | catch + warn（不 crash 服务） |

### 8. 日志输出

成功热加载：
```
[ai_registry] ai_models.yaml 变更，重新加载成功
  providers: 1
  models: 3
  routes: 4
```

校验失败：
```
[ai_registry] ai_models.yaml 校验失败，保留旧配置
  error: YAML parse error at line 5: unexpected end of mapping
```

文件不存在跳过：
```
[ai_registry] prompt_slots.yaml 不存在或为空，跳过热加载
```

---

## 实现清单

- [ ] 新建 `apps/server/src/ai/registry_watcher.ts`
  - [ ] `startAiRegistryWatcher()` 函数
  - [ ] `validateAndReload()` 私有逻辑
  - [ ] 每个文件独立 debounce
  - [ ] 错误处理 + 日志
- [ ] 修改 `apps/server/src/ai/registry.ts`
  - [ ] 导出 `BUILTIN_PROMPT_SLOTS_PATH`（供 watcher 使用）
  - [ ] 导出 `loadPromptSlotRegistry` 或提供 `validatePromptSlotOverride()` 辅助函数（避免 watcher 重复实现合并逻辑）
- [ ] 修改 `apps/server/src/index.ts`
  - [ ] 在 `start()` 中调用 `startAiRegistryWatcher()`
  - [ ] 在 `SIGINT`/`SIGTERM` 时关闭 watcher
- [ ] 手动测试
  - [ ] 修改 `ai_models.yaml` → 验证路由策略立即生效
  - [ ] 修改 `prompt_slots.yaml` → 验证 prompt slot 立即生效
  - [ ] 写入非法 YAML → 验证旧配置保留 + warn 日志
  - [ ] 删除 override 文件 → 验证回退到 builtin 默认值

---

## 边界与取舍

**不做**：
- 不监听内置默认文件（`prompt_slots.default.yaml`），它属于源码
- 不支持远程配置中心（如 etcd/consul），仅本地文件
- 不支持部分更新/热补丁（每次全量重载）
- 不通知 WebSocket/SSE 给前端（仅 server 日志）

**风险**：
- `fs.watch` 在 Docker/VM 共享文件系统上可能不可靠 → 可接受，dev 环境够用；生产环境通常不会热改配置
- 重载瞬间（cache 置 null 到下一次 get 之间）是原子操作，但如果有请求正在执行到一半使用了旧配置，不受影响（缓存值不变，reset 只清空引用）
