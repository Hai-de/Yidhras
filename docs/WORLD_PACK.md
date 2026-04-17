# World Pack 项目化与发布规范

本文档旨在为 Yidhras world pack 作为独立项目单元提供组织、描述与发布方面的推荐标准。

本规范不替代运行时合约（runtime contract）；运行时实际读取的配置源文件仍为 `config.yaml`、`config.yml`、`pack.yaml` 或 `pack.yml`。不过，从作者协作、发布交付、版本管理与二次分发等环节考量，建议一个 world pack 不仅包含一份 YAML 配置，还应具备基本的项目说明与配套资产。

> 说明：当前运行时直接消费 pack 配置文件；README、附加文档、素材目录等内容主要面向作者、发布者、协作者及使用者。

---

## 1. 目标

将 world pack 从“运行时可加载的配置单元”提升为“可被识别、维护、交付、复用与审阅的项目单元”。

为了便于发布与协作，建议 world pack 明确以下信息：

1. 该包所定义的世界类型。
2. 模拟的主题、规则体系与叙事张力。
3. 所提供的核心实体、身份、能力、媒介与规则。
4. 运行所需的版本、依赖项与注意事项。
5. 使用者的安装、覆盖、修改与升级方式。
6. 版本变更记录、兼容性说明与已知限制。

---

## 1.1 发布元数据字段规范

为使 world pack 具备更完整的项目属性，建议在 `metadata` 区块中包含以下发布相关字段。

推荐字段列表：

- `metadata.authors`
- `metadata.license`
- `metadata.homepage`
- `metadata.repository`
- `metadata.tags`
- `metadata.compatibility`
- `metadata.published_at`
- `metadata.status`

示例：

```yaml
metadata:
  id: "world-death-note"
  name: "死亡笔记"
  version: "0.5.0"
  description: "一个围绕规则媒介、侦查对抗、舆论震荡与执行资格传播展开的现代悬疑世界。"
  authors:
    - name: "Yidhras Team"
      role: "default pack maintainer"
  license: "MIT"
  homepage: "https://example.com/world-pack"
  repository: "https://example.com/repo/world-pack"
  tags: ["thriller", "investigation", "supernatural"]
  compatibility:
    yidhras: ">=0.5.0"
    schema_version: "world-pack/v1"
    notes: "适合作为 mediator/capability/objective-enforcement 参考实现。"
  published_at: "2026-04-14"
  status: "stable"
```

上述字段主要服务于：

- 发布信息记录
- 版本兼容性声明
- 前端界面或 operator 的信息展示
- 第三方收录与资产管理

---

## 2. 运行时最小合约与项目化交付物

### 2.1 运行时最小要求

当前运行时识别以下文件之一作为配置入口：

- `config.yaml`
- `config.yml`
- `pack.yaml`
- `pack.yml`

上述文件承载 world pack 的正式合约定义，内容包括：

- `metadata`
- `variables`
- `prompts`
- `time_systems`
- `simulation_time`
- `entities`
- `identities`
- `capabilities`
- `authorities`
- `rules`
- `storage`
- `bootstrap`

### 2.2 项目化发布最小要求

将 world pack 作为项目单元进行发布时，建议包含以下文件：

- `config.yaml`：运行时配置与正式合约文件
- `README.md`：项目说明文件（推荐必备）
- `CHANGELOG.md`：版本变更记录（推荐提供）
- `assets/`：插图、封面、图标等外部素材目录（按需）
- `docs/`：扩展说明文档目录（按需）

各文件用途如下：

- `config.yaml`：面向运行时
- `README.md`：面向人类阅读者
- `CHANGELOG.md`：面向版本管理
- `assets/`、`docs/`：面向展示、协作与长期维护

---

## 3. 推荐目录结构

推荐的 world pack 项目目录结构如下：

```text
<pack-dir>/
├─ config.yaml
├─ README.md
├─ CHANGELOG.md
├─ LICENSE                  # 可选，公开发布时建议提供
├─ assets/                  # 可选
│  ├─ cover.png
│  └─ icon.png
├─ docs/                    # 可选
│  ├─ setting.md
│  ├─ rules.md
│  └─ release-notes.md
├─ plugins/                 # 可选，pack-local 插件工件目录
└─ examples/                # 可选
   └─ overrides.example.yaml
```

### 目录职责说明

- `config.yaml`
  - 作为 pack 的唯一运行时主配置
  - 用于 schema 校验、加载、物化与运行时执行
