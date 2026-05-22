# Pack Operations 后台管理页设计方案

## 1. 背景与目标

当前登录后的 `apps/web/pages/packs.vue` 主要承担“选择世界包进入”的入口功能：

- 展示 world pack 列表
- 显示基础 metadata：名称、描述、版本、id、目录名、runtime status
- 点击卡片进入 `/packs/:packId`

但作为后台管理入口，它缺少对 world pack 生命周期的管理能力。用户期望该页面至少可以控制世界包：

- 启动 / 加载
- 暂停 / 恢复
- 停止 / 卸载
- 删除

本设计将该页面升级为 **Pack Operations（世界包运维控制台）**，作为 operator 登录后的管理首页。

设计目标：

1. 让 operator 能在一个页面完成世界包的基础生命周期管理。
2. 保持当前工业终端 UI 风格，不引入营销式或重装饰页面。
3. 明确区分“世界包资产状态”和“运行时状态”。
4. 对危险操作提供明确确认和错误反馈。
5. 为后续 snapshot、validate、duplicate、import/export、pack instance id 等功能预留位置。

---

## 2. 当前系统观察

### 2.1 前端现状

相关文件：

- `apps/web/pages/packs.vue`
- `apps/web/composables/api/usePackListApi.ts`

当前 `PackListItem`：

```ts
export interface PackListItem {
  id: string
  folder_name: string
  name: string
  version: string
  description: string | null
  presentation: {
    cover_image?: string
    icon?: string
    theme?: Record<string, unknown>
  } | null
  frontend: {
    type: 'default' | 'custom'
    entry?: string
  } | null
  runtime_status: 'loaded' | 'not_loaded'
  health_status: string | null
  current_tick: string | null
}
```

当前页面已经显示：

- name
- description
- version
- metadata id
- folder name
- runtime status
- custom UI 标记

但页面仍然是“选择列表”，不是“管理控制台”。

### 2.2 后端现状

相关文件：

- `apps/server/src/app/routes/packs.ts`
- `apps/server/src/app/routes/experimental_runtime.ts`
- `apps/server/src/app/services/runtime/experimental_multi_pack_runtime.ts`
- `apps/server/src/app/routes/system.ts`

当前 `/api/packs` 已可返回 world pack 列表和基础 runtime 状态。

已有 experimental runtime 相关能力迹象：

- runtime registry snapshot
- system health snapshot
- load pack runtime
- unload pack runtime
- step tick
- pack runtime status
- pack clock
- scheduler summary / ownership / workers / operator projection

但 `experimental_runtime.ts` 中部分 route 当前从 `req.params.packId` 读取 packId，路径却类似：

```ts
'/api/experimental/runtime/packs/load'
'/api/experimental/runtime/packs/unload'
'/api/experimental/runtime/packs/status'
```

这些路径没有 `:packId` 参数，后续实施前需要先对齐 API 路由设计。

---

## 3. 产品定位

页面名称建议：

```txt
Pack Operations
```

副标题：

```txt
Manage world pack lifecycle, runtime state, and diagnostics.
```

页面职责：

1. 查看 world pack 资产列表。
2. 查看每个 pack 的运行状态和健康状态。
3. 执行基础生命周期操作。
4. 进入 pack 内部工作台。
5. 显示错误、警告、运行时诊断摘要。

不建议继续命名为 `World Packs`，因为该名称更像内容选择页，不像后台管理页。

---

## 4. 信息架构

### 4.1 页面整体结构

```txt
┌────────────────────────────────────────────────────────────┐
│ PACK OPERATIONS                                            │
│ Manage world pack lifecycle, runtime state, diagnostics.   │
│                                                            │
│ [Search packs...] [Status: All ▼] [Refresh] [Import? later]│
├────────────────────────────────────────────────────────────┤
│ Summary Strip                                              │
│ Total 4 · Loaded 1 · Paused 0 · Degraded 0 · Errors 0      │
├────────────────────────────────────────────────────────────┤
│ Pack Card                                                  │
│ ┌────────────────────────────────────────────────────────┐ │
│ │ 死亡笔记                                               │ │
│ │ world-death-note · folder: death_note · v0.5.0          │ │
│ │ 一个围绕规则媒介、侦查对抗...                           │ │
│ │                                                        │ │
│ │ Runtime: LOADED · Health: OK · Tick: 12345              │ │
│ │                                                        │ │
│ │ [Enter] [Start] [Pause] [Stop] [Reload] [Delete]        │ │
│ └────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
```

