# 第9章：Fork Agent 与提示词缓存

## 95% 的洞察

当父 Agent 并行生成五个子 Agent 时，每个子 Agent 的 API 请求中绝大部分内容是完全相同的。系统提示词（System Prompt）相同，工具定义（Tool Definitions）相同，对话历史（Conversation History）相同，触发生成操作的那条助手消息（Assistant Message）也相同。唯一不同的是最后的指令：“你负责数据库迁移”、“你编写测试”、“你更新文档”。

在一次典型的、具有温热对话上下文的 Fork 操作中，共享前缀可能长达 80,000 个 token。而每个子 Agent 的专属指令可能只有 200 个 token。这意味着重叠率高达 99.75%。Anthropic 的提示词缓存（Prompt Cache）对缓存命中的输入 token 提供 90% 的折扣。如果你能让第 2 到第 5 个子 Agent 的请求命中这 80,000 个 token 的缓存，你就能将这四个请求的输入成本降低 90%。对于父 Agent 而言，这就是在同一次并行调度中花费 4 美元与花费 0.50 美元的区别。

关键在于，提示词缓存要求字节级精确匹配（Byte-Exact）。不是“足够相似”，也不是“语义等价”。从系统提示词的第一个字节开始，直到子 Agent 专属内容分叉前的最后一个字节，所有字符必须完全一致。多一个空格、工具定义顺序调整、或者某个过时的功能开关（Feature Flag）导致系统提示词片段发生变化——都会导致缓存未命中（Cache Miss）。整个前缀都将按全价重新处理。

Fork Agent 正是 Claude Code 针对这一约束给出的解决方案。它们不仅仅是“带上下文生成子 Agent”的便利功能——更是一种伪装成编排功能的提示词缓存利用机制。Fork 系统中的每一个设计决策都归结为一个问题：我们如何保证并行子 Agent 之间拥有字节级 identical（完全相同）的前缀？

---

## Fork 子 Agent 继承了什么

Fork Agent 从父 Agent 继承四样东西，且通过引用或字节级精确复制的方式继承，而非重新计算。

**1. 系统提示词。** 不是重新生成——而是直接传递（Threading）。父 Agent 已渲染的系统提示词字节通过 `override.systemPrompt` 传递，数据取自 `toolUseContext.renderedSystemPrompt`。这正是父 Agent 在最近一次 API 调用中发送的确切字符串。

**2. 工具定义。** Fork Agent 的定义声明了 `tools: ['*']`，但由于 `useExactTools` 标志被设为 true，子 Agent 直接接收父 Agent 组装好的工具数组。不进行过滤，不重新排序，也不重新序列化。

**3. 对话历史。** 父 Agent 与 API 交换过的每一条消息——用户轮次、助手轮次、工具调用、工具返回结果——都通过 `forkContextMessages` 克隆到子 Agent 的上下文中。

**4. 思考配置与模型。** Fork 定义指定 `model: 'inherit'`，这会解析为父 Agent 使用的确切模型。相同的模型意味着相同的分词器（Tokenizer）、相同的上下文窗口以及相同的缓存命名空间。

Fork Agent 的定义本身极其精简——几乎是一个空操作（No-op）：

Fork Agent 的定义刻意保持极简——它从父 Agent 继承一切。它指定使用所有工具（`'*'`），继承父 Agent 的模型，使用冒泡模式（Bubble Mode）处理权限（以便提示在父 Agent 的终端中显示），并提供一个实际上从未被调用的空操作系统提示词函数——真正的提示词通过覆盖通道（Override Channel）到达，且已渲染完毕并保持字节级稳定。

---

## 字节级相同前缀的技巧

发往 Claude 的 API 请求具有特定结构：先是系统提示词，然后是工具，最后是消息。要使提示词缓存命中，从请求开始到某个前缀边界的每一个字节在所有请求中必须完全相同。

Fork Agent 通过确保三个层级被“冻结”来实现这一点：

**层级 1：通过传递而非重算来固定系统提示词。**