- `README.md`
  - 作为 pack 的外部入口文档
  - 使首次接触者能够快速了解 pack 的用途与边界
- `CHANGELOG.md`
  - 记录版本变更、兼容性变化及破坏性变更
- `assets/`
  - 存放非代码、非配置的展示素材
- `docs/`
  - 存放超出 README 范围的详细说明文档
- `plugins/`
  - 存放 pack-local 插件工件；不会因随 pack 分发而自动启用
- `examples/`
  - 存放覆盖配置（override）示例、调用示例或配置片段

---

## 4. README.md 规范

### 4.1 必要性说明

如果未提供 README.md，使用者通常需要通过直接阅读 `config.yaml` 来获取 pack 信息，这可能带来一些不便：

1. YAML 格式更适合机器解析，不适合作为项目说明入口。
2. 发布者的设计意图、题材背景、使用方式难以被快速理解。
3. 使用者难以判断 pack 是否适用于当前运行环境。
4. 协作者难以在不完全阅读合约内容的前提下参与维护。
5. 缺少版本升级、兼容性变更、注意事项的稳定记录位置。

因此，README.md 适合作为 world pack 面向人类读者的说明性入口。

### 4.2 内容要求

建议 README.md 涵盖以下章节内容：

1. **Pack 名称与一句话简介**
2. **题材 / 世界背景前提**
3. **核心机制摘要**
4. **当前版本与兼容性说明**
5. **目录结构说明**
6. **安装、使用与启动方式**
7. **关键实体、身份、能力、媒介、规则概览**
8. **已知限制**
9. **变更记录索引**
10. **作者与发布信息**

### 4.3 能力边界说明

README.md 宜明确区分：

- **已实现**的 pack 级能力
- **计划支持**的能力
- **仍由 kernel 管理**、pack 不可声明的能力

推荐避免在 README.md 中将尚未在 pack schema 或 loader 中开放的功能描述为可由 pack 作者直接声明的能力。

---

## 5. README.md 模板结构