### 4.2 单个 Pack Card 信息

每个 card 建议展示：

| 信息 | 来源 | 说明 |
|---|---|---|
| `name` | `metadata.name` | 主标题 |
| `id` | `metadata.id` | 系统级 pack id |
| `folder_name` | 目录名 | 开发环境区分手段 |
| `version` | `metadata.version` | 版本 |
| `description` | `metadata.description` | 简介 |
| `runtime_status` | runtime registry/list API | loaded / not_loaded |
| `health_status` | runtime handle health | ok / degraded / error / null |
| `current_tick` | runtime clock | 当前 tick |
| `frontend.type` | metadata/frontend | custom UI 标记 |
| warnings/errors | 后续扩展 | 加载或校验错误摘要 |

### 4.3 状态分层

需要避免把所有状态都压成 `loaded/not_loaded`。

建议拆分：

#### 资产状态 Asset Status

表示磁盘上的 pack 是否存在、是否可解析。

```ts
type PackAssetStatus =
  | 'available'
  | 'invalid'
  | 'missing'
```

#### 运行时状态 Runtime Status

表示 pack runtime 是否已加载。

```ts
type PackRuntimeStatus =
  | 'not_loaded'
  | 'loading'
  | 'loaded'
  | 'unloading'
  | 'paused'
  | 'degraded'
  | 'error'
```

#### 模拟循环状态 Loop Status

表示是否正在自动推进。

```ts
type PackLoopStatus =
  | 'running'
  | 'paused'
  | 'stopped'
```

第一版可以先只落地 `runtime_status`，但 UI 文案和接口要预留这些状态位。

---

## 5. 功能范围

## 5.1 MVP 功能

第一版建议实现以下功能。

### 5.1.1 Refresh

刷新 pack 列表和 runtime 状态。

按钮位置：页面标题区右侧。

行为：

```txt
GET /api/packs
```

成功后刷新列表。

### 5.1.2 Enter

进入 pack 工作台。

行为：

```ts
router.push(`/packs/${pack.id}`)
```

注意：当前系统仍以 `metadata.id` 作为 pack scoped route 标识。

### 5.1.3 Start / Load

加载未运行的 pack runtime。

显示条件：

```txt
runtime_status === 'not_loaded'
```

建议 API：

```http
POST /api/experimental/runtime/packs/:packId/load
```

请求成功后刷新列表。

### 5.1.4 Stop / Unload

卸载已加载的 pack runtime。

显示条件：

```txt
runtime_status === 'loaded' | 'paused' | 'degraded'
```

建议 API：

```http
POST /api/experimental/runtime/packs/:packId/unload
```

该操作会释放 runtime 资源，可能影响正在运行的模拟，需要确认对话框。

确认文案：

```txt
Unload pack "死亡笔记"?
The runtime will stop and active loop state may be lost.
```

### 5.1.5 Pause / Resume

暂停或恢复模拟循环。

注意：这里需要先确认后端已有全局 pause/resume 还是 pack-scoped pause/resume。

建议最终 API：

```http
POST /api/experimental/runtime/packs/:packId/pause
POST /api/experimental/runtime/packs/:packId/resume
```

如果当前后端只有全局 `context.pause()` / `context.resume()`，第一版不要伪装成 pack-scoped，需要先补后端能力。

### 5.1.6 Reload

重新加载 pack。

行为等价：

```txt
Unload -> Load -> Refresh
```

建议 API：

```http
POST /api/experimental/runtime/packs/:packId/reload
```