当父 Agent 的系统提示词为其上一次 API 调用进行渲染时，结果被保存在 `toolUseContext.renderedSystemPrompt` 中。这是经过所有动态插值后的字符串——包括 GrowthBook 功能开关、环境详情、MCP 服务器描述、技能内容以及 CLAUDE.md 文件。Fork 子 Agent 接收的正是这个确切的字符串。

为什么不直接再次调用 `getSystemPrompt()`？因为系统提示词的生成不是纯函数（Not Pure）。随着 SDK 获取远程配置，GrowthBook 开关会从冷状态过渡到热状态。在父 Agent 第一轮对话中返回 `false` 的开关，可能在 Fork 子 Agent 启动时变为 `true`。如果系统提示词包含受该开关控制的条件块，重新渲染的提示词哪怕只相差一个字符，缓存就会失效。结果是 80,000 个 token 乘以五个子 Agent 全部按全价重新处理。

直接传递已渲染的字节消除了这一整类分歧风险。

**层级 2：通过精确透传来固定工具定义。**

普通子 Agent 会经过 `resolveAgentTools()` 处理，该函数根据 Agent 定义中的 `tools` 和 `disallowedTools` 数组过滤工具池，应用权限模式差异，并可能重新排序工具。最终序列化的工具数组将与父 Agent 的不同——子集不同、顺序不同、权限注解也不同。

Fork Agent 完全跳过此过程：

```typescript
const resolvedTools = useExactTools
  ? availableTools  // 父 Agent 的确切数组
  : resolveAgentTools(agentDefinition, availableTools, isAsync).resolvedTools
```

`useExactTools` 标志仅在 Fork 路径上设为 true。子 Agent 原样获取父 Agent 的工具池。相同的工具、相同的顺序、相同的序列化。这包括保留子 Agent 工具池中的 Agent 工具本身，尽管子 Agent 被禁止使用它——移除它会改变工具数组从而导致缓存失效。

**层级 3：消息数组的构建。**

这是 `buildForkedMessages()` 发挥其精细作用的地方。该函数构建位于共享历史与子 Agent 专属指令之间的最后两条消息：

`buildForkedMessages()` 函数构建位于共享历史与子 Agent 专属指令之间的最后两条消息。算法如下：

1. 克隆父 Agent 的助手消息（保留所有带有原始 ID 的 `tool_use` 块）。
2. 为每个 `tool_use` 块创建一个 `tool_result`，其中包含一个常量占位符字符串（在所有子 Agent 间完全相同）。
3. 构建一条单独的用户消息，包含所有占位符结果，后跟包裹在样板标签（Boilerplate Tag）中的子 Agent 专属指令。
4. 返回 `[clonedAssistantMessage, userMessageWithPlaceholdersAndDirective]`。

```typescript
// 伪代码 — 展示消息构建逻辑
function buildChildMessages(directive, parentAssistant) {
  const cloned = cloneMessage(parentAssistant)
  const placeholders = parentAssistant.toolUseBlocks.map(b =>
    toolResult(b.id, CONSTANT_PLACEHOLDER)  // 在所有子 Agent 间字节级相同
  )
  const userMsg = createUserMessage([...placeholders, wrapDirective(directive)])
  return [cloned, userMsg]
}
```

每个子 Agent 最终的消息数组如下所示：

```
[...shared_history, assistant(all_tool_uses), user(placeholder_results..., directive)]
```

指令之前的每个元素在所有子 Agent 间都是相同的。`FORK_PLACEHOLDER_RESULT` —— 一个常量字符串 `'Fork started -- processing in background'` —— 确保即使是工具结果块也是字节级相同的。`tool_use_id` 值相同，因为它们引用的是同一条助手消息。只有包含子 Agent 专属指令的最后一个文本块有所不同。

缓存边界恰好落在最后一个文本块之前。其上方的所有内容——可能包含数万 token 的系统提示词、工具定义、对话历史和占位符结果——对于第一个之后的每个子 Agent 都能以 90% 的折扣命中缓存。

---

## Fork 样板标签

每个子 Agent 的指令都被包裹在一个样板 XML 标签中，该标签有两个作用：指导子 Agent 的行为，以及作为递归 Fork 检测的标记。

样板内容包含大约 10 条规则。关键规则如下：

