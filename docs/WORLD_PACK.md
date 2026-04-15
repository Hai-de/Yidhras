# World Pack 项目化与发布规范

本文档用于定义 **Yidhras world pack 应如何像一个独立项目一样被组织、描述与发布**。

它不替代运行时 contract；运行时实际读取的仍然是 `config.yaml` / `config.yml` / `pack.yaml` / `pack.yml`。但从作者协作、发布交付、版本管理、二次分发的角度看，一个 world pack 不应只是一份 YAML，而应当具备最基本的项目说明与配套资产。

> 当前代码里，runtime 直接消费的是 pack 配置文件；README、附加文档、素材目录主要服务于作者、发布者、协作者与使用者。

---

## 1. 目标

把 world pack 从“运行时可加载的一份配置”提升为“可被理解、维护、交付、复用、审阅”的项目单元。

一个可发布的 world pack，至少应回答以下问题：

1. 这个包是什么世界？
2. 它想模拟什么主题、规则和张力？
3. 它提供了哪些核心实体、能力、媒介与规则？
4. 运行它需要什么版本、依赖和注意事项？
5. 使用者如何安装、覆盖、二次修改与升级？
6. 发布者如何记录版本变化、兼容性与已知限制？

---

## 1.1 建议纳入 contract 的发布元数据

为了让 world pack 更像“可发布项目”，建议把部分发布信息直接纳入 `metadata`。

当前建议字段包括：

- `metadata.authors`
- `metadata.license`
- `metadata.homepage`
- `metadata.repository`
- `metadata.tags`
- `metadata.compatibility`
- `metadata.published_at`
- `metadata.status`

推荐示例：

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

这些字段主要服务于：

- 发布说明
- 版本兼容性表达
- 前端或 operator 未来展示 pack 信息
- 第三方收录与资产管理

---

## 2. 运行时最小 contract vs 项目化交付物

### 2.1 运行时最小必需

当前 runtime 最少需要以下之一：

- `config.yaml`
- `config.yml`
- `pack.yaml`
- `pack.yml`

它们承载 canonical world-pack contract，例如：

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

### 2.2 项目化发布最小建议

要把 world pack 当成“项目”看待，建议至少包含：

- `config.yaml`：运行时配置与正式 contract
- `README.md`：项目入口说明，**建议视为必备**
- `CHANGELOG.md`：版本演进记录，建议提供
- `assets/`：插图、封面、图标、外部素材等，按需提供
- `docs/`：扩展说明，如设定、能力设计、叙事约束、作者说明

其中：

- `config.yaml` 面向 runtime
- `README.md` 面向人
- `CHANGELOG.md` 面向版本治理
- `assets/` / `docs/` 面向展示、协作与长期维护

---

## 3. 推荐目录结构

一个推荐的 world pack 项目目录如下：

```text
<pack-dir>/
├─ config.yaml
├─ README.md
├─ CHANGELOG.md
├─ LICENSE                  # 可选，但对公开发布很有帮助
├─ assets/                  # 可选
│  ├─ cover.png
│  └─ icon.png
├─ docs/                    # 可选
│  ├─ setting.md
│  ├─ rules.md
│  └─ release-notes.md
└─ examples/                # 可选
   └─ overrides.example.yaml
```

### 目录职责

- `config.yaml`
  - pack 的唯一运行时主配置
  - 用于 schema validate、加载、materialize、runtime 执行
- `README.md`
  - pack 的对外入口页
  - 应让第一次接触该 pack 的人快速理解其用途和边界
- `CHANGELOG.md`
  - 记录版本变化、兼容性变化、breaking changes
- `assets/`
  - 放非代码、非配置的展示素材
- `docs/`
  - 放不适合塞进 README 的详细说明
- `examples/`
  - 放示例 override、示例调用、示例配置片段

---

## 4. README.md 建议作为 world pack 标配

### 4.1 为什么 README 应是标配

如果没有 README，外部使用者通常只能直接阅读 `config.yaml`。这会带来几个问题：

1. YAML 更适合机器消费，不适合作为项目入口说明
2. 发布者的设计意图、题材说明、使用方式难以快速理解
3. 使用者很难判断一个 pack 是否适合当前运行环境
4. 协作者很难在不通读整份 contract 的前提下参与维护
5. 版本升级、兼容性变化、注意事项没有稳定挂载点

因此，README 应被看作 world pack 的 **人类入口契约**。

### 4.2 README 最少应包含什么

建议最少包含以下章节：

1. **Pack 名称与一句话简介**
2. **题材 / 世界前提**
3. **核心机制摘要**
4. **当前版本与兼容性**
5. **目录说明**
6. **如何安装 / 使用 / 启动**
7. **关键实体 / 能力 / 媒介 / 规则概览**
8. **已知限制**
9. **变更记录入口**
10. **作者 / 发布信息**

### 4.3 README 不应承诺超出现实的能力

README 应清晰区分：

- **当前已实现** 的 pack-level 能力
- **未来计划** 支持的能力
- **仍由 kernel 管理** 而非 pack 可声明的能力

例如：如果某项能力尚未在 pack schema/loader 中开放，就不应把它写成“当前 pack 作者可以直接声明”。

---

## 5. 推荐 README 模板结构

