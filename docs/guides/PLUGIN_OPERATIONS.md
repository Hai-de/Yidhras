# Plugin Operations Guide / 插件治理操作手册

本文档收口 pack-local plugin 的治理操作说明，覆盖 CLI / GUI 的基本流程、常见命令与注意事项。

> 事实源约定：
> - 命令入口以 `apps/server/package.json` 与 `docs/guides/COMMANDS.md` 为准。
> - HTTP contract 以 `docs/API.md` 为准。
> - 架构与 runtime 边界以 `docs/ARCH.md` 为准。
> - 本文档负责解释“怎么操作”和“操作顺序是什么”。

## 1. 范围

当前项目中的插件治理，指的是 **pack-local plugin** 的导入确认、启用、禁用、重扫描与基础诊断。

当前已支持的主要入口：

- GUI：前端 `/plugins` 页面
- API：`/api/packs/:packId/plugins*`
- CLI：plugin CLI 已在兼容性清理中移除（2026-05-02），请使用 HTTP API 替代

当前边界：

- 只支持 `pack_local` scope
- 插件不会因为被扫描到就自动启用
- 导入确认（confirm import）与启用（enable）是两个阶段
- enable 可能要求 acknowledgement

## 2. 治理流程总览

推荐按以下顺序操作：

1. 扫描 / 查看插件
2. confirm import
3. 如有需要授予 capability
4. enable
5. 使用中如需停用则 disable
6. 如插件目录变化则 rescan

简化理解：

```text
discovered
  -> pending_confirmation
  -> confirmed_disabled
  -> enabled / disabled
```

## 3. HTTP API 入口

插件管理通过 HTTP API 操作，需服务器运行中。

```bash
# 基础 URL (默认端口 3001)
BASE=http://localhost:3001
```

### 4. 常见操作

### 4.1 查看当前 pack 的插件列表

```bash
curl -H "Authorization: Bearer $YIDHRAS_TOKEN" \
  $BASE/api/packs/my_pack/plugins
```

适用场景：
- 看当前 pack 下有哪些 installation
- 看 lifecycle state
- 看 requested / granted capabilities

### 4.2 查看单个插件详情

```bash
curl -H "Authorization: Bearer $YIDHRAS_TOKEN" \
  $BASE/api/packs/my_pack/plugins/<installation-id>
```

适用场景：
- 查看 manifest 信息
- 查看 capability 请求
- 检查当前状态与来源

### 4.3 确认导入插件

```bash
curl -X POST \
  -H "Authorization: Bearer $YIDHRAS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"granted_capabilities": ["<capability-key>"]}' \
  $BASE/api/packs/my_pack/plugins/<installation-id>/confirm
```

说明：
- confirm import 不是 enable
- confirm 阶段可以授予全部或部分 requested capabilities
- 未授予的 capability 不会进入 installation 的 `granted_capabilities`

### 4.4 启用插件

```bash
curl -X POST \
  -H "Authorization: Bearer $YIDHRAS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"acknowledgement": {"reminder_text_hash": "<hash>"}}' \
  $BASE/api/packs/my_pack/plugins/<installation-id>/enable
```

说明：
- enable 前通常要求 installation 已处于可启用状态
- 如果系统启用了 enable warning，可能需要 acknowledgement
- GUI 与 API 都遵循同一套 warning / acknowledgement 语义

### 4.5 禁用插件

```bash
curl -X POST \
  -H "Authorization: Bearer $YIDHRAS_TOKEN" \
  $BASE/api/packs/my_pack/plugins/<installation-id>/disable
```

适用场景：
- 临时停用插件
- 遇到异常时回退

### 4.6 重新扫描插件目录

插件重新扫描通过前端 GUI `/plugins` 页面或直接重启服务器完成。无独立 HTTP API 端点。

适用场景：
- 本地修改了 `plugins/` 目录内容
- 新增或替换了插件工件

### 4.7 查看日志

