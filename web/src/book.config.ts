export interface PartConfig {
  number: number;
  title: string;
  epigraph: string;
  chapters: number[];
}

export interface ChapterConfig {
  number: number;
  slug: string;
  title: string;
  description: string;
}

export const parts: PartConfig[] = [
  {
    number: 1,
    title: '基础',
    epigraph: '在 agent 能够思考之前，必须先确立流程。',
    chapters: [1, 2, 3, 4],
  },
  {
    number: 2,
    title: '核心循环',
    epigraph: 'agent 的心跳：流式输出、行动、观察、循环。',
    chapters: [5, 6, 7],
  },
  {
    number: 3,
    title: '多 agent 编排',
    epigraph: '单个 agent 很强大，多个 agent 协同工作则能带来变革。',
    chapters: [8, 9, 10],
  },
  {
    number: 4,
    title: '持久化与智能',
    epigraph: '没有记忆的 agent 会永远犯同样的错误。',
    chapters: [11, 12],
  },
  {
    number: 5,
    title: '界面',
    epigraph: '用户看到的一切都要经过这一层。',
    chapters: [13, 14],
  },
  {
    number: 6,
    title: '连接性',
    epigraph: 'agent 的触达范围已超越 localhost。',
    chapters: [15, 16],
  },
  {
    number: 7,
    title: '性能工程',
    epigraph: '让一切都足够快，以至于人类察觉不到背后的机制。',
    chapters: [17, 18],
  },
];

export const chapters: ChapterConfig[] = [
  { number: 1, slug: 'ch01-architecture', title: 'AI Agent 的架构', description: '6 个关键抽象、数据流、权限系统、构建系统' },
  { number: 2, slug: 'ch02-bootstrap', title: '快速启动——引导流水线', description: '5 阶段初始化、模块级 I/O 并行、信任边界' },
  { number: 3, slug: 'ch03-state', title: '状态——双层架构', description: 'Bootstrap 单例、AppState 存储、粘性锁、成本追踪' },
  { number: 4, slug: 'ch04-api-layer', title: '与 Claude 对话——API 层', description: '多provider客户端、提示词缓存、流式传输、错误恢复' },
  { number: 5, slug: 'ch05-agent-loop', title: 'Agent Loop', description: 'query.ts 深度解析、4 层压缩、错误恢复、Token 预算' },
  { number: 6, slug: 'ch06-tools', title: '工具——从定义到执行', description: '工具接口、14 步流水线、权限系统' },
  { number: 7, slug: 'ch07-concurrency', title: '并发工具执行', description: '分区算法、流式执行器、投机执行' },
  { number: 8, slug: 'ch08-sub-agents', title: '生成子智能体（Sub-Agents）', description: 'AgentTool、15 步 runAgent 生命周期、内置智能体类型' },
  { number: 9, slug: 'ch09-fork-agents', title: 'Fork Agent 与提示词缓存', description: '字节级相同前缀技巧、缓存共享、成本优化' },
  { number: 10, slug: 'ch10-coordination', title: '任务、协调与集群', description: '任务状态机、协调器模式、集群通信' },
  { number: 11, slug: 'ch11-memory', title: '记忆——跨会话学习', description: '基于文件的记忆、4 类分类、LLM 召回、陈旧度' },
  { number: 12, slug: 'ch12-extensibility', title: '可扩展性——技能与钩子', description: '两阶段技能加载、生命周期钩子、快照安全' },
  { number: 13, slug: 'ch13-terminal-ui', title: '终端 UI', description: '定制 Ink 分支、渲染流水线、双缓冲、资源池' },
  { number: 14, slug: 'ch14-input-interaction', title: '输入与交互', description: '按键解析、快捷键绑定、组合键支持、Vim 模式' },
  { number: 15, slug: 'ch15-mcp', title: 'MCP——通用工具协议', description: '8 种传输协议、MCP 的 OAuth、工具包装' },
  { number: 16, slug: 'ch16-remote', title: '远程控制与云端执行', description: 'Bridge v1/v2、CCR、上游代理' },
  { number: 17, slug: 'ch17-performance', title: '性能——每一毫秒与每一个 Token 都至关重要', description: '启动、上下文窗口、提示词缓存、渲染、搜索' },
  { number: 18, slug: 'ch18-epilogue', title: '结语——我们学到了什么', description: '5 大架构押注、哪些经验可迁移、Agent 的未来走向' },
];

export function getPartForChapter(chapterNumber: number): PartConfig | undefined {
  return parts.find(p => p.chapters.includes(chapterNumber));
}

export function getChapterNumber(slug: string): number {
  const match = slug.match(/^ch(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

export function getAdjacentChapters(chapterNumber: number) {
  const idx = chapters.findIndex(c => c.number === chapterNumber);
  return {
    prev: idx > 0 ? chapters[idx - 1] : null,
    next: idx < chapters.length - 1 ? chapters[idx + 1] : null,
  };
}

export function isFirstChapterOfPart(chapterNumber: number): boolean {
  return parts.some(p => p.chapters[0] === chapterNumber);
}
