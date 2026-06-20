import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";

// --- Types ---

type ToolType = "read" | "write" | "bash" | "mcp";
type PermissionMode = "bypassPermissions" | "dontAsk" | "auto" | "acceptEdits" | "default" | "plan" | "bubble";
type Resolution = "ALLOWED" | "DENIED" | "ASK_USER";

interface FlowNode {
  id: string;
  label: string;
  detail: string;
  type: "decision" | "result";
}

interface FlowPath {
  nodes: string[];
  result: Resolution;
  explanation: string;
}

interface Preset {
  label: string;
  tool: ToolType;
  mode: PermissionMode;
  hasHook: boolean;
  hookDecision?: Resolution;
}

// --- Data ---

const toolTypes: { value: ToolType; label: string }[] = [
  { value: "read", label: "读取文件" },
  { value: "write", label: "写入文件" },
  { value: "bash", label: "Bash 命令" },
  { value: "mcp", label: "MCP 工具" },
];

const permissionModes: { value: PermissionMode; label: string; description: string }[] = [
  { value: "bypassPermissions", label: "bypassPermissions", description: "允许所有操作。无检查。仅限内部/测试使用" },
  { value: "dontAsk", label: "dontAsk", description: "允许所有操作并记录日志。不提示用户" },
  { value: "auto", label: "auto", description: "由 LLM 转录分类器决定允许或拒绝" },
  { value: "acceptEdits", label: "acceptEdits", description: "文件编辑自动批准；其他变更需提示确认" },
  { value: "default", label: "default", description: "标准交互模式。用户需批准每个操作" },
  { value: "plan", label: "plan", description: "只读模式。阻止所有变更操作" },
  { value: "bubble", label: "bubble", description: "将决策上报给父级 Agent（子 Agent 模式）" },
];

const presets: Preset[] = [
  { label: "Auto 模式下读取文件", tool: "read", mode: "auto", hasHook: false },
  { label: "Plan 模式下执行 Bash rm", tool: "bash", mode: "plan", hasHook: false },
  { label: "Hook 覆盖下的写入操作", tool: "write", mode: "default", hasHook: true, hookDecision: "ALLOWED" },
  { label: "Default 模式下的 MCP 工具", tool: "mcp", mode: "default", hasHook: false },
  { label: "全自动 (dontAsk) 下的 Bash", tool: "bash", mode: "dontAsk", hasHook: false },
  { label: "被 Hook 阻止的写入操作", tool: "write", mode: "acceptEdits", hasHook: true, hookDecision: "DENIED" },
];

const allNodes: Record<string, FlowNode> = {
  start: { id: "start", label: "工具调用需要权限", detail: "已从模型响应中解析出 tool_use 块", type: "decision" },
  hookCheck: { id: "hookCheck", label: "匹配 Hook 规则？", detail: "检查是否有 PreToolUse Hook 匹配此次工具调用", type: "decision" },
  hookDecision: { id: "hookDecision", label: "使用 Hook 决策", detail: "Hook 返回了 allow、deny 或 ask —— 这将覆盖所有其他检查", type: "decision" },
  checkPerms: { id: "checkPerms", label: "tool.checkPermissions()", detail: "每个工具定义自己的权限逻辑（只读工具通常返回 'allow'）", type: "decision" },
  toolAllow: { id: "toolAllow", label: "工具自允许", detail: "checkPermissions() 返回 'allow' —— 工具本身是安全的", type: "decision" },
  modeCheck: { id: "modeCheck", label: "权限模式？", detail: "检查当前激活的权限模式（7 种模式，从最宽松到最严格）", type: "decision" },
  bypassAllow: { id: "bypassAllow", label: "bypassPermissions / dontAsk", detail: "无限制。所有操作直接通过", type: "decision" },
  planDeny: { id: "planDeny", label: "plan 模式：只读", detail: "所有变更操作被阻止。仅允许读取操作", type: "decision" },
  planReadCheck: { id: "planReadCheck", label: "是否为读取操作？", detail: "Plan 模式允许读取，但阻止写入和执行", type: "decision" },
  acceptEditsCheck: { id: "acceptEditsCheck", label: "acceptEdits：文件写入？", detail: "文件编辑自动批准，其他操作需提示用户", type: "decision" },
  autoClassifier: { id: "autoClassifier", label: "LLM 分类器评估", detail: "轻量级 LLM 调用根据对话转录对工具调用进行分类", type: "decision" },
  promptUser: { id: "promptUser", label: "提示用户", detail: "用户看到：允许一次 / 本次会话允许 / 始终允许 / 拒绝", type: "decision" },
  bubbleUp: { id: "bubbleUp", label: "上报给父级", detail: "子 Agent 无法批准自身的危险操作。权限需向上冒泡", type: "decision" },
  resultAllow: { id: "resultAllow", label: "已允许", detail: "工具执行继续", type: "result" },
  resultDeny: { id: "resultDeny", label: "已拒绝", detail: "工具执行被阻止，向模型返回错误", type: "result" },
  resultAsk: { id: "resultAsk", label: "询问用户", detail: "向用户显示交互式权限提示", type: "result" },
};

