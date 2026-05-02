# TODO

> 本文件只记录用户当前想要最近一段时间的待处理事项，完成后用户会直接移除。
> 稳定架构事实看 `docs/ARCH.md`，业务语义看 `docs/LOGIC.md`，接口契约看 `docs/API.md`，设计/计划/评审过程看 `.limcode/`。

## 当前重点 / Current Focus

### 大型任务

### 插件拓展

- [x] 实现插件加载顺序表 → `apps/server/src/plugins/dependency_resolver.ts` — `resolveLoadOrder()`
- [x] 实现插件之间的依赖确定 → 接口依赖 + 硬依赖 + 反向依赖检查

#### 数据的策略性清洗接口

> 已建立 DataCleaner 统一抽象（`packages/contracts/src/data_cleaner.ts`），全局注册表在 `apps/server/src/plugins/extensions/data_cleaner_registry.ts`。
> 两个内置实现放在系统 pack (`apps/server/builtin/system_pack/`) 中。
> 设计文档: `.limcode/design/plugin-expansion-design.md`

- [x] 1. 正则引擎 → `data_cleaner.regex` — 含 ReDoS 防护（长度限制、嵌套量词检测、超时、匹配计数上限）
- [x] 4. 基础字符串方法 → `data_cleaner.string` — 7 种模式（trim/lowercase/uppercase/collapse_ws/strip_html/strip_control/strip_punctuation）
- [ ] 2. 结构化语法解析器
- [ ] 3. 专用语义提取/验证库
- [ ] 5. 自然语言处理（NLP）与模糊技术
- [ ] 6. 规则引擎与决策流
- [ ] 7. 设计接口让机器学习辅助清洗
- [ ] 8. 向量化字符串操作

#### 测试覆盖

- 23 单元测试（dependency_resolver: 16, data_cleaner_registry: 7）
- 10 集成测试（依赖检查 enable/disable、global-scope、load order）
- 7 e2e 测试（HTTP API 端到端）

###  提示词流水线升级


阶段二的 上下文构建（Context Builder）：
- 项目尚未上线也没有使用者，需要清理上下文构建（Context Builder）中的兼容性别名，且允许提供别名，只要是符合特定的语法（语法设置的方式尚未决定）

#### 阶段三：提示词构建（Prompt Tree V2）

> 预计提示词构建可能不再是模块，而是作为升级为编排内核，内在行为复杂可能有性能问题，可能需要用rust处理

##### 多轮对话
- 实现多轮对话的功能，加入一个内置的slot来容纳
- 这个slot将会容纳对话消息存储，模型回复内容传递，记忆压缩，跨推理因果链条，工具调用，增量上下文构建
- 这个多轮对话的具体的内容会被某些规则控制和修改，不论是压缩还是结构变化
- 需要讨论多轮对话内容的格式的是什么，工具调用记录和内容和还有混入其他奇奇怪怪的东西，组织结构需要讨论
- 给多轮对话的内容打上足够的tag，让其更好的定位，方案未定

思考的问题： 多轮对话中，是否每一次都需要经历整个提示词的流水线？对于一些简单的请求是否也需要经历这么重量级别的提示词流水线？
##### 插槽函数（链表）

- 内置slot既然可以被关闭，那自然可以使用类似的宏语法或者函数名"{{system_core}}"来指代原来已经被禁用的内置slot
- 内置的slot可以被关闭，但始终存在用来定位， slot 定义加入绝对位置和相对位置的动态定位功能，方便其他的动态的slot在slot之间插入和移除
- 引入函数的内联/嵌套/封装/作用域概念，让插槽函数升级为顶层空间，
- 允许在顶级空间之外定义变量作为全局变量，包括宏定义也是
- 高级功能：允许执行（需要图灵完备的）代码，处理： 深度/顺序/触发概率/群组权重/扫描深度/逻辑匹配/始终激活/条件激活/黏性（出发后保留次数）/触发后冷却时间/延迟触发/延迟递归/不可递归/防止进一步递归/无视上下文长度/关键字匹配/向量化触发 等等高级且复杂的功能，尚不确定使用脚本语言lua/js/rust或者是其他方式实现核心模块，但毫无疑问需要被隔离
- 双重模块设置，一个是当前的Prompt Tree V2，另一个是更复杂拥有插槽函数的核心
