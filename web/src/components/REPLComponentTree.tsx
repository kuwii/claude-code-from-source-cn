import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";

// --- Types ---

interface ComponentNode {
  id: string;
  name: string;
  description: string;
  lines: string;
  keyProps: string[];
  reRenderTriggers: string[];
  isHotPath: boolean;
  children?: ComponentNode[];
}

// --- Data ---

const componentTree: ComponentNode = {
  id: "repl",
  name: "REPL",
  description:
    "整个交互体验的根协调器。包含约 9 个部分：imports、feature flags、状态管理、QueryGuard、消息处理、工具权限流程、会话管理、快捷键设置以及渲染树。全程由 React Compiler 编译。",
  lines: "~5,000",
  keyProps: ["bootstrapState", "commands", "history", "sessionId"],
  reRenderTriggers: [
    "消息流 token",
    "工具使用状态变更",
    "权限对话框打开/关闭",
    "输入模式变更",
  ],
  isHotPath: true,
  children: [
    {
      id: "message-list",
      name: "VirtualMessageList",
      description:
        "通过虚拟滚动渲染对话消息。仅挂载视口内可见的消息及缓冲区消息。按消息缓存高度，在终端列宽变化时失效。包含用于搜索导航的跳转句柄。",
      lines: "~800",
      keyProps: ["messages", "scrollTop", "viewportHeight", "searchQuery"],
      reRenderTriggers: [
        "新增消息",
        "滚动位置变化",
        "搜索高亮更新",
      ],
      isHotPath: true,
      children: [
        {
          id: "user-message",
          name: "UserMessage",
          description:
            "用户输入块。包裹在 MessageRow 中。包含提示词文本及所有附带的图片。",
          lines: "~150",
          keyProps: ["content", "images", "index"],
          reRenderTriggers: ["仅在挂载时（静态内容）"],
          isHotPath: false,
        },
        {
          id: "assistant-message",
          name: "StreamingMarkdown",
          description:
            "流式输出的模型 Markdown 内容。通过模块级 LRU（500 条）进行 token 缓存。针对纯文本的快速路径检测可绕过 GFM 解析器。通过 React Suspense 实现语法高亮的懒加载。",
          lines: "~400",
          keyProps: ["content", "isStreaming", "highlight"],
          reRenderTriggers: [
            "每个新 token（10-50/秒）",
            "语法高亮解析完成",
          ],
          isHotPath: true,
        },
        {
          id: "tool-result",
          name: "ToolUseBlock",
          description:
            "工具执行结果。显示工具名称、状态（运行中/已完成/错误）及可折叠的输出内容。运行期间包含耗时计数器。",
          lines: "~300",
          keyProps: ["toolName", "status", "result", "elapsed"],
          reRenderTriggers: [
            "状态变更（运行中->已完成）",
            "耗时计时器跳动",
          ],
          isHotPath: false,
        },
        {
          id: "offscreen-freeze",
          name: "OffscreenFreeze",
          description:
            "性能优化：当消息滚动到视口上方时，缓存 React element 并冻结子树。防止屏外消息中基于定时器的更新（如加载动画、耗时计数器）触发终端重置。",
          lines: "~60",
          keyProps: ["isVisible", "children"],
          reRenderTriggers: ["仅在可见性变化时"],
          isHotPath: false,
        },
      ],
    },
    {
      id: "input-area",
      name: "PromptInput",
      description:
        "支持快捷键、vim 模式和自动补全的文本输入框。管理插入/普通模式状态、光标位置及多行编辑。",
      lines: "~600",
      keyProps: ["mode", "value", "cursorPosition", "vimState"],
      reRenderTriggers: ["每次按键", "模式变更（insert/normal/vim）"],
      isHotPath: true,
      children: [
        {
          id: "prompt-line",
          name: "PromptLine",
          description:
            '带模式指示器的 ">" 提示符。显示当前模式（insert/normal/vim）、待处理的组合键前缀及模型名称。',
          lines: "~80",
          keyProps: ["mode", "pendingChord", "modelName"],
          reRenderTriggers: ["模式变更", "组合键状态变更"],
          isHotPath: false,
        },
        {
          id: "multi-line-editor",
          name: "MultiLineEditor",
          description:
            "处理多行输入的文本编辑器组件。通过 useDeclaredCursor 声明光标以支持 IME/CJK。具备字素边界感知的自动换行功能。",
          lines: "~350",
          keyProps: ["value", "cursor", "selection", "wrap"],
          reRenderTriggers: ["每次按键", "选区变化"],
          isHotPath: true,
        },
      ],
    },
    {
      id: "status-bar",
      name: "StatusLine",
      description:
        "底部状态栏，显示模型名称、累计成本、token 数量及后台任务指示器。在每次 API 响应返回新的 token/成本数据时更新。",
      lines: "~120",
      keyProps: ["model", "cost", "tokens", "activeTasks"],
      reRenderTriggers: ["API 响应（成本/token 更新）", "任务状态变更"],
      isHotPath: false,
    },
    {
      id: "permission-prompt",
      name: "PermissionRequest",
      description:
        "用于工具权限审批的模态对话框。显示工具名称、描述及建议的权限。通过 Confirmation context 处理 y/n/a（允许一次/拒绝/始终允许）快捷键。",
      lines: "~250",
      keyProps: ["toolName", "description", "suggestions", "onAllow", "onDeny"],
      reRenderTriggers: ["新的权限请求"],
      isHotPath: false,
    },
    {
      id: "keybinding-setup",
      name: "KeybindingSetup",
      description:
        "连接快捷键提供者：GlobalKeybindingHandlers、CommandKeybindingHandlers、CancelRequestHandler。管理上下文注册及组合键拦截器。",
      lines: "~200",
      keyProps: ["bindings", "contexts", "handlers"],
      reRenderTriggers: ["上下文激活/停用"],
      isHotPath: false,
    },
    {
      id: "logo-header",
      name: "LogoHeader",
      description:
        "带有 Claude 品牌标识、模型信息及会话 ID 的会话头部。在消息列表顶部仅渲染一次。",
      lines: "~40",
      keyProps: ["sessionId", "model"],
      reRenderTriggers: ["仅在挂载时"],
      isHotPath: false,
    },
  ],
};