function resolvePermission(
  tool: ToolType,
  mode: PermissionMode,
  hasHook: boolean,
  hookDecision?: Resolution
): FlowPath {
  const nodes: string[] = ["start", "hookCheck"];

  if (hasHook && hookDecision) {
    nodes.push("hookDecision");
    if (hookDecision === "ALLOWED") {
      nodes.push("resultAllow");
      return { nodes, result: "ALLOWED", explanation: "PreToolUse Hook 匹配并返回 allow —— 跳过所有其他检查" };
    }
    if (hookDecision === "DENIED") {
      nodes.push("resultDeny");
      return { nodes, result: "DENIED", explanation: "PreToolUse Hook 匹配并返回 deny —— 工具在权限提示前被阻止" };
    }
    nodes.push("resultAsk");
    return { nodes, result: "ASK_USER", explanation: "PreToolUse Hook 匹配并返回 ask —— 必须由用户决定" };
  }

  nodes.push("checkPerms");

  // Read-only tools self-allow
  if (tool === "read") {
    nodes.push("toolAllow", "resultAllow");
    return { nodes, result: "ALLOWED", explanation: "读取工具的 checkPermissions() 返回 'allow' —— 只读工具本身是安全的" };
  }

  nodes.push("modeCheck");

  switch (mode) {
    case "bypassPermissions":
    case "dontAsk":
      nodes.push("bypassAllow", "resultAllow");
      return { nodes, result: "ALLOWED", explanation: `${mode} 模式：所有工具调用无需提示即可允许` };

    case "plan":
      nodes.push("planDeny");
      if (tool === "read") {
        nodes.push("planReadCheck", "resultAllow");
        return { nodes, result: "ALLOWED", explanation: "Plan 模式允许读取操作" };
      }
      nodes.push("resultDeny");
      return { nodes, result: "DENIED", explanation: "Plan 模式：所有变更操作被阻止。仅允许读取操作" };

    case "acceptEdits":
      nodes.push("acceptEditsCheck");
      if (tool === "write") {
        nodes.push("resultAllow");
        return { nodes, result: "ALLOWED", explanation: "acceptEdits 模式：文件写入操作自动批准" };
      }
      nodes.push("resultAsk");
      return { nodes, result: "ASK_USER", explanation: "acceptEdits 模式：非写入操作需要用户批准" };

    case "auto":
      nodes.push("autoClassifier");
      // For the interactive demo, auto mode allows writes and denies dangerous bash
      if (tool === "bash") {
        nodes.push("resultAsk");
        return { nodes, result: "ASK_USER", explanation: "Auto 模式：LLM 分类器标记此 Bash 命令为潜在不安全" };
      }
      nodes.push("resultAllow");
      return { nodes, result: "ALLOWED", explanation: "Auto 模式：LLM 分类器判定此操作符合用户意图" };

    case "default":
      nodes.push("promptUser", "resultAsk");
      return { nodes, result: "ASK_USER", explanation: "Default 模式：用户必须以交互方式批准每个变更操作" };

    case "bubble":
      nodes.push("bubbleUp", "resultAsk");
      return { nodes, result: "ASK_USER", explanation: "Bubble 模式：子 Agent 将权限上报给父级 Agent 或用户" };
  }
}

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