如果后端没有单独 reload，前端第一版可以串联 unload/load，但需要注意错误恢复。

确认文案：

```txt
Reload pack "死亡笔记"?
Current runtime state will be discarded and the pack will be loaded again from disk.
```

### 5.1.7 Delete

删除 pack 资产目录。

这是危险操作，第一版建议只在开发环境启用。

建议 API：

```http
DELETE /api/packs/:packId
```

但当前同一 `metadata.id` 未来可能对应多个目录，因此更合理的删除对象是 `folder_name` 或未来的 `instance_id`。

更安全的 API：

```http
DELETE /api/packs/by-folder/:folderName
```

或者：

```http
DELETE /api/packs/:packId?folderName=death_note
```

设计建议：第一版暂不立即实现 Delete 后端，先在 UI 设计中保留危险操作区。若要实现，必须确认删除粒度。

---

## 5.2 P1 功能

### 5.2.1 Validate Pack

校验 pack 配置。

检查内容：

- `pack.yaml` schema
- include 文件是否存在
- behavior tree 是否可编译
- prompt macro 是否可解析
- capability / authority 引用是否合法
- plugin manifest 是否完整
- storage schema 是否可迁移

建议 API：

```http
POST /api/packs/:packId/validate
```

返回：

```ts
interface PackValidationResult {
  status: 'ok' | 'warning' | 'error'
  diagnostics: Array<{
    severity: 'info' | 'warning' | 'error'
    code: string
    message: string
    path?: string
  }>
}
```

### 5.2.2 Snapshot 入口

不在列表页展开完整管理，但显示入口：

- Create Snapshot
- View Snapshots
- Restore

### 5.2.3 Plugin Summary

每个 pack card 展示：

```txt
Plugins: 2 enabled · 1 pending · risk medium
```

并提供入口：

```txt
Manage Plugins
```

### 5.2.4 Step Once / Step N

用于调试模拟。

建议 API：

```http
POST /api/experimental/runtime/packs/:packId/step
```

请求体：

```json
{ "amount": 1 }
```

---

## 5.3 P2 功能

暂缓到后续：

- Import Pack
- Export Pack
- Duplicate Pack
- Rename / Change Instance ID
- Archive / Enable / Disable Pack
- Operator binding 管理
- capability grant 管理
- AI token/cost 统计
- runtime metrics dashboard
- audit log
- pack instance id 体系改造

---

## 6. API 设计建议

### 6.1 当前需要整理的 API 问题

`experimental_runtime.ts` 中部分 API 目前路径和实现不一致：

```ts
app.post('/api/experimental/runtime/packs/load', ...)
const packId = resolvePackIdParam(req.params.packId)
```

路径里没有 `:packId`，但实现读取 `req.params.packId`。

建议统一为：

```http
GET  /api/experimental/runtime/system/health
GET  /api/experimental/runtime/packs
POST /api/experimental/runtime/packs/:packId/load
POST /api/experimental/runtime/packs/:packId/unload
POST /api/experimental/runtime/packs/:packId/reload
POST /api/experimental/runtime/packs/:packId/pause
POST /api/experimental/runtime/packs/:packId/resume
POST /api/experimental/runtime/packs/:packId/step
GET  /api/experimental/runtime/packs/:packId/status
GET  /api/experimental/runtime/packs/:packId/clock
GET  /api/experimental/runtime/packs/:packId/scheduler/summary
GET  /api/experimental/runtime/packs/:packId/scheduler/ownership
GET  /api/experimental/runtime/packs/:packId/scheduler/workers
GET  /api/experimental/runtime/packs/:packId/scheduler/operator
```

### 6.2 Pack List API 增强

当前：

```http
GET /api/packs
```

建议返回结构增加：

