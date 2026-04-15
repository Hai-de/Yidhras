# {{PACK_NAME}} World Pack

> 用一句话说明这个 world pack 想模拟什么世界、题材与核心张力。

## 概览

- Pack ID：`{{PACK_ID}}`
- Version：`{{PACK_VERSION}}`
- 题材：{{PACK_GENRE}}
- 当前状态：{{PACK_STATUS}}
- 兼容的 Yidhras 版本：{{YIDHRAS_COMPATIBILITY}}
- 许可证：{{PACK_LICENSE}}

## 世界前提

说明：

- 这个世界的基本设定
- 核心冲突或张力
- 为什么它适合被做成 Yidhras world pack

## 核心机制

### 1. 实体

列出最重要的：

- actors
- artifacts
- mediators
- institutions / domains

### 2. 能力与授权

说明：

- pack 主要暴露哪些 capability
- 这些 capability 如何被授予
- 是否存在媒介、持有关系、资格链

### 3. 规则与执行

说明：

- invocation grounding 的组织方式
- objective enforcement 会改变哪些世界状态
- 哪些行为只是 narrativized，不会改变客观事实

## 目录结构

```text
{{PACK_DIR}}/
├─ config.yaml
├─ README.md
├─ CHANGELOG.md
├─ assets/        # optional
├─ docs/          # optional
└─ examples/      # optional
```

## 使用方式

### 1. 放置目录

```text
data/world_packs/{{PACK_DIR}}/
```

### 2. 启动

```bash
pnpm --filter yidhras-server prepare:runtime
pnpm --filter yidhras-server dev
```

## 发布元数据

建议说明以下信息：

- Authors：{{PACK_AUTHORS}}
- Homepage：{{PACK_HOMEPAGE}}
- Repository：{{PACK_REPOSITORY}}
- Tags：{{PACK_TAGS}}
- License：{{PACK_LICENSE}}

## 设计边界

明确区分：

- 当前已实现的 pack-level 能力
- 仍由 kernel 控制的能力
- 未来计划，但还未进入 schema/loader/runtime contract 的能力

## 已知限制

列出：

- 当前未覆盖的规则
- 当前 operator / API / projection 缺口
- 当前需要人工维护或额外文档说明的点

## 版本记录

详见：`./CHANGELOG.md`

## 作者 / 发布

- Authors：{{PACK_AUTHORS}}
- Published at：{{PACK_PUBLISHED_AT}}
- Homepage：{{PACK_HOMEPAGE}}
- Repository：{{PACK_REPOSITORY}}