function ResultBadge({ result, isDark }: { result: Resolution; isDark: boolean }) {
  const config = {
    ALLOWED: {
      bg: isDark ? "rgba(34, 197, 94, 0.15)" : "rgba(34, 197, 94, 0.12)",
      border: "rgba(34, 197, 94, 0.4)",
      color: "#22c55e",
      label: "已允许",
    },
    DENIED: {
      bg: isDark ? "rgba(239, 68, 68, 0.15)" : "rgba(239, 68, 68, 0.1)",
      border: "rgba(239, 68, 68, 0.4)",
      color: "#ef4444",
      label: "已拒绝",
    },
    ASK_USER: {
      bg: isDark ? "rgba(234, 179, 8, 0.15)" : "rgba(234, 179, 8, 0.1)",
      border: "rgba(234, 179, 8, 0.4)",
      color: "#eab308",
      label: "询问用户",
    },
  }[result];

  return (
    <motion.span
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
      style={{
        display: "inline-block",
        padding: "6px 16px",
        borderRadius: 8,
        background: config.bg,
        border: `1.5px solid ${config.border}`,
        color: config.color,
        fontSize: 14,
        fontWeight: 700,
        fontFamily: "var(--font-mono)",
        letterSpacing: "0.05em",
      }}
    >
      {config.label}
    </motion.span>
  );
}

// --- Component ---

interface Props {
  className?: string;
}