```ts
interface PackListItem {
  id: string
  folder_name: string
  name: string
  version: string
  description: string | null
  presentation: Record<string, unknown> | null
  frontend: Record<string, unknown> | null
  runtime_status: 'loaded' | 'not_loaded' | 'loading' | 'unloading' | 'paused' | 'degraded' | 'error'
  health_status: string | null
  current_tick: string | null
  loop_status?: 'running' | 'paused' | 'stopped'
  last_error?: string | null
  warnings?: string[]
  capabilities?: {
    can_load: boolean
    can_unload: boolean
    can_pause: boolean
    can_delete: boolean
  }
}
```

`capabilities` 可以由后端根据当前 operator 权限和 runtime 状态计算，前端只负责禁用或显示按钮。

---

## 7. 前端组件设计

### 7.1 页面组件

继续使用：

```txt
apps/web/pages/packs.vue
```

但页面语义从选择页升级为管理页。

建议拆分组件：

```txt
apps/web/features/packs/components/PackOperationsHeader.vue
apps/web/features/packs/components/PackOperationsSummary.vue
apps/web/features/packs/components/PackOperationsCard.vue
apps/web/features/packs/components/PackDangerConfirmDialog.vue
apps/web/features/packs/composables/usePackOperationsPage.ts
```

第一版可以先不拆太细，但至少应把 API 操作逻辑提到 composable，避免 `pages/packs.vue` 继续膨胀。

### 7.2 API composable

当前：

```txt
apps/web/composables/api/usePackListApi.ts
```

建议新增：

```txt
apps/web/composables/api/usePackOperationsApi.ts
```

接口：

```ts
export const usePackOperationsApi = () => {
  return {
    listPacks,
    loadPack,
    unloadPack,
    reloadPack,
    pausePack,
    resumePack,
    stepPack,
    deletePack
  }
}
```

---

## 8. UI 风格规范

延续登录页和 AppShell 的工业终端风格：

- 页面背景：`bg-yd-app` 或 `yd-grid-surface`，不使用明亮背景。
- 卡片：`yd-panel-surface` / `yd-panel-surface--elevated`。
- 状态标签：`yd-status-pill`。
- 操作按钮：`yd-industrial-button` 或 `AppButton kind="toolbar"`。
- 危险操作：`yd-tone-danger`，按钮靠右或放入更多菜单。
- 标签文本：`text-[10px] uppercase tracking-[0.12em] yd-font-mono`。
- 不使用 emoji 作为状态图标。

### 8.1 Card 操作区建议

```txt
[Enter] [Start] [Pause] [Stop] [Reload]       [Delete]
```

其中：

- `Enter` 永远可见。
- `Start` 仅 not_loaded 时可见。
- `Pause` 仅 running 时可见。
- `Resume` 仅 paused 时可见。
- `Stop` 仅 loaded/paused/degraded 时可见。
- `Reload` 仅 loaded/degraded 时可见。
- `Delete` 放在 danger 区或更多菜单中。

---

## 9. 交互与错误处理

### 9.1 操作中状态

每个 pack card 需要有局部 pending 状态：

```ts
const pendingByPackId = ref<Record<string, PackOperation | null>>({})
```

防止同一 pack 同时执行多个操作。

### 9.2 成功后刷新

所有 mutation 成功后：

```ts
await fetchPacks()
```

必要时也触发 runtime status refresh。

### 9.3 错误反馈

错误显示在两个层级：

1. 页面顶部 global `AppAlert`：用于 API 整体失败。
2. Pack card 内局部错误：用于某个 pack 操作失败。

错误文案应包含恢复路径：

```txt
Failed to load pack. Check validation diagnostics or server logs.
```

### 9.4 危险操作确认

以下操作必须确认：

- Stop / Unload
- Reload
- Delete
- Reset runtime state（未来）
- Restore snapshot（未来）

Delete 需要输入 pack name 或 folder name 二次确认。

---

## 10. 权限设计

第一版可以先复用现有 operator 能力：

| 操作 | 建议能力 |
|---|---|
| 查看列表 | 已登录 operator |
| 进入 pack | pack binding 通过 |
| load/unload/reload | `INVOKE_SCHEDULER_CONTROL` 或新增 `MANAGE_PACK_RUNTIME` |
| pause/resume/step | `INVOKE_SCHEDULER_CONTROL` |
| delete | root 或新增 `MANAGE_PACK_ASSETS` |
| validate | root/admin 或已绑定 operator |

