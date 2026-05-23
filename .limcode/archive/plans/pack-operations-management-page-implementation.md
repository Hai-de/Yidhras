<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/pack-operations-management-page-design.md","contentHash":"sha256:d62f528274d134e208a46fea4999aebdf0cfc252a74b12de222202954c614bb2"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 修正 experimental runtime 路由路径，使用 :packId(instance_id)  `#t1`
- [x] 新增前端 usePackOperationsApi composable  `#t2`
- [x] 重构 /packs 为 Pack Operations 页面并显示 summary/status/actions  `#t3`
- [x] 接入 Load/Unload/Refresh/Enter 交互与错误反馈  `#t4`
- [x] 运行 web/server typecheck 与相关 lint  `#t5`
<!-- LIMCODE_TODO_LIST_END -->

# Pack Operations 管理页 MVP 实施计划

## 来源设计

- 设计文档：`.limcode/design/pack-operations-management-page-design.md`
- 重要更新：同一世界包多副本的 `instance_id` 链路已经实现，实施时以 `instance_id` 作为运行时操作、路由进入和状态查询标识，不再使用旧文档中的 `metadata.id` 作为 pack scoped runtime 标识。

## 目标

将登录后的 `apps/web/pages/packs.vue` 从简单的 world pack 选择页升级为 `Pack Operations` 后台管理页 MVP，支持：

1. 查看 pack 列表、`instance_id`、`metadata_id`、folder、版本、描述、运行状态、健康状态、tick。
2. 手动刷新列表。
3. 进入 pack 工作台。
4. 启动 / 加载未运行 pack。
5. 停止 / 卸载已运行 pack。
6. 为 Reload / Delete / Pause / Resume 预留 UI 与结构，但不在本轮实现真实后端能力。
7. 修正 `experimental_runtime.ts` 中 runtime 操作路由缺少 `:packId` 但读取 `req.params.packId` 的问题。
8. 保持工业终端 UI 风格。

## 当前事实

### instance_id 已实现

当前代码中已存在：

- 后端 `/api/packs` 返回：
  - `instance_id`
  - `metadata_id`
  - `folder_name`
- 前端 `PackListItem` 已包含：
  - `instance_id`
  - `metadata_id`
  - `folder_name`
- 前端进入 pack 已使用：
  - `enterPack(pack.instance_id)`
- runtime store / system API / theme / plugin runtime 已多处切换到 `instance_id`。

因此本计划所有 `packId` 参数的语义均为：

```txt
packId === instance_id
```

### 需要修复的后端 API 不一致

`apps/server/src/app/routes/experimental_runtime.ts` 当前存在路径与实现不一致：

```ts
app.post('/api/experimental/runtime/packs/load', ...)
const packId = resolvePackIdParam(req.params.packId)
```

路径没有 `:packId`，但代码读取 `req.params.packId`。

本轮必须先修正这类路由，否则前端无法调用 load/unload/status/clock/step 等能力。

## 非目标

本轮不实现：

- 真实文件删除 pack 目录。
- Import / Export。
- Duplicate Pack。
- 完整 Snapshot 管理。
- Operator binding 管理。
- 新 capability 建模。
- Pack instance id 体系改造（已完成，且不在本轮扩展）。
- Pause / Resume 的真实后端能力，除非已存在明确 pack-scoped API。
- Reload 的单独后端 API，第一版可暂不提供或前端后续通过 unload+load 串联。

---

## 阶段 1：修正后端 experimental runtime 路由

### 1.1 修改路由路径

文件：`apps/server/src/app/routes/experimental_runtime.ts`

将以下路径改为包含 `:packId`：

```ts
POST /api/experimental/runtime/packs/:packId/load
POST /api/experimental/runtime/packs/:packId/unload
POST /api/experimental/runtime/packs/:packId/step
GET  /api/experimental/runtime/packs/:packId/status
GET  /api/experimental/runtime/packs/:packId/clock
GET  /api/experimental/runtime/packs/:packId/scheduler/summary
GET  /api/experimental/runtime/packs/:packId/scheduler/ownership
GET  /api/experimental/runtime/packs/:packId/scheduler/workers
GET  /api/experimental/runtime/packs/:packId/scheduler/operator
```

保留全局路由：

```ts
GET /api/experimental/runtime/system/health
GET /api/experimental/runtime/packs
```

### 1.2 修正格式问题

同文件中存在多处缩进异常，例如：