```md
# <World Pack Name>

> 一句话说明这个世界包模拟什么。

## 概览
- Pack ID:
- Version:
- 题材:
- 当前状态:
- 兼容的 Yidhras 版本:

## 世界前提
说明这个世界的核心设定、冲突和叙事张力。

## 核心机制
- 实体
- 身份
- 能力
- 媒介
- 客观规则

## 目录结构
说明 `config.yaml`、`assets/`、`docs/` 等目录用途。

## 使用方式
说明如何放入 `data/world_packs/<pack>` 并启动。

## 设计边界
说明哪些行为由 pack 声明，哪些仍由平台/kernel 控制。

## 已知限制
列出当前未覆盖的规则、前端缺口、暂未产品化的能力等。

## 版本记录
链接到 `CHANGELOG.md`。

## 作者 / 发布
记录作者、发布日期、许可证、发布说明。
```

---

## 6. 发布者视角下的配套内容建议

如果 world pack 要被别人下载、评估、试用、二次改造，除了 README，还建议补齐以下内容。

### 6.1 CHANGELOG.md

适合记录：

- 新增能力、规则、实体
- 调整世界状态字段
- 更改 prompts / ai task 组织
- 修改 objective enforcement 行为
- 引入 breaking changes

### 6.2 LICENSE

如果 pack 计划开放共享、二次分发或商业使用，建议明确许可证。

### 6.3 docs/

当 README 已经过长时，把以下内容拆到 `docs/` 更合理：

- 世界设定细则
- 阵营/角色说明
- 能力与权限矩阵
- 媒介机制详解
- operator 观察视角说明
- 作者的设计理念与扩展计划

### 6.4 assets/

如果 pack 最终要做分发页、作品页或商店式展示，素材目录会非常有用：

- 封面
- 图标
- 角色/物件示意图
- 宣传图
- 授权素材清单

---

## 7. 当前仓库中的落地建议

结合当前仓库结构，建议采用以下分层：

### 7.1 版本管理模板

放在：

- `apps/server/templates/world-pack/`

这里应放 **被仓库正式维护的默认模板**，例如：

- `death_note.yaml`
- `death_note.README.md`
- `death_note.CHANGELOG.md`
- `pack.README.template.md`
- `pack.CHANGELOG.template.md`

### 7.2 运行时脚手架镜像

放在：

- `data/configw/templates/world-pack/`

这里是启动时会被 scaffold 到本地运行目录的模板镜像。

### 7.3 实际 pack 目录

放在：

- `data/world_packs/<pack-dir>/`

这里应该像一个小项目一样存在，至少包含：

- `config.yaml`
- `README.md`

如果某个 pack 未来要公开发布，建议继续补齐：

- `CHANGELOG.md`
- `docs/`
- `assets/`

---

## 7.4 新建 world pack 项目脚手架

当前仓库已提供一个基础脚手架命令：

```bash
pnpm scaffold:world-pack -- --dir my_pack --name "My Pack" --author "Your Name"
```

它会在 `data/world_packs/<pack-dir>/` 下创建：

- `config.yaml`
- `README.md`
- `CHANGELOG.md`
- 以及空目录：`docs/`、`assets/`、`examples/`

常用参数：

- `--dir`：pack 目录名，必填
- `--id`：`metadata.id`
- `--name`：`metadata.name`
- `--version`：版本号
- `--description`：描述
- `--author`：作者，多个作者可逗号分隔
- `--homepage` / `--repository` / `--license`
- `--tags`：逗号分隔标签
- `--status`：如 `draft` / `stable` / `template`
- `--overwrite`：覆盖已存在文件
- `--set-preferred`：写入 `data/configw/default.yaml` 的 `world.preferred_pack`
- `--set-bootstrap-template`：把 `world.bootstrap.target_pack_dir/template_file` 指向新 pack
- `--disable-bootstrap`：把 `world.bootstrap.enabled` 写为 `false`
- `--dry-run`：只输出将创建的文件与将修改的配置，不写入磁盘

当前脚手架还会：

- 自动生成 `LICENSE`（占位模板）
- 自动生成 `docs/setting.md`
- 自动生成 `examples/overrides.example.yaml`
- 生成后立即对 `config.yaml` 执行 schema 校验，确保是可解析 world pack

## 8. Death Note 作为当前参考实现

当前仓库里的 `death_note` world pack 可以作为第一批“项目化”参考样板：

- 运行时 contract：`data/world_packs/death_note/config.yaml`
- 模板来源：`apps/server/templates/world-pack/death_note.yaml`
- 建议补充 README，使其不再只是 YAML 样板，而是可阅读、可说明、可发布的 pack 项目

---

## 9. 发布检查清单

发布一个 world pack 前，建议至少确认：

- [ ] `config.yaml` 可以被当前 loader 正确解析
- [ ] `metadata.id`、`name`、`version` 已填写清楚
- [ ] `README.md` 已说明题材、机制、安装方式与限制
- [ ] README 未夸大当前未实现能力
- [ ] 如有 breaking changes，已写入 `CHANGELOG.md`
- [ ] 如有外部素材，已在 `assets/` 与许可证中注明来源
- [ ] 如有复杂规则，已在 `docs/` 中补充说明
- [ ] pack 目录结构足够让第三方接手维护

---

## 10. 一句话结论

**world pack 在运行时是配置，在发布层面应是项目。**

因此，Yidhras 应把 world pack 的最小交付标准从“只有一份 YAML”提升为：

- 一份可运行的 `config.yaml`
- 一份可阅读的 `README.md`
- 一套可持续维护的配套结构（至少为 changelog/docs/assets 留出位置）
