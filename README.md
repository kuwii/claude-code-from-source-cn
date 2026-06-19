# Claude Code 源码解析

**Anthropic AI 编程 Agent 的架构、模式与内部机制**

<p align="center">
  <img src="./web/public/cover.jpg" alt="Claude Code from Source — Book Cover" width="400" />
  <br/><br/>
  <a href="https://claude-code-from-source.com"><strong>在 claude-code-from-source.com 在线阅读</strong></a>
</p>

---

> **本仓库纯属教育用途。** 其中不包含任何 Claude Code 的源代码——连一行都没有。所有代码块均为原创伪代码，旨在阐释架构模式。其目标是帮助工程师理解生产级 AI Agent 的构建方式，而非复现或重新分发专有软件。

---

当 Anthropic 在 npm 上发布 Claude Code 时，`.js.map` source map 文件中的 `sourcesContent` 字段包含了完整的原始 TypeScript 代码。本书正是研究该架构的成果，将其中的模式、权衡和设计决策提炼为可供任何工程师学习的技术叙事。

**7 个部分，共 18 章。** 印刷版约 400 页。

每一章都具有分层深度：面向技术负责人的叙事流、面向实现者的深入剖析章节，以及提取可迁移模式以供你应用到自身系统的 **“应用实践”** 结语。图表使用 [Mermaid](https://mermaid.js.org/) 绘制，可在 GitHub 上原生渲染。

---

## 适用人群

- **构建 Agentic 系统的高级工程师** —— 借鉴模式，理解权衡，在自己的技术栈中落地实现
- **评估架构的技术负责人** —— 无需阅读每个代码块即可跟随叙事脉络
- **对生产级 AI 工具底层实际运作原理感兴趣的任何人**

---

## 目录

### 第一部分：基础
*在 Agent 能够思考之前，进程必须先存在。*

| # | 章节 | 你将学到什么 |
|---|---------|-------------------|
| 1 | [AI Agent 的架构](./book/ch01-architecture.md) | 6 个关键抽象、数据流、权限系统、构建系统 |
| 2 | [快速启动——引导流水线](./book/ch02-bootstrap.md) | 5 阶段初始化、模块级 I/O 并行、信任边界 |
| 3 | [状态——双层架构](./book/ch03-state.md) | Bootstrap 单例、AppState Store、Sticky Latch、成本追踪 |
| 4 | [与 Claude 对话——API 层](./book/ch04-api-layer.md) | 多 Provider 客户端、Prompt Cache、Streaming、错误恢复 |

### 第二部分：核心循环
*Agent 的心跳：流式输出、执行、观察、重复。*

| # | 章节 | 你将学到什么 |
|---|---------|-------------------|
| 5 | [Agent Loop](./book/ch05-agent-loop.md) | query.ts 深度解析、4 层压缩、错误恢复、Token 预算 |
| 6 | [工具——从定义到执行](./book/ch06-tools.md) | Tool 接口、14 步流水线、权限系统 |
| 7 | [并发工具执行](./book/ch07-concurrency.md) | 分区算法、Streaming Executor、推测执行 |

### 第三部分：Multi-Agent 编排
*单个 Agent 很强大，多个 Agent 协同工作则具有变革性。*

| # | 章节 | 你将学到什么 |
|---|---------|-------------------|
| 8 | [生成子智能体（Sub-Agents）](./book/ch08-sub-agents.md) | AgentTool、15 步 runAgent 生命周期、内置 Agent 类型 |
| 9 | [Fork Agent 与提示词缓存](./book/ch09-fork-agents.md) | 字节级相同前缀技巧、Cache 共享、成本优化 |
| 10 | [任务、协调与集群](./book/ch10-coordination.md) | 任务状态机、Coordinator 模式、Swarm 消息传递 |

### 第四部分：持久化与智能
*没有记忆的 Agent 会永远重蹈覆辙。*

| # | 章节 | 你将学到什么 |
|---|---------|-------------------|
| 11 | [记忆——跨会话学习](./book/ch11-memory.md) | 基于文件的 Memory、4 类分类法、LLM Recall、陈旧度检测 |
| 12 | [可扩展性——技能与钩子](./book/ch12-extensibility.md) | 两阶段 Skill 加载、Lifecycle Hook、快照安全机制 |

### 第五部分：交互界面
*用户看到的一切都经过这一层。*

| # | 章节 | 你将学到什么 |
|---|---------|-------------------|
| 13 | [终端 UI](./book/ch13-terminal-ui.md) | 自定义 Ink Fork、渲染流水线、双缓冲、资源池 |
| 14 | [输入与交互](./book/ch14-input-interaction.md) | 按键解析、快捷键绑定、组合键支持、Vim 模式 |

### 第六部分：连接能力
*Agent 的能力延伸至 localhost 之外。*

| # | 章节 | 你将学到什么 |
|---|---------|-------------------|
| 15 | [MCP——通用工具协议](./book/ch15-mcp.md) | 8 种传输方式、MCP OAuth、Tool 封装 |
| 16 | [远程控制与云端执行](./book/ch16-remote.md) | Bridge v1/v2、CCR、上游代理 |

### 第七部分：性能工程
*让一切足够快，以至于人类察觉不到底层机制的存在。*

| # | 章节 | 你将学到什么 |
|---|---------|-------------------|
| 17 | [性能——每一毫秒与每一个 Token 都至关重要](./book/ch17-performance.md) | 启动速度、Context Window、Prompt Cache、渲染、搜索 |
| 18 | [结语——我们学到了什么](./book/ch18-epilogue.md) | 5 个架构赌注、可迁移的经验、Agent 的未来走向 |

---

## 使其生效的 10 大模式

如果你只读这些内容：

1.  **AsyncGenerator 作为 Agent Loop** —— yield Message，类型化的 Terminal 返回值，天然支持背压和取消
2.  **推测 Tool 执行** —— 在模型 Streaming 期间、响应完成之前即启动只读 Tool
3.  **并发安全的批处理** —— 按安全性对 Tool 分区，并行执行读取操作，序列化写入操作
4.  **Fork Agent 实现 Cache 共享** —— 并行子 Agent 共享字节级相同的 Prompt 前缀，节省约 95% 的输入 Token
5.  **4 层 Context 压缩** —— snip、microcompact、collapse、autocompact —— 逐层轻量级压缩
6.  **基于文件的 Memory 配合 LLM Recall** —— 通过 Sonnet Side-query 选择相关记忆，而非关键词匹配
7.  **两阶段 Skill 加载** —— 启动时仅加载 frontmatter，调用时才加载完整内容
8.  **Sticky Latch 保障 Cache 稳定性** —— Beta Header 一旦发送，会话中途绝不取消设置
9.  **Slot Reservation** —— 默认 8K 输出上限，触发时提升至 64K（在 99% 的请求中节省 Context）
10. **Hook Config 快照** —— 启动时冻结配置，防止运行时注入攻击

---

## 本书是如何制作的

源码提取自 npm source map。36 个 AI Agent 分四个阶段分析了近两千个 TypeScript 文件：

1.  **探索**：6 个并行 Agent 读取源码树中的每个文件
2.  **分析**：12 个 Agent 编写了 494KB 的原始技术文档
3.  **撰写**：15 个 Agent 将所有内容从头改写为叙事情节章节
4.  **审校与修订**：3 位编辑审稿人产出了 900 行反馈；3 个修订 Agent 应用了所有修正

整个流程——从源码提取到最终修订版成书——耗时约 6 小时。

---

## 免责声明

**本仓库不包含任何 Claude Code 的源代码。** 所有代码块均为使用不同变量名的原创伪代码，旨在阐释架构模式。不包含任何专有的 Prompt 文本、内部常量或确切的函数实现。本项目纯粹出于教育目的——帮助工程师理解生产级 AI 编程 Agent 背后的设计模式。

"NO'REILLY" 封面仅为说明目的的恶搞/Meme。本项目与 O'Reilly Media 无任何关联。螃蟹就只是一只螃蟹。

这是一项独立分析。Claude Code 是 Anthropic 的产品。本书与 Anthropic 无关，未获其背书或赞助。