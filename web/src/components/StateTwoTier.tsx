import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";

// --- Dark mode hook (matches existing pattern) ---

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

// --- Data ---

interface BootstrapField {
  key: string;
  value: string;
  description: string;
}

interface AppStateField {
  key: string;
  value: string;
  description: string;
}

const bootstrapFields: BootstrapField[] = [
  { key: "sessionId", value: "a3f7c...", description: "每个进程唯一，通过 crypto.randomUUID() 生成" },
  { key: "model", value: "claude-sonnet-4", description: "当前 API 调用使用的模型，由 mainLoopModelOverride 设置" },
  { key: "projectRoot", value: "/users/dev/proj", description: "NFC 标准化路径，在 init() 后冻结" },
  { key: "totalCostUSD", value: "$0.42", description: "单调递增的会话成本" },
  { key: "permissionMode", value: "default", description: "工具执行的信任边界" },
  { key: "isInteractive", value: "true", description: "REPL 与单次执行模式的标志位" },
  { key: "promptCache1hEligible", value: "true", description: "粘性锁存器 -- 扩展缓存 TTL" },
  { key: "afkModeHeaderLatched", value: "null", description: "粘性锁存器 -- 一旦为 true，永不回退" },
];

const appStateFields: AppStateField[] = [
  { key: "mainLoopModel", value: "claude-sonnet-4", description: "UI 中显示并用于下一次 API 调用的模型" },
  { key: "theme", value: "dark", description: "UI 主题偏好" },
  { key: "verbose", value: "false", description: "显示详细输出的开关" },
  { key: "permissionMode", value: "default", description: "变更时同步至 Bootstrap STATE 和 CCR" },
  { key: "messages", value: "[...28 msgs]", description: "用于 UI 渲染的对话历史" },
  { key: "tasks", value: "{agent-1: ...}", description: "活跃子代理任务追踪" },
];

type AnimationStep =
  | "idle"
  | "dispatch-appstate"
  | "onchange-fires"
  | "bootstrap-updates"
  | "api-reads";

const STEP_LABELS: Record<AnimationStep, string> = {
  idle: "点击“更改模型”以查看双层数据流",
  "dispatch-appstate": "1. UI 派发至 AppState store",
  "onchange-fires": "2. onChange 副作用同步触发",
  "bootstrap-updates": "3. Bootstrap STATE.model 被更新",
  "api-reads": "4. 下一次 API 调用从 Bootstrap STATE 读取",
};

interface StickyLatch {
  value: boolean | null;
  label: string;
}

// --- Component ---

interface Props {
  className?: string;
}

