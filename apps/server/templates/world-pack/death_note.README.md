# Death Note World Pack

> 一个围绕规则媒介、侦查对抗、舆论震荡与执行资格传播展开的现代悬疑世界。

## 概览

- Pack ID：`world-death-note`
- 当前目录名建议：`death_note`
- Version：`0.5.0`
- 题材：现代悬疑 / 超自然规则媒介 / 调查对抗
- 当前状态：默认参考样板
- 运行时主配置：`config.yaml`

## 世界前提

该世界以“死亡笔记”作为核心规则媒介。

它不是单纯的剧情背景，而是一个会改变主体能力、资格传播与调查压力的世界治理对象：

- 某些主体可以通过媒介取得正式 capability
- 主体意图会先被表达为 semantic intent，再由服务器侧 Grounder 落地
- 客观规则由 objective enforcement 执行，而不是由 agent 主观直接决定
- 社会面的调查、误导、公开通报会持续反向施压世界状态

## 核心机制

### 1. 核心实体

当前样板内置了：

- 角色主体：夜神月、L、琉克
- 规则媒介实体：死亡笔记
- 世界级状态实体：`__world__`

### 2. 能力与媒介

该 pack 重点展示以下能力链路：

- `invoke.claim_death_note`
- `invoke.learn_notebook_rules`
- `invoke.form_murderous_intent`
- `invoke.collect_target_intel`
- `invoke.select_judgement_target`
- `invoke.execute_death_note`
- `invoke.raise_false_suspicion`
- `invoke.investigate_suspicious_death`
- `invoke.share_case_intel`
- `invoke.request_joint_observation`
- `invoke.publish_case_update`

其中 `mediator-death-note` 作为正式 mediator 参与：

- capability 授予
- authority provenance
- objective enforcement 执行链

### 3. 规则风格

该样板覆盖三类典型路径：

1. **exact**：开放意图直接落地为正式 capability
2. **translated**：开放意图被翻译为更稳定的能力调用
3. **narrativized**：不会改变客观事实，但会保留为真实发生的叙事事件

### 4. 客观执行

`rules.objective_enforcement` 会对以下行为施加世界级结果：

- 取得笔记
- 理解规则
- 形成执行意图
- 收集目标情报
- 选择裁决目标
- 执行死亡笔记
- 调查异常死亡
- 分享案件线索
- 请求联合观察
- 发布案件通告
- 误导调查方向

## 目录说明

推荐把 pack 目录当作一个小项目维护：

```text
death_note/
├─ config.yaml
├─ README.md
├─ CHANGELOG.md
├─ assets/        # 可选
└─ docs/          # 可选
```

当前运行时真正读取的是 `config.yaml`。

`README.md` 与 `CHANGELOG.md` 主要服务于：

- 发布者说明
- 协作者维护
- 外部使用者理解与评估

## 使用方式

### 1. 放置目录

把该 pack 放到：

```text
data/world_packs/death_note/
```

并确保目录下至少有：

- `config.yaml`
- `README.md`

### 2. 启动时脚手架

当前仓库会从版本管理模板自动 scaffold 默认 pack：

- 源模板：`apps/server/templates/world-pack/`
- 运行时模板镜像：`data/configw/templates/world-pack/`
- 实际运行目录：`data/world_packs/death_note/`

### 3. 启动项目

```bash
pnpm --filter yidhras-server prepare:runtime
pnpm --filter yidhras-server dev
```

## 设计边界

这个 world pack 当前适合表达：

- metadata / variables / prompts
- entities / identities / capabilities
- authorities / mediators
- invocation grounding
- objective enforcement
- bootstrap 初始状态
- pack-local storage contract

但它**不应**在 README 中暗示自己已经控制所有平台能力。

例如某些能力如果仍由 kernel 负责，就应明确写成：

- 当前由平台或 kernel 管理
- 尚未开放为 pack-level 可声明 contract
- 属于未来演进方向，而不是现状

## 已知限制

- 当前 operator 高级视图仍可继续增强
- pack README / changelog / docs 更偏向发布与协作资产，runtime 不直接消费
- 如果后续增加更多 pack 项目化字段，应先同步 schema、loader 与文档，再作为正式 contract 对外承诺

## 版本记录

详见：`./CHANGELOG.md`

## 作者 / 发布

- Project：Yidhras
- Pack：Death Note 默认样板
- 用途：默认示例、开发参考、项目化目录样板