- **覆盖父 Agent 的 Fork 指令。** 父 Agent 的系统提示词写着“默认使用 Fork”——样板明确告诉子 Agent：“那条指令是给父 Agent 的。你就是 Fork。不要生成子 Agent。”
- **静默执行，一次性汇报。** 工具调用之间不包含对话文本。直接使用工具，然后生成结构化摘要。
- **严守范围。** 子 Agent 不得超出其指令范围。
- **结构化输出格式。** 响应必须遵循“范围/结果/关键文件/变更文件/问题”模板，这使得当多个子 Agent 同时汇报时，父 Agent 更容易解析结果。

规则 1 尤为有趣。出于缓存原因被子 Agent 逐字继承的父 Agent 系统提示词中包含诸如“有并行工作时默认使用 Fork”的指令。如果子 Agent 遵循该指令，它会尝试生成自己的子 Agent，从而造成 Agent 的无限递归。样板明确覆盖了这一点：“那条指令是给父 Agent 的。你就是 Fork。”

结构化输出格式（范围/结果/关键文件/变更文件/问题）并非装饰性的。它将子 Agent 的输出限制为事实性报告，这使得当五个子 Agent 同时汇报时，父 Agent 更容易解析和汇总结果。

---

## 防止递归 Fork

Fork 子 Agent 的工具池中保留了 Agent 工具。它必须保留——移除它会改变序列化的工具数组并破坏提示词缓存。但如果子 Agent 在没有 `subagent_type` 的情况下实际调用了 Agent 工具，Fork 路径将再次触发，创建孙代 Fork。这个孙代会继承更大的上下文（父+子对话），生成它自己的 Fork，依此类推。

两道防线阻止了这种情况：

**主要防线：querySource 检查。** 当生成 Fork 子 Agent 时，其 `context.options.querySource` 被设为 `'agent:builtin:fork'`。`call()` 方法在允许进入 Fork 路径前会检查此项：

```typescript
// 在 AgentTool.call() 中：
if (effectiveType === undefined) {
  // Fork 路径 -- 但我们是否已经处于 Fork 中？
  if (querySource === 'agent:builtin:fork') {
    // 拒绝：已经是 Fork 子 Agent
  }
}
```

这是快速路径。它仅检查选项对象中的一个字符串。

**备用防线：消息扫描。** Fork 防护使用两道防线：生成时设置的 `querySource` 标签（快速路径——单次字符串比较），以及扫描消息历史中样板 XML 标签的备用机制。备用机制存在的原因是 `querySource` 能在自动压缩（Autocompact）中保留，但在未能正确传递 `querySource` 的边缘情况下，消息扫描备用机制能捕获递归。这是一种“双重保险”策略，因为检查成本（扫描消息）与意外递归 Fork 的成本（失控的 API 支出）相比微不足道。

为什么需要备用防线？因为 Claude Code 具有自动压缩功能，当上下文过长时会重写消息数组。自动压缩可以重写消息内容，但会在选项中保留 `querySource`。理论上，仅靠 `querySource` 就足够了。实际上，消息扫描备用机制捕获了 `querySource` 未被正确传递的边缘情况——这是一种双重保险策略，其中检查成本（扫描消息）与意外递归 Fork 的成本（失控的 API 支出）相比微不足道。

---

## 同步到异步的转换

Fork 子 Agent 最初在前台运行：其消息流式传输到父 Agent 的终端，父 Agent 阻塞等待完成。但如果子 Agent 耗时过长怎么办？Claude Code 允许在执行过程中转入后台——用户（或自动超时机制）可以将正在运行的前台 Agent 推入后台，而不会丢失任何工作。

该机制出奇地简洁：

1. 当通过 `registerAgentForeground()` 注册前台 Agent 时，会创建一个后台信号 Promise。

2. 父 Agent 的同步循环在 Agent 的消息流与后台信号之间进行竞速：

```
while (true) {
  const result = await Promise.race([
    iterator.next(),         // 来自 Agent 的下一条消息
    backgroundSignal,        // “转入后台”触发器
  ])
  if (result === BACKGROUND_SIGNAL) break
  // ... 处理消息
}
```