const dataFlowSteps = [
  { from: "input-area", label: "用户输入并按下回车" },
  { from: "repl", label: "REPL 携带消息调用 query()" },
  { from: "assistant-message", label: "Token 流入 StreamingMarkdown" },
  { from: "tool-result", label: "工具调用时出现工具使用块" },
  { from: "status-bar", label: "StatusLine 更新成本/token 计数" },
  { from: "message-list", label: "VirtualMessageList 滚动到底部" },
];

// --- Helpers ---

function useDarkMode() {
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const check = () =>
      setIsDark(document.documentElement.classList.contains("dark"));
    check();
    window.addEventListener("theme-changed", check);
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => {
      window.removeEventListener("theme-changed", check);
      observer.disconnect();
    };
  }, []);
  return isDark;
}

function flattenTree(node: ComponentNode): ComponentNode[] {
  const result: ComponentNode[] = [node];
  if (node.children) {
    for (const child of node.children) {
      result.push(...flattenTree(child));
    }
  }
  return result;
}

// --- Component ---

interface Props {
  className?: string;
}

export default function REPLComponentTree({ className }: Props) {
  const isDark = useDarkMode();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    new Set(["repl", "message-list", "input-area"])
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showDataFlow, setShowDataFlow] = useState(false);
  const [dataFlowStep, setDataFlowStep] = useState(-1);
  const dataFlowTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const colors = {
    text: isDark ? "#f5f4ed" : "#141413",
    textSecondary: "#87867f",
    cardBg: isDark ? "#1e1e1c" : "#ffffff",
    cardBorder: isDark ? "#333" : "#e8e6dc",
    terracotta: "#d97757",
    terracottaBg: isDark
      ? "rgba(217, 119, 87, 0.15)"
      : "rgba(217, 119, 87, 0.08)",
    surfaceBg: isDark ? "#141413" : "#f5f4ed",
    hotPath: isDark ? "rgba(237, 161, 0, 0.15)" : "rgba(237, 161, 0, 0.08)",
    hotPathBorder: "#eda100",
    treeLine: isDark ? "#444" : "#d4d2c8",
    selectedBg: isDark
      ? "rgba(217, 119, 87, 0.12)"
      : "rgba(217, 119, 87, 0.06)",
  };

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleDataFlow = useCallback(() => {
    if (showDataFlow) {
      setShowDataFlow(false);
      setDataFlowStep(-1);
      if (dataFlowTimerRef.current) {
        clearInterval(dataFlowTimerRef.current);
        dataFlowTimerRef.current = null;
      }
      return;
    }

    setShowDataFlow(true);
    setDataFlowStep(0);
    // Expand all nodes to show the flow
    setExpandedIds(
      new Set(flattenTree(componentTree).map((n) => n.id))
    );

    let step = 0;
    dataFlowTimerRef.current = setInterval(() => {
      step++;
      if (step >= dataFlowSteps.length) {
        if (dataFlowTimerRef.current) {
          clearInterval(dataFlowTimerRef.current);
          dataFlowTimerRef.current = null;
        }
        return;
      }
      setDataFlowStep(step);
    }, 1200);
  }, [showDataFlow]);

  useEffect(() => {
    return () => {
      if (dataFlowTimerRef.current) clearInterval(dataFlowTimerRef.current);
    };
  }, []);

  const allNodes = flattenTree(componentTree);
  const selectedNode = selectedId
    ? allNodes.find((n) => n.id === selectedId)
    : null;

  function renderNode(node: ComponentNode, depth: number = 0) {
    const isExpanded = expandedIds.has(node.id);
    const hasChildren = node.children && node.children.length > 0;
    const isSelected = selectedId === node.id;
    const isDataFlowActive =
      showDataFlow &&
      dataFlowStep >= 0 &&
      dataFlowStep < dataFlowSteps.length &&
      dataFlowSteps[dataFlowStep].from === node.id;

    return (
      <div key={node.id}>
        <motion.div
          animate={{
            backgroundColor: isDataFlowActive
              ? colors.terracottaBg
              : isSelected
              ? colors.selectedBg
              : "transparent",
          }}
          transition={{ duration: 0.3 }}
          onClick={() => setSelectedId(isSelected ? null : node.id)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 10px",
            paddingLeft: depth * 24 + 10,
            borderRadius: 6,
            cursor: "pointer",
            position: "relative",
            borderLeft: isDataFlowActive
              ? `2px solid ${colors.terracotta}`
              : "2px solid transparent",
            transition: "border-color 0.3s",
          }}
        >
          {/* Tree lines */}
          {depth > 0 &&
            Array.from({ length: depth }).map((_, i) => (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: i * 24 + 20,
                  top: 0,
                  bottom: 0,
                  width: 1,
                  background: colors.treeLine,
                }}
              />
            ))}

          {/* Expand/collapse toggle */}
          {hasChildren ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleExpanded(node.id);
              }}
              style={{
                width: 18,
                height: 18,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: colors.textSecondary,
                fontSize: 12,
                flexShrink: 0,
                padding: 0,
                fontFamily: "var(--font-mono)",
              }}
            >
              {isExpanded ? (
                <svg width="10" height="10" viewBox="0 0 10 10">
                  <path
                    d="M2 3.5 L5 6.5 L8 3.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <svg width="10" height="10" viewBox="0 0 10 10">
                  <path
                    d="M3.5 2 L6.5 5 L3.5 8"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>
          ) : (
            <div style={{ width: 18, flexShrink: 0 }} />
          )}

          {/* Component name */}
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              fontWeight: isSelected ? 600 : 500,
              color: isDataFlowActive
                ? colors.terracotta
                : isSelected
                ? colors.terracotta
                : colors.text,
              transition: "color 0.2s",
            }}
          >
            {"<"}
            {node.name}
            {" />"}
          </span>

          {/* Hot path badge */}
          {node.isHotPath && (
            <span
              style={{
                padding: "1px 6px",
                fontFamily: "var(--font-mono)",
                fontSize: 9,
                fontWeight: 600,
                background: colors.hotPath,
                color: colors.hotPathBorder,
                borderRadius: 4,
                border: `1px solid ${colors.hotPathBorder}`,
                whiteSpace: "nowrap",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              hot path
            </span>
          )}

          {/* Lines count */}
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: colors.textSecondary,
              marginLeft: "auto",
              whiteSpace: "nowrap",
            }}
          >
            {node.lines}
          </span>

          {/* Data flow arrow */}
          <AnimatePresence>
            {isDataFlowActive && (
              <motion.div
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: colors.terracotta,
                  whiteSpace: "nowrap",
                  maxWidth: 200,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {dataFlowSteps[dataFlowStep].label}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Children */}
        <AnimatePresence>
          {hasChildren && isExpanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              style={{ overflow: "hidden" }}
            >
              {node.children!.map((child) => renderNode(child, depth + 1))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className={className} style={{ fontFamily: "var(--font-serif)" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 20px",
          background: colors.cardBg,
          border: `1px solid ${colors.cardBorder}`,
          borderRadius: "12px 12px 0 0",
          borderBottom: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: colors.terracotta,
            }}
          />
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 14,
              color: colors.terracotta,
              fontWeight: 600,
            }}
          >
            REPL 组件层级
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              padding: "2px 8px",
              background: colors.terracottaBg,
              color: colors.terracotta,
              borderRadius: 4,
              fontWeight: 700,
            }}
          >
            ~5,000 行
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={toggleDataFlow}
            style={{
              padding: "6px 12px",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              fontWeight: 600,
              background: showDataFlow ? colors.terracotta : "transparent",
              color: showDataFlow ? "#fff" : colors.textSecondary,
              border: `1px solid ${
                showDataFlow ? colors.terracotta : colors.cardBorder
              }`,
              borderRadius: 6,
              cursor: "pointer",
              transition: "all 0.2s",
            }}
          >
            {showDataFlow ? "停止演示" : "展示数据流"}
          </button>
          <button
            onClick={() =>
              setExpandedIds(
                expandedIds.size > 3
                  ? new Set(["repl"])
                  : new Set(flattenTree(componentTree).map((n) => n.id))
              )
            }
            style={{
              padding: "6px 12px",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              background: "transparent",
              color: colors.textSecondary,
              border: `1px solid ${colors.cardBorder}`,
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            {expandedIds.size > 3 ? "折叠全部" : "展开全部"}
          </button>
        </div>
      </div>

      {/* Tree + Detail */}
      <div
        style={{
          display: "flex",
          gap: 0,
          borderRadius: "0 0 12px 12px",
          overflow: "hidden",
          border: `1px solid ${colors.cardBorder}`,
        }}
      >
        {/* Tree panel */}
        <div
          style={{
            flex: "1 1 auto",
            minWidth: 0,
            padding: "12px 8px",
            background: colors.cardBg,
            borderRight: selectedNode
              ? `1px solid ${colors.cardBorder}`
              : "none",
            maxHeight: 500,
            overflowY: "auto",
          }}
        >
          {renderNode(componentTree)}
        </div>

        {/* Detail panel */}
        <AnimatePresence>
          {selectedNode && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 320, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              style={{
                flexShrink: 0,
                background: colors.cardBg,
                overflow: "hidden",
              }}
            >
              <div style={{ padding: "16px 20px", width: 320 }}>
                {/* Component name */}
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 15,
                    fontWeight: 600,
                    color: colors.terracotta,
                    marginBottom: 4,
                  }}
                >
                  {"<"}
                  {selectedNode.name}
                  {" />"}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: colors.textSecondary,
                    marginBottom: 12,
                  }}
                >
                  {selectedNode.lines} 行
                  {selectedNode.isHotPath && (
                    <span style={{ color: colors.hotPathBorder }}>
                      {" "}
                      -- hot path
                    </span>
                  )}
                </div>

                {/* Description */}
                <p
                  style={{
                    fontSize: 12,
                    color: colors.text,
                    lineHeight: 1.6,
                    marginBottom: 16,
                  }}
                >
                  {selectedNode.description}
                </p>

                {/* Key Props */}
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    color: colors.textSecondary,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    marginBottom: 6,
                  }}
                >
                  核心 Props
                </div>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 4,
                    marginBottom: 16,
                  }}
                >
                  {selectedNode.keyProps.map((prop) => (
                    <span
                      key={prop}
                      style={{
                        padding: "2px 8px",
                        fontFamily: "var(--font-mono)",
                        fontSize: 11,
                        background: colors.surfaceBg,
                        color: colors.text,
                        borderRadius: 4,
                        border: `1px solid ${colors.cardBorder}`,
                      }}
                    >
                      {prop}
                    </span>
                  ))}
                </div>

                {/* Re-render triggers */}
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    color: colors.textSecondary,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    marginBottom: 6,
                  }}
                >
                  重渲染触发条件
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 3,
                  }}
                >
                  {selectedNode.reRenderTriggers.map((trigger) => (
                    <div
                      key={trigger}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 11,
                        color: colors.textSecondary,
                      }}
                    >
                      <div
                        style={{
                          width: 4,
                          height: 4,
                          borderRadius: "50%",
                          background: selectedNode.isHotPath
                            ? colors.hotPathBorder
                            : colors.terracotta,
                          flexShrink: 0,
                        }}
                      />
                      {trigger}
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Data flow legend */}
      <AnimatePresence>
        {showDataFlow && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            style={{
              marginTop: 12,
              padding: "12px 16px",
              background: colors.cardBg,
              border: `1px solid ${colors.cardBorder}`,
              borderRadius: 8,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: colors.textSecondary,
                marginBottom: 8,
              }}
            >
              消息流：从用户输入到渲染输出
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {dataFlowSteps.map((step, index) => (
                <div
                  key={index}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <div
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      fontWeight: 700,
                      background:
                        dataFlowStep >= index
                          ? colors.terracotta
                          : "transparent",
                      color:
                        dataFlowStep >= index ? "#fff" : colors.textSecondary,
                      border: `1.5px solid ${
                        dataFlowStep >= index
                          ? colors.terracotta
                          : colors.cardBorder
                      }`,
                      transition: "all 0.3s",
                      flexShrink: 0,
                    }}
                  >
                    {index + 1}
                  </div>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      color:
                        dataFlowStep === index
                          ? colors.terracotta
                          : colors.textSecondary,
                      transition: "color 0.3s",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {step.label}
                  </span>
                  {index < dataFlowSteps.length - 1 && (
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 12 12"
                      style={{ flexShrink: 0 }}
                    >
                      <path
                        d="M3 6h6M7 4l2 2-2 2"
                        stroke={
                          dataFlowStep > index
                            ? colors.terracotta
                            : colors.textSecondary
                        }
                        strokeWidth="1.5"
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{ transition: "stroke 0.3s" }}
                      />
                    </svg>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