建议后续新增更清晰的 capability：

```ts
MANAGE_PACK_RUNTIME
MANAGE_PACK_ASSETS
VALIDATE_PACK
```

避免把所有运维操作都塞进 `INVOKE_SCHEDULER_CONTROL`。

---

## 11. 删除功能设计

删除 pack 是资产级操作，不是 runtime 操作。

### 11.1 删除前检查

删除前必须检查：

1. pack 是否正在运行。
2. 是否存在 runtime SQLite / snapshot / plugin state。
3. 当前 operator 是否 root。
4. 删除对象是 `folder_name` 还是 `metadata.id`。

### 11.2 推荐删除粒度

短期推荐按 `folder_name` 删除，因为磁盘资产是目录级的：

```http
DELETE /api/packs/by-folder/:folderName
```

长期如果引入 `pack_instance_id`，应改为：

```http
DELETE /api/pack-instances/:instanceId
```

### 11.3 删除确认

确认框内容：

```txt
Delete pack folder "death_note"?
This removes the pack files from data/world_packs/death_note.
This cannot be undone.

Type folder name to confirm: death_note
```

---

## 12. 与 pack instance id 的关系

当前系统以 `metadata.id` 作为核心 pack 标识。这样在以下场景会出现限制：

- 同一世界包复制两个目录进行差异化测试。
- 两个目录声明相同 `metadata.id`。
- 需要同时加载两个相同模板的不同实例。

本页面第一版只显示 `folder_name` 作为人工区分手段，不解决 runtime 层实例化问题。

真正解决方案已记录到：

```txt
.limcode/enhancements-backlog.md
```

条目：

```txt
同一世界包多副本区分机制
```

Pack Operations 页面需要为未来的 `instance_id` 预留字段和布局。

---

## 13. 实施优先级

### P0：控制台 MVP

1. 页面标题从 `World Packs` 改为 `Pack Operations`。
2. 重构 pack card，展示状态、id、folder、tick、health。
3. 新增 Refresh。
4. 接入 Load / Unload。
5. 接入 Enter。
6. 对 Stop/Unload、Reload、Delete 预留确认对话框结构。
7. 修正 experimental runtime route 的 `:packId` 路径问题。

### P1：运行控制增强

1. Pause / Resume。
2. Reload。
3. Step Once / Step N。
4. Pack validation。
5. Snapshot 入口。
6. Plugin summary。

### P2：资产管理

1. Delete by folder。
2. Import / Export。
3. Duplicate Pack。
4. Archive / Enable / Disable。
5. pack instance id 体系。

### P3：权限与监控

1. Operator binding 管理。
2. capability grant 管理。
3. runtime metrics。
4. scheduler diagnostics。
5. audit log。

---

## 14. MVP 验收标准

第一版完成后，应满足：

1. 登录后进入 Pack Operations 页面。
2. 页面显示所有 pack 的 name、id、folder、version、status、health、tick。
3. 未加载 pack 可点击 Load。
4. 已加载 pack 可点击 Unload。
5. 操作期间按钮 disabled，并显示 pending 状态。
6. 操作成功后列表刷新。
7. 操作失败时显示结构化错误。
8. Enter 可进入 pack 工作台。
9. API route 不再出现路径无 `:packId` 但读取 `req.params.packId` 的不一致问题。
10. 页面保持现有工业终端设计语言。

---

## 15. 暂不实施的内容

以下内容本轮只设计，不实施：

- Delete 的真实文件删除逻辑。
- Import / Export。
- Duplicate Pack。
- pack instance id。
- 完整 snapshot 管理。
- operator binding 管理。
- AI usage / cost dashboard。

原因：这些涉及数据模型、权限模型或文件系统安全策略，不适合作为 Pack Operations MVP 的第一步。