3. 当后台信号触发时，前台迭代器通过 `iterator.return()` 优雅终止。这会触发生成器的 `finally` 块，处理清理工作。

4. 使用相同的 Agent ID 和迄今为止累积的消息历史，生成一个新的 `runAgent()` 实例，并设置 `isAsync: true`。Agent 从断点处继续，现在在后台运行。

5. 原始的同步 `call()` 返回 `{ status: 'async_launched' }`，父 Agent 继续其对话。

没有工作丢失，因为消息历史就是 Agent 的状态。磁盘上的侧链转录（Sidechain Transcript）包含了 Agent 生成的每一条消息。新的异步实例从此转录重放，并从同步实例停止的地方接续。

---

## 自动转入后台

当启用 `CLAUDE_AUTO_BACKGROUND_TASKS` 环境变量或 `tengu_auto_background_agents` GrowthBook 开关时，前台 Agent 将在 120 秒后自动转入后台：

当通过环境变量或功能开关启用时，前台 Agent 将在 120 秒后自动转入后台。禁用时，该函数返回 0（无自动后台化）。

这是一个涉及成本考量的用户体验决策。前台 Agent 会阻塞父终端——用户无法输入、无法发出新指令、无法生成其他 Agent。两分钟的时间足以让 Agent 同步完成大多数快速任务（此时流式输出是有用的反馈），但又足够短，以至于长时间运行的任务不会“劫持”终端。

在 Fork 实验下，自动后台化的问题已不复存在：所有 Fork 生成的 Agent 从一开始就被强制设为异步。`run_in_background` 参数完全从 Schema 中隐藏。每个 Fork 子 Agent 都在后台运行，完成后通过 `<task-notification>` 汇报，父 Agent 永远不会阻塞。

---

## 何时不使用 Fork

Fork 是多种编排模式之一，在以下三种情况下会被刻意排除：

**协调者模式（Coordinator Mode）。** 协调者模式与 Fork 模式互斥。协调者拥有结构化的委派模型：它维护计划，使用明确的提示词向工作者分配任务，并跟踪进度。Fork 的“继承一切”方法会破坏这一点。被 Fork 的协调者会继承父协调者的系统提示词（其中写着“你是协调者，请委派工作”），子 Agent 会尝试进行编排而不是执行。`isForkSubagentEnabled()` 函数首先检查 `isCoordinatorMode()`，如果处于活动状态则返回 false。

**非交互式会话。** SDK 和 API 使用者（`--print` 模式、Claude Agent SDK）在没有终端的情况下运行。Fork 的 `permissionMode: 'bubble'` 会将权限提示浮现到父终端——这在非交互模式下是不存在的。与其构建单独的权限流程，不如直接禁用 Fork 路径。SDK 使用者改用显式的 `subagent_type` 选择。

**显式 subagent_type。** 当模型指定了 `subagent_type`（例如 `"Explore"`、`"Plan"`、`"general-purpose"`）时，不会触发 Fork 路径。Fork 仅在省略 `subagent_type` 时触发。这让模型能够在“我想要一个拥有独立系统提示词和工具集的专用 Agent”（显式类型）与“我想要一个继承上下文的自身克隆体来并行处理此事”（省略类型）之间做出选择。

---

## 经济效益

考虑一个具体场景。开发者要求 Claude Code 重构一个模块。父 Agent 分析代码库，制定计划，并并行派发五个 Fork 子 Agent：一个更新数据库架构，一个重写服务层，一个更新路由，一个修复测试，一个更新类型定义。

在对话的这一节点，共享上下文相当可观：
- 系统提示词：约 4,000 token
- 工具定义（40+ 工具）：约 12,000 token
- 对话历史（分析 + 规划）：约 30,000 token
- 包含五个 tool_use 块的助手消息：约 2,000 token
- 占位符工具结果：约 500 token

总共享前缀：约 48,500 token。每个子 Agent 的指令：约 200 token。

如果不使用 Fork（五个独立 Agent，各自拥有全新上下文和自己的系统提示词）：
- 每个子 Agent 处理自己的系统提示词 + 工具 + 任务提示词
- 无缓存共享（不同的系统提示词，不同的工具集）
- 成本：5 × 全价输入处理