```ts
jsonOk(res, toJsonSafe(...))
const packId = resolvePackIdParam(req.params.packId)
```

本轮在触碰文件时一并格式化相关代码块，保证 lint 可读性。

### 1.3 保持权限逻辑

保留现有：

```ts
packAccessGuard(context, { packIdParam: 'packId' })
capabilityGuard(..., { packIdParam: 'packId' })
```

注意：这里的 `packId` URL 参数实际是 `instance_id`。

### 1.4 后端验证

运行：

```bash
pnpm --filter yidhras-server typecheck
pnpm --filter yidhras-server exec eslint src/app/routes/experimental_runtime.ts
```

---

## 阶段 2：新增前端 Pack Operations API composable

### 2.1 新增文件

文件：`apps/web/composables/api/usePackOperationsApi.ts`

提供：

```ts
export type PackOperationResult = {
  acknowledged?: boolean
  [key: string]: unknown
}

export const usePackOperationsApi = () => {
  return {
    loadPack,
    unloadPack,
    stepPack,
    getRuntimeStatus,
    getRuntimeClock,
    listRuntimePacks
  }
}
```

### 2.2 API 方法

使用 `requestApiData`：

```ts
loadPack(instanceId: string)
POST /api/experimental/runtime/packs/${encodeURIComponent(instanceId)}/load

unloadPack(instanceId: string)
POST /api/experimental/runtime/packs/${encodeURIComponent(instanceId)}/unload

stepPack(instanceId: string, amount = 1)
POST /api/experimental/runtime/packs/${encodeURIComponent(instanceId)}/step
body: { amount }

listRuntimePacks()
GET /api/experimental/runtime/packs
```

`reloadPack` 第一版不单独放入 API composable，避免伪造不存在的后端能力；后续若需要可通过 `unloadPack` + `loadPack` 串联实现。

### 2.3 URL 编码

所有 `instance_id` 进入 URL 前必须使用 `encodeURIComponent`。

---

## 阶段 3：重构 `pages/packs.vue` 为 Pack Operations 页面

文件：`apps/web/pages/packs.vue`

### 3.1 页面标题与说明

将标题改为：

```txt
Pack Operations
```

副标题：

```txt
Manage world pack lifecycle, runtime state, and diagnostics.
```

保留 Logout。

新增 Refresh 按钮。

### 3.2 页面布局

使用工业终端风格：

- 页面背景：`bg-yd-app`，可使用 `yd-grid-surface` 但避免过度装饰。
- 外层宽度从 `max-w-3xl` 扩大为适合管理页的 `max-w-5xl` 或 `max-w-6xl`。
- Pack card 使用 `yd-panel-surface` 或等价边框/暗色面板。
- 状态 chip 使用 mono uppercase 小标签。

### 3.3 Summary Strip

新增基于 `packs` 的统计：

```ts
const packSummary = computed(() => ({
  total: packs.value.length,
  loaded: packs.value.filter(p => p.runtime_status === 'loaded').length,
  notLoaded: packs.value.filter(p => p.runtime_status === 'not_loaded').length,
  unhealthy: packs.value.filter(p => p.health_status && p.health_status !== 'loaded' && p.health_status !== 'ok').length
}))
```

显示示例：

```txt
TOTAL 4 · LOADED 1 · NOT LOADED 3 · ISSUES 0
```

### 3.4 Pack Card 信息

每张 card 显示：

- `pack.name`
- `pack.description`
- `instance_id`
- `metadata_id`
- `folder_name`
- `version`
- `runtime_status`
- `health_status`
- `current_tick`
- `frontend.type === 'custom'`

字段显示建议：

```txt
INSTANCE death_note · TYPE world-death-note · FOLDER death_note · v0.5.0
RUNTIME LOADED · HEALTH loaded · TICK 1234
```

### 3.5 操作按钮

每张 card 操作区：

- `Enter`：始终显示。
- `Load`：`runtime_status === 'not_loaded'` 时显示。
- `Unload`：`runtime_status === 'loaded'` 时显示。
- `Reload`：第一版显示为 disabled 或暂不显示；若显示，标注 `Soon`，避免误导。
- `Pause` / `Resume`：第一版显示为 disabled 或暂不显示，等待 pack-scoped pause/resume 后端能力。
- `Delete`：放入 danger 区，但第一版 disabled，并显示 title：`Delete is not implemented in MVP`。

### 3.6 操作 pending 状态

新增：