```bash
curl -H "Authorization: Bearer $YIDHRAS_TOKEN" \
  $BASE/api/audit/logs?action=ENABLE_PLUGIN&limit=10
```

适用场景：
- 查看 activation / acknowledgement / 生命周期事件
- 排查启用失败或重复确认问题

### 4.8 诊断为何不能启用

通过 `GET /api/packs/:packId/plugins` 查看 installation 的 `lifecycle_state` 和 `last_error` 字段，对照第 2 节状态流转图诊断。

## 5. GUI 操作说明

当前前端已提供：

- 页面：`/plugins`
- 功能：
  - installation inventory
  - capability grant 勾选式 confirm import
  - enable acknowledgement 展示与提交
  - confirm / enable / disable 操作流

使用建议：

1. 先在 `/plugins` 查看 installation 列表
2. 对 `pending_confirmation` 的插件先做 confirm import
3. 根据需要勾选授予 capability
4. 若系统要求 acknowledgement，则在 enable 前确认 warning text
5. 完成 enable 后，再去对应页面验证 runtime 行为

## 6. API 入口

当前相关接口包括：

- `GET /api/packs/:packId/plugins`
- `POST /api/packs/:packId/plugins/:installationId/confirm`
- `POST /api/packs/:packId/plugins/:installationId/enable`
- `POST /api/packs/:packId/plugins/:installationId/disable`
- `GET /api/packs/:packId/plugins/runtime/web`
- `GET /api/packs/:packId/plugins/:pluginId/runtime/web/:installationId/*`

含义简述：

- `GET /plugins`：看 installation 列表和 `enable_warning` 快照
- `POST /confirm`：确认导入并可提交 granted capabilities
- `POST /enable`：启用 installation，并在需要时提交 acknowledgement
- `POST /disable`：停用 installation
- `GET /runtime/web`：读取当前已启用 web runtime manifest
- `GET /runtime/web/:installationId/*`：访问启用插件的同源 web 资产

更精确的 body / 返回结构请看 `docs/API.md`。

## 7. acknowledgement 说明

enable warning 与 acknowledgement 的完整语义（canonical text/hash 维护、ack 提交要求）见 [`PLUGIN_RUNTIME.md`](../capabilities/PLUGIN_RUNTIME.md) 第 5 节。

操作层面要点：

- 系统可能要求在 enable 前提交 acknowledgement
- GUI / CLI 都消费同一份后端下发的 canonical warning text/hash
- acknowledge 时提交的 `reminder_text_hash` 必须与服务端当前 canonical warning 匹配

enable 失败时优先检查：

1. 当前 installation 是否已 confirm
2. 当前状态是否允许 enable
3. 是否缺少 acknowledgement
4. `reminder_text_hash` 是否仍与服务端匹配

## 8. 常见排查路径

### 问题 1：插件扫描到了，但不能启用

优先检查：
- 是否仍处于 `pending_confirmation`
- 是否尚未授予需要的 capability
- 是否需要 acknowledgement
- 使用 `GET /api/packs/:packId/plugins/<installation-id>` 查看 `lifecycle_state` 和 `last_error` 字段

### 问题 2：GUI 能看到插件，但面板/路由没有生效

优先检查：
- installation 是否为 `enabled`
- `GET /api/packs/:packId/plugins/runtime/web` 是否包含该插件
- web bundle route 是否可访问
- 插件运行时模块是否正确导出 `default / panels / routes`

### 问题 3：本地替换了插件文件，但行为没变化

尝试通过前端 GUI `/plugins` 页面重新扫描，或重启服务器。必要时结合 logs 与 GUI 页面重新确认当前 installation 状态。

## 9. 相关文档

- 命令入口：[`COMMANDS.md`](./COMMANDS.md)
- HTTP contract：[`API.md`](../API.md)
- Runtime 架构与边界：[`ARCH.md`](../ARCH.md)
- 插件 runtime 语义：[`PLUGIN_RUNTIME.md`](../capabilities/PLUGIN_RUNTIME.md)