使用 Fork（字节级相同前缀）：
- 子 Agent 1：48,700 token 按全价计费（首次请求缓存未命中）
- 子 Agent 2-5：48,500 token 按 10% 价格计费（缓存命中）+ 每个 200 token 按全价计费
- 子 Agent 2-5 的有效成本：每个约 4,850 + 200 = 约 5,050 token 当量

节省幅度随上下文大小和子 Agent 数量扩展。对于一个拥有 100K token 历史并生成 8 个并行 Fork 的温热会话，缓存节省可超过未共享时输入 token 成本的 90%。

这就是为什么 Fork 系统中的每一个设计决策——传递而非重算、精确的工具透传、占位符结果，甚至在子 Agent 被禁止使用的情况下仍保留 Agent 工具——都是为了优化一件事：字节级相同的前缀。每个决策都以牺牲少量的优雅性或安全性为代价，换取 API 成本的可衡量降低。

---

## 设计张力

Fork 系统做出了明确的权衡，理解这些权衡很有价值：

**隔离性 vs. 缓存效率。** Fork 子 Agent 继承一切，包括可能与其任务无关的对话历史。重写测试的子 Agent 不需要父 Agent 讨论数据库架构设计的 15 条消息。但包含这些消息正是使前缀相同的关键。剥离无关历史虽能节省上下文窗口空间，但代价是破坏缓存。该设计的赌注是：缓存节省的收益大于上下文开销。

**安全性 vs. 缓存效率。** 尽管子 Agent 绝不能使用 Agent 工具，但它仍保留在 Fork 子 Agent 的工具池中。移除它会更安全（子 Agent 甚至无法尝试 Fork），但这会改变工具数组的序列化。样板标签和递归 Fork 防护是补偿性控制措施——用运行时预防代替静态移除。

**简洁性 vs. 缓存效率。** 占位符工具结果是一种“谎言”。无论父 Agent 助手消息中的 `tool_use` 块实际做了什么，子 Agent 看到的都是 `'Fork started -- processing in background'`。这没问题，因为子 Agent 的指令告诉了它该做什么——它不需要父 Agent 调度轮次中准确的工具结果。但这意味着子 Agent 的对话历史在技术上是不连贯的。选择该占位符是为了简洁和统一，而非准确性。

这些权衡中的每一个都反映了同样的优先级：当你大规模按 token 支付 API 调用费用时，为了获得字节级相同的前缀，值得对架构进行调整。

---

## 实践应用：为提示词缓存效率而设计

Fork Agent 模式具有超越 Claude Code 的普适性。任何从同一上下文派发多个并行 LLM 调用的系统都可以从感知缓存的请求构建中受益。原则如下：

**1. 传递已渲染的提示词，不要重新计算。** 如果你的系统提示词包含任何动态内容——功能开关、时间戳、用户偏好、A/B 测试变体——请捕获渲染结果并按值传递给子级。重新计算会带来分歧风险。

**2. 冻结工具数组。** 如果你的子级需要不同的工具集，你就放弃了工具块上的缓存共享。考虑保留完整的工具集，并使用运行时防护（如 Fork 样板中的“不要使用 Agent”）代替编译时移除。

**3. 最大化共享前缀，最小化子级后缀。** 组织你的消息数组，使所有共享内容排在前面，子级专属内容追加在最后。交错排列共享内容和子级内容会碎片化缓存边界。

**4. 对可变内容使用常量占位符。** 当消息结构需要对先前工具调用的响应时，在所有子级间使用相同的占位符字符串，而不是实际的（会有分歧的）结果。

**5. 测算盈亏平衡点。** 缓存共享有开销：每个子级的上下文窗口更大（携带无关历史）、运行时防护代替静态安全、架构复杂性。计算你的并行模式（多少个子级、多大的共享前缀）在计入额外的上下文 token 后是否真的省钱。

Fork Agent 系统本质上是一个提示词缓存利用引擎。它回答了每个多 Agent 系统构建者终将面临的问题：当缓存对重复前缀提供 90% 折扣时，你愿意在多大程度上重构你的架构来获取该折扣？Claude Code 的答案是：非常大。