```ts
type PackOperation = 'load' | 'unload' | 'refresh'
const pendingByInstanceId = ref<Record<string, PackOperation | null>>({})
```

辅助函数：

```ts
const setPending = (instanceId: string, operation: PackOperation | null) => { ... }
const isPending = (instanceId: string) => Boolean(pendingByInstanceId.value[instanceId])
```

### 3.7 Load 行为

```ts
const handleLoadPack = async (pack: PackListItem) => {
  setPending(pack.instance_id, 'load')
  clear errors
  try {
    await packOperationsApi.loadPack(pack.instance_id)
    await fetchPacks()
  } catch (error) {
    set pack/local or global error
  } finally {
    setPending(pack.instance_id, null)
  }
}
```

### 3.8 Unload 行为

Unload 必须确认。

第一版可使用 `window.confirm`，后续替换为工业风 modal：

```ts
if (!window.confirm(`Unload pack "${pack.name}"?`)) return
```

成功后刷新列表。

### 3.9 错误显示

新增页面级错误：

```ts
const operationError = ref<string | null>(null)
```

在列表上方显示 `AppAlert` 或现有 danger panel。

局部错误可暂缓，第一版先页面级。

---

## 阶段 4：类型更新与兼容

### 4.1 PackListItem 保持 instance_id

文件：`apps/web/composables/api/usePackListApi.ts`

确认当前结构已经包含：

```ts
instance_id: string
metadata_id: string
folder_name: string
```

不需要回退到旧 `id` 字段。

### 4.2 进入路由使用 instance_id

文件：`apps/web/pages/packs.vue`

保持：

```ts
enterPack(pack.instance_id)
```

### 4.3 `:key` 使用 instance_id 或 folder_name

建议：

```vue
:key="pack.instance_id"
```

若未来允许同一 instance_id 冲突，应由后端拒绝，而不是前端兜底。

---

## 阶段 5：测试与验证

### 5.1 静态检查

运行：

```bash
pnpm --filter web typecheck
pnpm --filter web lint
pnpm --filter yidhras-server typecheck
pnpm --filter yidhras-server exec eslint src/app/routes/experimental_runtime.ts src/app/routes/packs.ts
```

### 5.2 手动验证

1. 登录。
2. 进入 `/packs`。
3. 页面标题为 `Pack Operations`。
4. 列表显示 instance/type/folder/status/tick。
5. 未加载 pack 点击 `Load`。
6. Load 成功后状态刷新为 `Loaded`。
7. 已加载 pack 点击 `Unload`。
8. 确认后 unload，状态刷新为 `Not loaded`。
9. 点击 `Enter` 可进入 `/packs/:instanceId`。
10. 操作失败时显示错误信息。

### 5.3 API 手动验证

示例：

```bash
curl -X POST http://localhost:3001/api/experimental/runtime/packs/death_note/load \
  -H "Authorization: Bearer $TOKEN"

curl -X POST http://localhost:3001/api/experimental/runtime/packs/death_note/unload \
  -H "Authorization: Bearer $TOKEN"
```

注意：是否能成功取决于 operator 是否已绑定对应 `instance_id` 的 pack 权限。

---

## 风险与注意事项

1. **权限绑定可能仍未完全切到 instance_id**  
   如果 load/unload 返回 `PACK_ACCESS_DENIED`，需要检查 operator pack binding 是否已按 instance_id 写入。

2. **Unload 对 active pack 的限制**  
   `translateExperimentalUnloadError` 中已有 active runtime unload forbidden 逻辑，前端应显示原始错误信息。

3. **Pause/Resume 不要伪实现**  
   如果后端没有 pack-scoped pause/resume，不要在 UI 中让按钮看起来可用。

4. **Delete 暂不实现真实文件删除**  
   设计文档中有 Delete，但本轮 MVP 不做文件系统删除，避免误删和安全策略扩散。

5. **experimental runtime API 仍属实验路径**  
   页面文案可以使用正常运维语义，但代码层要保留 experimental API 命名，后续再收口稳定 API。

## 交付文件清单

预计修改：

- `apps/server/src/app/routes/experimental_runtime.ts`
- `apps/web/composables/api/usePackOperationsApi.ts`
- `apps/web/pages/packs.vue`

可能修改：

- `apps/web/composables/api/usePackListApi.ts`（仅在类型需补充时）
- `apps/server/src/app/routes/packs.ts`（仅在状态字段需增强时）