export default function PermissionResolver({ className }: Props) {
  const isDark = useDarkMode();
  const [tool, setTool] = useState<ToolType>("write");
  const [mode, setMode] = useState<PermissionMode>("default");
  const [hasHook, setHasHook] = useState(false);
  const [hookDecision, setHookDecision] = useState<Resolution>("ALLOWED");
  const [resolved, setResolved] = useState<FlowPath | null>(null);
  const [animatingIdx, setAnimatingIdx] = useState(-1);
  const abortRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const colors = {
    accent: "#d97757",
    accentDim: "rgba(217, 119, 87, 0.3)",
    accentBg: isDark ? "rgba(217, 119, 87, 0.08)" : "rgba(217, 119, 87, 0.05)",
    text: isDark ? "#f5f4ed" : "#141413",
    textSecondary: "#87867f",
    cardBg: isDark ? "#1e1e1c" : "#ffffff",
    cardBorder: isDark ? "#333" : "#e8e6dc",
    green: "#22c55e",
    red: "#ef4444",
    amber: "#eab308",
  };

  const reset = useCallback(() => {
    abortRef.current = true;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setResolved(null);
    setAnimatingIdx(-1);
  }, []);

  const resolve = useCallback(async () => {
    reset();
    await new Promise((r) => setTimeout(r, 50));
    abortRef.current = false;

    const path = resolvePermission(tool, mode, hasHook, hasHook ? hookDecision : undefined);
    setResolved(path);

    // Animate through nodes
    for (let i = 0; i < path.nodes.length; i++) {
      if (abortRef.current) return;
      setAnimatingIdx(i);
      await new Promise<void>((res) => {
        timeoutRef.current = setTimeout(res, 350);
      });
    }
  }, [tool, mode, hasHook, hookDecision, reset]);

  const applyPreset = useCallback((preset: Preset) => {
    reset();
    setTool(preset.tool);
    setMode(preset.mode);
    setHasHook(preset.hasHook);
    if (preset.hookDecision) setHookDecision(preset.hookDecision);
  }, [reset]);

  useEffect(() => {
    return () => {
      abortRef.current = true;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const selectStyle = {
    fontSize: 13,
    fontFamily: "var(--font-mono)",
    padding: "6px 10px",
    borderRadius: 6,
    border: `1px solid ${colors.cardBorder}`,
    background: isDark ? "#30302e" : "#f5f4ed",
    color: colors.text,
    cursor: "pointer" as const,
    width: "100%",
  };

  return (
    <div className={className} style={{ fontFamily: "var(--font-serif)" }}>
      {/* Controls panel */}
      <div
        style={{
          padding: "16px 20px",
          background: colors.cardBg,
          border: `1px solid ${colors.cardBorder}`,
          borderRadius: 12,
          marginBottom: 16,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 16,
            marginBottom: 16,
          }}
        >
          {/* Tool type */}
          <div>
            <label
              style={{
                display: "block",
                fontSize: 11,
                fontWeight: 600,
                fontFamily: "var(--font-mono)",
                color: colors.textSecondary,
                marginBottom: 6,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              工具类型
            </label>
            <select value={tool} onChange={(e) => { setTool(e.target.value as ToolType); reset(); }} style={selectStyle}>
              {toolTypes.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          {/* Permission mode */}
          <div>
            <label
              style={{
                display: "block",
                fontSize: 11,
                fontWeight: 600,
                fontFamily: "var(--font-mono)",
                color: colors.textSecondary,
                marginBottom: 6,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              权限模式
            </label>
            <select value={mode} onChange={(e) => { setMode(e.target.value as PermissionMode); reset(); }} style={selectStyle}>
              {permissionModes.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>

          {/* Hook toggle */}
          <div>
            <label
              style={{
                display: "block",
                fontSize: 11,
                fontWeight: 600,
                fontFamily: "var(--font-mono)",
                color: colors.textSecondary,
                marginBottom: 6,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Hook 规则
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 13,
                  color: colors.text,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={hasHook}
                  onChange={(e) => { setHasHook(e.target.checked); reset(); }}
                  style={{ accentColor: colors.accent }}
                />
                存在匹配的 Hook
              </label>
              {hasHook && (
                <select
                  value={hookDecision}
                  onChange={(e) => { setHookDecision(e.target.value as Resolution); reset(); }}
                  style={{ ...selectStyle, width: "auto" }}
                >
                  <option value="ALLOWED">allow</option>
                  <option value="DENIED">deny</option>
                  <option value="ASK_USER">ask</option>
                </select>
              )}
            </div>
          </div>
        </div>

        {/* Mode description */}
        <div
          style={{
            fontSize: 12,
            color: colors.textSecondary,
            fontFamily: "var(--font-mono)",
            padding: "8px 12px",
            background: isDark ? "rgba(135,134,127,0.08)" : "rgba(135,134,127,0.06)",
            borderRadius: 6,
            marginBottom: 16,
          }}
        >
          {permissionModes.find((m) => m.value === mode)?.description}
        </div>

        {/* Resolve button */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <button
            onClick={resolve}
            style={{
              padding: "8px 24px",
              borderRadius: 8,
              border: "none",
              background: colors.accent,
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "var(--font-mono)",
              cursor: "pointer",
              transition: "background 0.2s",
            }}
          >
            解析
          </button>

          {resolved && (
            <button
              onClick={reset}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                border: `1px solid ${colors.cardBorder}`,
                background: colors.cardBg,
                color: colors.text,
                fontSize: 13,
                fontFamily: "var(--font-mono)",
                cursor: "pointer",
              }}
            >
              清除
            </button>
          )}
        </div>
      </div>

      {/* Presets */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          marginBottom: 20,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            color: colors.textSecondary,
            alignSelf: "center",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          预设：
        </span>
        {presets.map((preset) => (
          <button
            key={preset.label}
            onClick={() => applyPreset(preset)}
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              border: `1px solid ${colors.cardBorder}`,
              background: colors.cardBg,
              color: colors.text,
              fontSize: 12,
              fontFamily: "var(--font-mono)",
              cursor: "pointer",
              transition: "border-color 0.2s",
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLButtonElement).style.borderColor = colors.accent;
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLButtonElement).style.borderColor = colors.cardBorder;
            }}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {/* Decision tree visualization */}
      <AnimatePresence>
        {resolved && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            {/* Flow path */}
            <div style={{ position: "relative", paddingLeft: 28 }}>
              {/* Vertical connector */}
              <div
                style={{
                  position: "absolute",
                  left: 14,
                  top: 20,
                  bottom: 20,
                  width: 2,
                  background: colors.cardBorder,
                }}
              />

              {resolved.nodes.map((nodeId, i) => {
                const node = allNodes[nodeId];
                if (!node) return null;

                const isAnimated = i <= animatingIdx;
                const isCurrent = i === animatingIdx;
                const isResult = node.type === "result";

                let dotColor = colors.cardBorder;
                let borderColor = colors.cardBorder;
                let bgColor = colors.cardBg;

                if (isAnimated) {
                  dotColor = colors.accent;
                  borderColor = colors.accent;
                  bgColor = colors.accentBg;
                }
                if (isResult && isAnimated) {
                  if (resolved.result === "ALLOWED") {
                    dotColor = colors.green;
                    borderColor = "rgba(34, 197, 94, 0.4)";
                    bgColor = isDark ? "rgba(34, 197, 94, 0.08)" : "rgba(34, 197, 94, 0.05)";
                  } else if (resolved.result === "DENIED") {
                    dotColor = colors.red;
                    borderColor = "rgba(239, 68, 68, 0.4)";
                    bgColor = isDark ? "rgba(239, 68, 68, 0.08)" : "rgba(239, 68, 68, 0.05)";
                  } else {
                    dotColor = colors.amber;
                    borderColor = "rgba(234, 179, 8, 0.4)";
                    bgColor = isDark ? "rgba(234, 179, 8, 0.08)" : "rgba(234, 179, 8, 0.05)";
                  }
                }

                return (
                  <motion.div
                    key={nodeId + "-" + i}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: isAnimated ? 1 : 0.3, x: 0 }}
                    transition={{ duration: 0.3, delay: i * 0.05 }}
                    style={{
                      position: "relative",
                      marginBottom: i < resolved.nodes.length - 1 ? 8 : 0,
                    }}
                  >
                    {/* Dot */}
                    <div
                      style={{
                        position: "absolute",
                        left: -28 + 14 - 5,
                        top: "50%",
                        transform: "translateY(-50%)",
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        background: dotColor,
                        transition: "background 0.3s",
                        zIndex: 1,
                      }}
                    />

                    {/* Pulse on current */}
                    {isCurrent && (
                      <motion.div
                        style={{
                          position: "absolute",
                          left: -28 + 14 - 10,
                          top: "50%",
                          transform: "translateY(-50%)",
                          width: 20,
                          height: 20,
                          borderRadius: "50%",
                          border: `2px solid ${dotColor}`,
                          zIndex: 0,
                        }}
                        animate={{ scale: [1, 1.5, 1], opacity: [0.6, 0, 0.6] }}
                        transition={{ duration: 1, repeat: Infinity }}
                      />
                    )}

                    {/* Node card */}
                    <div
                      style={{
                        padding: "10px 14px",
                        borderRadius: 10,
                        border: `1px solid ${borderColor}`,
                        background: bgColor,
                        transition: "border-color 0.3s, background 0.3s",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {!isResult && (
                          <span
                            style={{
                              fontSize: 12,
                              color: isAnimated ? colors.accent : colors.textSecondary,
                              fontFamily: "var(--font-mono)",
                            }}
                          >
                            {node.type === "decision" ? "?" : ""}
                          </span>
                        )}
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: isResult ? 700 : 600,
                            fontFamily: "var(--font-mono)",
                            color: isResult && isAnimated
                              ? dotColor
                              : isAnimated
                                ? colors.accent
                                : colors.text,
                            flex: 1,
                          }}
                        >
                          {node.label}
                        </span>
                        {isResult && isAnimated && (
                          <ResultBadge result={resolved.result} isDark={isDark} />
                        )}
                      </div>

                      {isAnimated && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          transition={{ duration: 0.2 }}
                          style={{ overflow: "hidden" }}
                        >
                          <div
                            style={{
                              fontSize: 12,
                              color: colors.textSecondary,
                              marginTop: 4,
                              lineHeight: 1.4,
                            }}
                          >
                            {node.detail}
                          </div>
                        </motion.div>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>

            {/* Explanation */}
            {animatingIdx >= resolved.nodes.length - 1 && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                style={{
                  marginTop: 16,
                  padding: "14px 20px",
                  borderRadius: 12,
                  border: `1px solid ${colors.accentDim}`,
                  background: colors.accentBg,
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    color: colors.text,
                    lineHeight: 1.5,
                  }}
                >
                  <span
                    style={{
                      fontWeight: 600,
                      fontFamily: "var(--font-mono)",
                      color: colors.accent,
                      marginRight: 8,
                    }}
                  >
                    解析结果：
                  </span>
                  {resolved.explanation}
                </div>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Permission modes reference table */}
      {!resolved && (
        <div
          style={{
            borderRadius: 12,
            border: `1px solid ${colors.cardBorder}`,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "10px 16px",
              background: isDark ? "rgba(135,134,127,0.08)" : "rgba(135,134,127,0.04)",
              borderBottom: `1px solid ${colors.cardBorder}`,
              fontSize: 11,
              fontWeight: 600,
              fontFamily: "var(--font-mono)",
              color: colors.textSecondary,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            权限模式（从最宽松到最严格）
          </div>
          {permissionModes.map((m, i) => (
            <div
              key={m.value}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "8px 16px",
                borderBottom: i < permissionModes.length - 1 ? `1px solid ${colors.cardBorder}` : "none",
                background: mode === m.value ? colors.accentBg : "transparent",
                cursor: "pointer",
                transition: "background 0.2s",
              }}
              onClick={() => { setMode(m.value); reset(); }}
            >
              <span
                style={{
                  fontSize: 12,
                  fontFamily: "var(--font-mono)",
                  fontWeight: 600,
                  color: mode === m.value ? colors.accent : colors.text,
                  minWidth: 140,
                }}
              >
                {m.label}
              </span>
              <span
                style={{
                  fontSize: 12,
                  color: colors.textSecondary,
                  flex: 1,
                }}
              >
                {m.description}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