```markdown
# <World Pack Name>

> 一句话说明该 world pack 所模拟的世界特征。

## 概览
- Pack ID:
- Version:
- 题材:
- 当前状态:
- 兼容的 Yidhras 版本:

## 世界前提
描述该世界的核心设定、冲突与叙事张力。

## 核心机制
- 实体
- 身份
- 能力
- 媒介
- 客观规则

## 目录结构
说明 `config.yaml`、`assets/`、`docs/` 等目录的用途。

## 使用方式
说明将 pack 放入 `data/world_packs/<pack>` 并启动的方法。

## 插件
- 如果 pack 目录内包含 `plugins/` 子目录，运行时在扫描时会查找其中的 `plugin.manifest.yaml` 或 `plugin.manifest.yml` 文件。
- 扫描到的插件会进入统一插件管理器，默认创建为 `pending_confirmation`。
- 导入确认（import confirmation）不等同于启用；当前 `/plugins` GUI 和 CLI 都要求先 confirm import，再进入 enable 流程。
- confirm import 时可选择授予全部或部分 `requested_capabilities`；未授予的 capability 不会进入 installation 的 `granted_capabilities`。
- 显式启用前仍需进行确认（acknowledgement），除非部署者通过 `plugins.enable_warning.enabled=false` 或 `plugins.enable_warning.require_acknowledgement=false` 放宽约束。
- 当前仅支持 `pack-local` 插件，不开放全局安装面。
- 已启用插件的 Web 入口点会被服务器收敛为规范化的同源资源路由，而非直接透传 `dist` 字段。
- 浏览器侧当前通过动态 import 加载 `web_bundle_url`，并在 pack-local 路由宿主 `/packs/:packId/plugins/:pluginId/*` 下挂载路由贡献（route contribution）。
- 推荐插件 Web bundle 默认导出一个运行时模块，对外暴露 `panels[]` 与 `routes[]` 两类贡献。
- 单个插件 panel/route 渲染失败不会影响宿主页面整体稳定性，当前会进入独立的渲染边界/回退界面。
- `/api/packs/:packId/plugins` 当前会返回 `enable_warning` 快照，包含 canonical warning text/hash；GUI enable acknowledgement 会提交这个 hash，后端也会校验其是否与当前 warning text 保持一致。
- canonical warning text 仍由 `PLUGIN_ENABLE_WARNING_TEXT` 定义；GUI 只是消费 runtime snapshot，不自行复制另一份文案来源。
- 推荐插件目录结构：
  - `plugins/<plugin-dir>/plugin.manifest.yaml`
  - `plugins/<plugin-dir>/src/` 或 `plugins/<plugin-dir>/dist/`

## 设计边界
说明哪些行为由 pack 声明控制，哪些仍由平台或 kernel 控制。

## 已知限制
列出当前未覆盖的规则、前端能力缺口、暂未产品化的功能等。

## 版本记录
链接至 `CHANGELOG.md`。

## 作者 / 发布
记录作者、发布日期、许可证及发布说明。
```

---

## 6. 发布者配套内容建议

若 world pack 预期被下载、评估、试用或二次修改，除 README.md 外，建议补充以下内容。

### 6.1 CHANGELOG.md

用于记录：

- 新增的能力、规则、实体
- 世界状态字段的调整
- prompts 或 AI 任务组织的变更
- 客观规则执行（objective enforcement）行为的修改
- 破坏性变更

### 6.2 LICENSE

若 pack 计划用于开放共享、二次分发或商业用途，建议明确许可证。

### 6.3 docs/

当 README.md 篇幅过长时，可将以下内容拆分至 `docs/` 目录：

- 详细的世界设定
- 阵营或角色说明
- 能力与权限矩阵
- 媒介机制详解
- operator 观察视角说明
- 作者的设计理念与扩展计划

### 6.4 assets/

若 pack 用于分发页面、作品页或商店式展示，素材目录建议包含：

- 封面图像
- 图标
- 角色或物件示意图
- 宣传图像
- 授权素材清单

---

## 7. 当前仓库落地规范

基于当前仓库结构，建议采用以下分层方式。

### 7.1 版本管理模板

存放位置：

- `apps/server/templates/world-pack/`

该目录可放置由仓库正式维护的默认模板，例如：

- `death_note.yaml`
- `death_note.README.md`
- `death_note.CHANGELOG.md`
- `pack.README.template.md`
- `pack.CHANGELOG.template.md`

### 7.2 运行时脚手架镜像

存放位置：

- `data/configw/templates/world-pack/`

该目录为启动时会被脚手架（scaffold）复制至本地运行目录的模板镜像。

### 7.3 实际 pack 目录

存放位置：

- `data/world_packs/<pack-dir>/`

该目录建议以项目单元形式存在，至少包含：

- `config.yaml`
- `README.md`

若计划公开发布，建议补充：

- `CHANGELOG.md`
- `docs/`
- `assets/`

---

## 7.4 新建 world pack 项目脚手架命令

当前仓库提供基础脚手架命令：

```bash
pnpm scaffold:world-pack -- --dir my_pack --name "My Pack" --author "Your Name"
```

该命令将在 `data/world_packs/<pack-dir>/` 下创建：

- `config.yaml`
- `README.md`
- `CHANGELOG.md`
- 空目录：`docs/`、`assets/`、`examples/`

常用参数：

- `--dir`：pack 目录名（必填）
- `--id`：`metadata.id`
- `--name`：`metadata.name`
- `--version`：版本号
- `--description`：描述文本
- `--author`：作者（多个作者可用逗号分隔）
- `--homepage` / `--repository` / `--license`
- `--tags`：逗号分隔标签
- `--status`：状态，如 `draft` / `stable` / `template`
- `--overwrite`：覆盖已存在文件
- `--set-preferred`：写入 `data/configw/default.yaml` 中的 `world.preferred_pack`
- `--set-bootstrap-template`：将 `world.bootstrap.target_pack_dir/template_file` 指向新 pack
- `--disable-bootstrap`：将 `world.bootstrap.enabled` 设为 `false`
- `--dry-run`：仅输出将创建的文件与将修改的配置，不执行写入

脚手架还将自动完成以下操作：

- 生成 `LICENSE`（占位模板）
- 生成 `docs/setting.md`
- 生成 `examples/overrides.example.yaml`
- 生成后立即对 `config.yaml` 执行 schema 校验，确保其为可解析的 world pack

## 8. Death Note 作为参考实现

当前仓库中的 `death_note` world pack 可作为首批符合项目化规范的参考实现：

- 运行时合约文件：`data/world_packs/death_note/config.yaml`
- 模板来源：`apps/server/templates/world-pack/death_note.yaml`
- 补充 README.md 后，该 pack 将从 YAML 模板扩展为可阅读、可说明、可发布的 pack 项目单元。