export default function StateTwoTier({ className }: Props) {
  const isDark = useDarkMode();
  const [animStep, setAnimStep] = useState<AnimationStep>("idle");
  const [isAnimating, setIsAnimating] = useState(false);
  const [bootstrapModel, setBootstrapModel] = useState("claude-sonnet-4");
  const [appStateModel, setAppStateModel] = useState("claude-sonnet-4");

  // Sticky latch demo
  const [thinkingLatch, setThinkingLatch] = useState<StickyLatch>({
    value: null,
    label: "扩展思考",
  });

  const timeoutRefs = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimeouts = useCallback(() => {
    timeoutRefs.current.forEach(clearTimeout);
    timeoutRefs.current = [];
  }, []);

  useEffect(() => () => clearTimeouts(), [clearTimeouts]);

  const colors = {
    terracotta: "#d97757",
    text: isDark ? "#f5f4ed" : "#141413",
    textSecondary: isDark ? "#87867f" : "#87867f",
    bg: isDark ? "#1e1e1c" : "#ffffff",
    bgCard: isDark ? "#2a2a28" : "#f8f7f2",
    border: isDark ? "#333" : "#c2c0b6",
    bootstrapBg: isDark ? "#2a2520" : "#fdf6f0",
    bootstrapBorder: isDark ? "#5a3d30" : "#e8c9b8",
    appstateBg: isDark ? "#1f2a20" : "#f0f8f0",
    appstateBorder: isDark ? "#2d5a2d" : "#b8d8b8",
    highlightBootstrap: isDark ? "rgba(217,119,87,0.25)" : "rgba(217,119,87,0.15)",
    highlightAppstate: isDark ? "rgba(34,197,94,0.25)" : "rgba(34,197,94,0.12)",
    green: "#22c55e",
    amber: "#f59e0b",
    arrowColor: isDark ? "#d97757" : "#d97757",
    latchOn: "#22c55e",
    latchOff: isDark ? "#555" : "#ccc",
    latchStuck: "#ef4444",
  };

  const runModelChange = useCallback(() => {
    if (isAnimating) return;
    setIsAnimating(true);
    clearTimeouts();

    const newModel = bootstrapModel === "claude-sonnet-4" ? "claude-opus-4" : "claude-sonnet-4";

    // Step 1: dispatch to AppState
    setAnimStep("dispatch-appstate");
    setAppStateModel(newModel);

    const t1 = setTimeout(() => {
      // Step 2: onChange fires
      setAnimStep("onchange-fires");
    }, 900);

    const t2 = setTimeout(() => {
      // Step 3: Bootstrap updates
      setAnimStep("bootstrap-updates");
      setBootstrapModel(newModel);
    }, 1800);

    const t3 = setTimeout(() => {
      // Step 4: API reads
      setAnimStep("api-reads");
    }, 2700);

    const t4 = setTimeout(() => {
      setAnimStep("idle");
      setIsAnimating(false);
    }, 4000);

    timeoutRefs.current = [t1, t2, t3, t4];
  }, [isAnimating, bootstrapModel, clearTimeouts]);

  const toggleThinkingLatch = useCallback(() => {
    setThinkingLatch((prev) => {
      // Once latched true, it never goes back
      if (prev.value === true) return prev; // stuck!
      return { ...prev, value: true };
    });
  }, []);

  const resetLatch = useCallback(() => {
    setThinkingLatch({ value: null, label: "扩展思考" });
  }, []);

  // Field row component
  const FieldRow = ({
    label,
    value,
    description,
    highlighted,
    isModel,
  }: {
    label: string;
    value: string;
    description: string;
    highlighted: boolean;
    isModel?: boolean;
  }) => (
    <motion.div
      animate={{
        backgroundColor: highlighted
          ? isModel
            ? colors.highlightBootstrap
            : colors.highlightAppstate
          : "transparent",
      }}
      transition={{ duration: 0.3 }}
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "5px 10px",
        borderRadius: 4,
        gap: 8,
      }}
      title={description}
    >
      <span
        style={{
          fontSize: 12,
          fontFamily: "var(--font-mono)",
          color: colors.textSecondary,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      <motion.span
        key={value}
        initial={highlighted ? { scale: 1.1 } : false}
        animate={{ scale: 1 }}
        style={{
          fontSize: 12,
          fontFamily: "var(--font-mono)",
          fontWeight: 600,
          color: highlighted ? colors.terracotta : colors.text,
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </motion.span>
    </motion.div>
  );

  return (
    <div className={className} style={{ fontFamily: "var(--font-serif)" }}>
      {/* Step indicator */}
      <div
        style={{
          textAlign: "center",
          marginBottom: 16,
          minHeight: 24,
        }}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={animStep}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.2 }}
            style={{
              fontSize: 13,
              fontFamily: "var(--font-mono)",
              color: animStep === "idle" ? colors.textSecondary : colors.terracotta,
              fontWeight: animStep === "idle" ? 400 : 600,
            }}
          >
            {STEP_LABELS[animStep]}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Two-column layout */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          gap: 0,
          background: colors.bg,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        {/* Left: Bootstrap STATE */}
        <div
          style={{
            padding: "16px 14px",
            background: colors.bootstrapBg,
            borderRight: `1px solid ${colors.border}`,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              textTransform: "uppercase",
              letterSpacing: 1,
              color: colors.terracotta,
              marginBottom: 4,
              fontWeight: 600,
            }}
          >
            Bootstrap STATE
          </div>
          <div
            style={{
              fontSize: 11,
              color: colors.textSecondary,
              marginBottom: 12,
              lineHeight: 1.4,
            }}
          >
            可变单例 -- 在 React 挂载前即可用。约 80 个字段，通过 getter/setter 访问。
          </div>

          {bootstrapFields.map((field) => {
            const isModelField = field.key === "model";
            const displayValue = isModelField ? bootstrapModel : field.value;
            const highlighted =
              isModelField &&
              (animStep === "bootstrap-updates" || animStep === "api-reads");

            return (
              <FieldRow
                key={field.key}
                label={field.key}
                value={displayValue}
                description={field.description}
                highlighted={highlighted}
                isModel={true}
              />
            );
          })}

          <div
            style={{
              marginTop: 10,
              padding: "6px 10px",
              borderRadius: 4,
              background: isDark ? "rgba(217,119,87,0.08)" : "rgba(217,119,87,0.06)",
              border: `1px solid ${isDark ? "rgba(217,119,87,0.2)" : "rgba(217,119,87,0.15)"}`,
              fontSize: 11,
              color: colors.textSecondary,
              fontFamily: "var(--font-mono)",
              lineHeight: 1.5,
            }}
          >
            DAG 叶节点：不导入任何模块。可从任意位置导入而无循环依赖。
          </div>
        </div>

        {/* Center: Arrow/Bridge */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px 10px",
            gap: 8,
            minWidth: 80,
          }}
        >
          {/* Init arrow: Bootstrap -> AppState */}
          <div style={{ textAlign: "center", fontSize: 10, color: colors.textSecondary, fontFamily: "var(--font-mono)" }}>
            init
          </div>
          <svg width="60" height="20" viewBox="0 0 60 20">
            <defs>
              <marker id="arrow-right" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M0,0 L8,4 L0,8" fill="none" stroke={colors.textSecondary} strokeWidth="1.5" />
              </marker>
            </defs>
            <line x1="10" y1="10" x2="50" y2="10" stroke={colors.textSecondary} strokeWidth="1.5" strokeDasharray="4,3" markerEnd="url(#arrow-right)" />
          </svg>

          {/* onChange arrow: AppState -> Bootstrap */}
          <motion.div
            animate={{
              opacity: animStep === "onchange-fires" ? 1 : 0.3,
              scale: animStep === "onchange-fires" ? 1.1 : 1,
            }}
            transition={{ duration: 0.3 }}
            style={{ textAlign: "center" }}
          >
            <div style={{ fontSize: 10, color: colors.terracotta, fontFamily: "var(--font-mono)", fontWeight: 600, marginBottom: 2 }}>
              onChange
            </div>
            <svg width="60" height="20" viewBox="0 0 60 20">
              <defs>
                <marker id="arrow-left" markerWidth="8" markerHeight="8" refX="1" refY="4" orient="auto">
                  <path d="M8,0 L0,4 L8,8" fill="none" stroke={colors.terracotta} strokeWidth="1.5" />
                </marker>
              </defs>
              <line x1="50" y1="10" x2="10" y2="10" stroke={colors.terracotta} strokeWidth="1.5" markerEnd="url(#arrow-left)" />
            </svg>
          </motion.div>

          {/* Side effect label */}
          <div
            style={{
              fontSize: 9,
              fontFamily: "var(--font-mono)",
              color: colors.textSecondary,
              textAlign: "center",
              lineHeight: 1.4,
              maxWidth: 70,
            }}
          >
            副作用桥接两层状态
          </div>
        </div>

        {/* Right: AppState */}
        <div
          style={{
            padding: "16px 14px",
            background: colors.appstateBg,
            borderLeft: `1px solid ${colors.border}`,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              textTransform: "uppercase",
              letterSpacing: 1,
              color: colors.green,
              marginBottom: 4,
              fontWeight: 600,
            }}
          >
            AppState Store
          </div>
          <div
            style={{
              fontSize: 11,
              color: colors.textSecondary,
              marginBottom: 12,
              lineHeight: 1.4,
            }}
          >
            响应式 store -- 34 行闭包实现，使用 Object.is 进行相等性判断。通过 useSyncExternalStore 驱动 React。
          </div>

          {appStateFields.map((field) => {
            const isModelField = field.key === "mainLoopModel";
            const displayValue = isModelField ? appStateModel : field.value;
            const highlighted =
              isModelField &&
              (animStep === "dispatch-appstate" || animStep === "onchange-fires");

            return (
              <FieldRow
                key={field.key}
                label={field.key}
                value={displayValue}
                description={field.description}
                highlighted={highlighted}
              />
            );
          })}

          <div
            style={{
              marginTop: 10,
              padding: "6px 10px",
              borderRadius: 4,
              background: isDark ? "rgba(34,197,94,0.08)" : "rgba(34,197,94,0.06)",
              border: `1px solid ${isDark ? "rgba(34,197,94,0.2)" : "rgba(34,197,94,0.15)"}`,
              fontSize: 11,
              color: colors.textSecondary,
              fontFamily: "var(--font-mono)",
              lineHeight: 1.5,
            }}
          >
            DeepImmutable 快照。Updater 函数可防止状态过期 bug。
          </div>
        </div>
      </div>

      {/* Controls */}
      <div
        style={{
          display: "flex",
          gap: 8,
          justifyContent: "center",
          marginTop: 16,
        }}
      >
        <button
          onClick={runModelChange}
          disabled={isAnimating}
          style={{
            background: isAnimating ? colors.textSecondary : colors.terracotta,
            color: "#fff",
            border: "none",
            borderRadius: 6,
            padding: "6px 18px",
            fontSize: 13,
            fontFamily: "var(--font-mono)",
            cursor: isAnimating ? "not-allowed" : "pointer",
            opacity: isAnimating ? 0.5 : 1,
            transition: "opacity 0.2s",
          }}
        >
          更改模型
        </button>
      </div>

      {/* Sticky Latch Demo */}
      <div
        style={{
          marginTop: 24,
          background: colors.bg,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: 16,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            textTransform: "uppercase",
            letterSpacing: 1,
            color: colors.terracotta,
            marginBottom: 12,
            fontWeight: 600,
          }}
        >
          粘性锁存器演示
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          {/* Toggle */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 13, color: colors.text }}>
              {thinkingLatch.label}
            </span>
            <button
              onClick={toggleThinkingLatch}
              style={{
                width: 48,
                height: 26,
                borderRadius: 13,
                border: "none",
                cursor: thinkingLatch.value === true ? "not-allowed" : "pointer",
                position: "relative",
                background:
                  thinkingLatch.value === true
                    ? colors.latchStuck
                    : thinkingLatch.value === null
                      ? colors.latchOff
                      : colors.latchOn,
                transition: "background 0.2s",
              }}
            >
              <motion.div
                animate={{
                  x: thinkingLatch.value === true ? 22 : thinkingLatch.value === null ? 0 : 22,
                }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  background: "#fff",
                  position: "absolute",
                  top: 2,
                  left: 2,
                  boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                }}
              />
            </button>
          </div>

          {/* State indicator */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              fontFamily: "var(--font-mono)",
            }}
          >
            <span style={{ color: colors.textSecondary }}>锁存器状态：</span>
            <span
              style={{
                fontWeight: 600,
                color:
                  thinkingLatch.value === null
                    ? colors.textSecondary
                    : thinkingLatch.value
                      ? colors.latchStuck
                      : colors.textSecondary,
              }}
            >
              {thinkingLatch.value === null
                ? "null（未求值）"
                : thinkingLatch.value
                  ? "true（已锁存）"
                  : "false"}
            </span>
          </div>

          {thinkingLatch.value === true && (
            <motion.button
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              onClick={resetLatch}
              style={{
                background: "transparent",
                border: `1px solid ${colors.border}`,
                borderRadius: 6,
                padding: "4px 12px",
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                color: colors.textSecondary,
                cursor: "pointer",
              }}
            >
              重置演示
            </motion.button>
          )}
        </div>

        {/* Explanation */}
        <AnimatePresence>
          {thinkingLatch.value === true && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3 }}
              style={{
                marginTop: 12,
                padding: "10px 12px",
                borderRadius: 6,
                background: isDark ? "rgba(239,68,68,0.1)" : "rgba(239,68,68,0.06)",
                border: `1px solid ${isDark ? "rgba(239,68,68,0.3)" : "rgba(239,68,68,0.15)"}`,
                fontSize: 12,
                color: colors.text,
                lineHeight: 1.6,
                overflow: "hidden",
              }}
            >
              <strong style={{ color: colors.latchStuck }}>开关已被锁定在开启状态。</strong>{" "}
              一旦激活扩展思考，<code style={{ fontSize: 11, padding: "1px 4px", borderRadius: 3, background: isDark ? "#333" : "#e8e6dc" }}>thinkingClearLatched</code> 标志
              将在整个会话期间保持为 <code style={{ fontSize: 11, padding: "1px 4px", borderRadius: 3, background: isDark ? "#333" : "#e8e6dc" }}>true</code>。{" "}
              <strong>为什么？</strong> 思考预算属于 API 请求体的一部分，而请求体又是 prompt cache key 的组成部分。
              将其关闭会导致服务端缓存失效，影响超过 50,000 token 的系统提示词。
              该锁存器确保你仅在需要时进入特定的缓存命名空间，之后便一直保持在该命名空间中。
            </motion.div>
          )}
        </AnimatePresence>

        {/* Three-state type reference */}
        <div
          style={{
            marginTop: 12,
            display: "flex",
            gap: 16,
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            color: colors.textSecondary,
            flexWrap: "wrap",
          }}
        >
          <span>
            <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: colors.latchOff, marginRight: 4, verticalAlign: "middle" }} />
            null = 未求值
          </span>
          <span>
            <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: colors.latchStuck, marginRight: 4, verticalAlign: "middle" }} />
            true = 已锁存（永久）
          </span>
          <span>
            <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: colors.textSecondary, marginRight: 4, verticalAlign: "middle" }} />
            永远不会回退到 false
          </span>
        </div>
      </div>

      {/* Architecture summary table */}
      <div
        style={{
          marginTop: 16,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
        }}
      >
        <div
          style={{
            background: colors.bgCard,
            borderRadius: 6,
            padding: "10px 12px",
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            color: colors.textSecondary,
            lineHeight: 1.7,
          }}
        >
          <div style={{ fontWeight: 600, color: colors.terracotta, marginBottom: 4 }}>Bootstrap STATE</div>
          <div>消费者：API 客户端、成本追踪器、上下文构建器</div>
          <div>持久化：进程退出处理程序</div>
          <div>依赖项：DAG 叶节点（无依赖）</div>
          <div>测试重置：resetStateForTests()</div>
        </div>
        <div
          style={{
            background: colors.bgCard,
            borderRadius: 6,
            padding: "10px 12px",
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            color: colors.textSecondary,
            lineHeight: 1.7,
          }}
        >
          <div style={{ fontWeight: 600, color: colors.green, marginBottom: 4 }}>AppState Store</div>
          <div>消费者：React 组件、副作用</div>
          <div>持久化：通过 onChange 写入磁盘</div>
          <div>依赖项：跨代码库导入类型</div>
          <div>测试重置：创建新的 store 实例</div>
        </div>
      </div>
    </div>
  );
}
