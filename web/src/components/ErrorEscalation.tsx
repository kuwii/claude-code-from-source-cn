import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";

// --- Dark Mode Hook ---

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

// --- Data Types ---

interface EscalationStep {
  id: number;
  label: string;
  description: string;
  detail: string;
  successCriteria: string;
}

interface ErrorType {
  id: string;
  title: string;
  code: string;
  icon: string;
  steps: EscalationStep[];
}

// --- Error Type Data ---

const errorTypes: ErrorType[] = [
  {
    id: "prompt-too-long",
    title: "Prompt 过长",
    code: "413",
    icon: "\u26A0",
    steps: [
      {
        id: 1,
        label: "上下文折叠清理",
        description:
          "清理已暂存的上下文折叠——移除冗长的工具调用结果以及之前已标记为待删除的对话片段。",
        detail:
          "上下文管道会主动进行分阶段折叠。此步骤仅负责执行刷新操作。成本低且速度快。",
        successCriteria: "Token 数量降至模型上下文窗口限制以下",
      },
      {
        id: 2,
        label: "响应式压缩",
        description:
          "通过专用的压缩子代理进行紧急摘要处理。将整个对话重写为精简的摘要。",
        detail:
          "单次触发保护：hasAttemptedReactiveCompact 可防止无限循环。每种错误类型仅触发一次，不再重复。",
        successCriteria:
          "压缩成功，且新的 Token 数量符合上下文窗口要求",
      },
      {
        id: 3,
        label: "抛出错误并退出",
        description:
          "所有恢复手段均已耗尽。错误最终向用户展示，循环终止。",
        detail:
          '返回 Terminal { reason: "prompt_too_long" }。错误暂扣模式在此结束——这是用户首次看到该错误。',
        successCriteria: "不适用——终态",
      },
    ],
  },
  {
    id: "max-output-tokens",
    title: "最大输出 Token 数",
    code: "max_tokens",
    icon: "\u2702",
    steps: [
      {
        id: 1,
        label: "8K \u2192 64K 升级",
        description:
          "默认输出上限为 8,000 tokens（p99 输出为 4,911）。达到上限时，通过 maxOutputTokensOverride 升级至 64K。",
        detail:
          "仅有不到 1% 的请求会触及 8K 上限。较低的默认值在集群规模下可节省大量成本。",
        successCriteria: "响应在 64K tokens 内完成",
      },
      {
        id: 2,
        label: "多轮恢复 (\u00D73)",
        description:
          "在 64K 限制下仍触及上限。保留模型的部分响应，并发送继续生成请求。最多尝试 3 次。",
        detail:
          "maxOutputTokensRecoveryCount 用于追踪尝试次数。每次继续生成都会追加部分输出，并要求模型继续。",
        successCriteria:
          "模型在 3 次继续生成尝试内完成响应",
      },
      {
        id: 3,
        label: "抛出错误并退出",
        description:
          "3 次恢复尝试均已耗尽。保留累积的部分输出，但循环退出。",
        detail:
          '返回带有部分输出的 Terminal { reason: "completed" }。用户将看到模型已成功生成的内容。',
        successCriteria: "不适用——终态",
      },
    ],
  },
  {
    id: "media-size",
    title: "媒体 / 大小错误",
    code: "media_error",
    icon: "\uD83D\uDDBC",
    steps: [
      {
        id: 1,
        label: "移除媒体后重试",
        description:
          "从请求中剥离媒体附件（图片、PDF）并重试。使用响应式压缩重建上下文，剔除超大内容。",
        detail:
          "由 ImageSizeError、ImageResizeError 或类似错误触发。单次触发的 hasAttemptedReactiveCompact 保护机制在此同样适用。",
        successCriteria:
          "移除媒体并重新压缩上下文后请求成功",
      },
      {
        id: 2,
        label: "抛出错误并退出",
        description:
          "移除媒体未能解决问题。错误向用户展示。",
        detail:
          '返回 Terminal { reason: "image_error" }。独立的终止原因允许调用方显示针对媒体的特定指引。',
        successCriteria: "不适用——终态",
      },
    ],
  },
];

// --- Step Status ---

type StepStatus = "idle" | "active" | "success" | "failure";

// --- Component ---

export default function ErrorEscalation({
  className = "",
}: {
  className?: string;
}) {
  const isDark = useDarkMode();
  const [selectedError, setSelectedError] = useState<string>("prompt-too-long");
  const [stepStatuses, setStepStatuses] = useState<Record<string, StepStatus>>(
    {}
  );
  const [recoveryStep, setRecoveryStep] = useState<number>(1);
  const [isAnimating, setIsAnimating] = useState(false);
  const [showWithholding, setShowWithholding] = useState(false);
  const animationRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentError = errorTypes.find((e) => e.id === selectedError)!;
  const maxSteps = currentError.steps.length;

  // Colors
  const colors = {
    bg: isDark ? "#1e1e1c" : "#ffffff",
    surface: isDark ? "#2a2a28" : "#f5f4ed",
    surfaceHover: isDark ? "#333331" : "#e8e6dc",
    text: isDark ? "#f5f4ed" : "#141413",
    textMuted: isDark ? "#87867f" : "#87867f",
    border: isDark ? "#444" : "#c2c0b6",
    terracotta: "#d97757",
    green: "#22c55e",
    red: "#ef4444",
    greenBg: isDark ? "rgba(34, 197, 94, 0.1)" : "rgba(34, 197, 94, 0.08)",
    redBg: isDark ? "rgba(239, 68, 68, 0.1)" : "rgba(239, 68, 68, 0.08)",
    terracottaBg: isDark
      ? "rgba(217, 119, 87, 0.15)"
      : "rgba(217, 119, 87, 0.1)",
    withholdBg: isDark
      ? "rgba(237, 161, 0, 0.12)"
      : "rgba(237, 161, 0, 0.08)",
  };

  const resetAnimation = useCallback(() => {
    if (animationRef.current) clearTimeout(animationRef.current);
    setStepStatuses({});
    setIsAnimating(false);
    setShowWithholding(false);
  }, []);

  // Reset when error type changes
  useEffect(() => {
    resetAnimation();
  }, [selectedError, resetAnimation]);

  const triggerError = useCallback(() => {
    if (isAnimating) return;
    resetAnimation();
    setIsAnimating(true);
    setShowWithholding(true);

    const steps = currentError.steps;
    let delay = 600;

    // Animate through steps
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const stepKey = `${currentError.id}-${step.id}`;
      const isRecoveryPoint = i + 1 === recoveryStep;
      const isLastStep = i === steps.length - 1;

      // Mark active
      const activateDelay = delay;
      animationRef.current = setTimeout(() => {
        setStepStatuses((prev) => ({ ...prev, [stepKey]: "active" }));
      }, activateDelay);
      delay += 1200;

      // Mark result
      const resultDelay = delay;
      if (isRecoveryPoint && !isLastStep) {
        // Recovery succeeds here
        animationRef.current = setTimeout(() => {
          setStepStatuses((prev) => ({ ...prev, [stepKey]: "success" }));
          setShowWithholding(false);
          setTimeout(() => setIsAnimating(false), 400);
        }, resultDelay);
        break;
      } else if (isLastStep) {
        // Terminal failure
        animationRef.current = setTimeout(() => {
          setStepStatuses((prev) => ({ ...prev, [stepKey]: "failure" }));
          setShowWithholding(false);
          setTimeout(() => setIsAnimating(false), 400);
        }, resultDelay);
      } else {
        // Step fails, escalate
        animationRef.current = setTimeout(() => {
          setStepStatuses((prev) => ({ ...prev, [stepKey]: "failure" }));
        }, resultDelay);
        delay += 600;
      }
    }
  }, [isAnimating, currentError, recoveryStep, resetAnimation]);

  const getStepStatus = (stepId: number): StepStatus => {
    return stepStatuses[`${currentError.id}-${stepId}`] || "idle";
  };

  const statusIcon = (status: StepStatus) => {
    switch (status) {
      case "success":
        return "\u2713";
      case "failure":
        return "\u2717";
      case "active":
        return "\u25CF";
      default:
        return null;
    }
  };

  const statusColor = (status: StepStatus) => {
    switch (status) {
      case "success":
        return colors.green;
      case "failure":
        return colors.red;
      case "active":
        return colors.terracotta;
      default:
        return colors.border;
    }
  };

  const statusBg = (status: StepStatus) => {
    switch (status) {
      case "success":
        return colors.greenBg;
      case "failure":
        return colors.redBg;
      case "active":
        return colors.terracottaBg;
      default:
        return "transparent";
    }
  };

  return (
    <div
      className={className}
      style={{
        fontFamily: "var(--font-serif)",
        color: colors.text,
        maxWidth: 820,
        margin: "0 auto",
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h3
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: 20,
            fontWeight: 600,
            margin: "0 0 6px 0",
            color: colors.text,
          }}
        >
          错误恢复升级阶梯
        </h3>
        <p
          style={{
            fontSize: 14,
            color: colors.textMuted,
            margin: 0,
            lineHeight: 1.5,
          }}
        >
          在静默进行恢复尝试期间，错误会被
          <strong style={{ color: colors.terracotta }}>
            从流中暂扣
          </strong>
          。只有当所有步骤均失败时，用户才会看到错误。
        </p>
      </div>

      {/* Error Type Tabs */}
      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 20,
          flexWrap: "wrap",
        }}
      >
        {errorTypes.map((err) => {
          const isSelected = selectedError === err.id;
          return (
            <button
              key={err.id}
              onClick={() => setSelectedError(err.id)}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                border: `1px solid ${isSelected ? colors.terracotta : colors.border}`,
                background: isSelected ? colors.terracottaBg : colors.surface,
                color: isSelected ? colors.terracotta : colors.text,
                cursor: "pointer",
                fontFamily: "var(--font-mono)",
                fontSize: 13,
                fontWeight: isSelected ? 600 : 400,
                transition: "all 0.15s ease",
              }}
            >
              <span style={{ marginRight: 6 }}>{err.icon}</span>
              {err.title}
              <span
                style={{
                  marginLeft: 8,
                  fontSize: 11,
                  opacity: 0.6,
                }}
              >
                {err.code}
              </span>
            </button>
          );
        })}
      </div>

      {/* Controls Row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          marginBottom: 20,
          flexWrap: "wrap",
        }}
      >
        <button
          onClick={triggerError}
          disabled={isAnimating}
          style={{
            padding: "8px 20px",
            borderRadius: 8,
            border: "none",
            background: isAnimating ? colors.textMuted : colors.terracotta,
            color: "#fff",
            cursor: isAnimating ? "not-allowed" : "pointer",
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            fontWeight: 600,
            transition: "all 0.15s ease",
          }}
        >
          {isAnimating ? "恢复中..." : "触发错误"}
        </button>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
            color: colors.textMuted,
          }}
        >
          <label
            style={{
              fontFamily: "var(--font-mono)",
              whiteSpace: "nowrap",
            }}
          >
            恢复成功所在步骤：
          </label>
          <div style={{ display: "flex", gap: 4 }}>
            {currentError.steps.map((step, i) => {
              const isTerminal = i === currentError.steps.length - 1;
              return (
                <button
                  key={step.id}
                  onClick={() => {
                    if (!isAnimating) {
                      setRecoveryStep(step.id);
                      resetAnimation();
                    }
                  }}
                  disabled={isAnimating}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 6,
                    border: `1px solid ${recoveryStep === step.id ? colors.terracotta : colors.border}`,
                    background:
                      recoveryStep === step.id
                        ? colors.terracottaBg
                        : colors.surface,
                    color:
                      recoveryStep === step.id
                        ? colors.terracotta
                        : isTerminal
                          ? colors.red
                          : colors.text,
                    cursor: isAnimating ? "not-allowed" : "pointer",
                    fontFamily: "var(--font-mono)",
                    fontSize: 13,
                    fontWeight: recoveryStep === step.id ? 700 : 400,
                  }}
                  title={
                    isTerminal
                      ? "所有恢复均失败"
                      : `在第 ${step.id} 步恢复成功`
                  }
                >
                  {isTerminal ? "\u2717" : step.id}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Withholding Banner */}
      <AnimatePresence>
        {showWithholding && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            style={{
              background: colors.withholdBg,
              border: `1px solid rgba(237, 161, 0, 0.3)`,
              borderRadius: 8,
              padding: "10px 16px",
              marginBottom: 16,
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              color: "#eda100",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <motion.span
              animate={{ opacity: [1, 0.4, 1] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            >
              \u25CF
            </motion.span>
            <span>
              错误已从流中暂扣——正在恢复中。用户当前不可见任何异常。
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Escalation Ladder */}
      <div
        style={{
          border: `1px solid ${colors.border}`,
          borderRadius: 12,
          overflow: "hidden",
          background: colors.surface,
        }}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={currentError.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            {currentError.steps.map((step, idx) => {
              const status = getStepStatus(step.id);
              const isLast = idx === currentError.steps.length - 1;

              return (
                <div key={step.id}>
                  <motion.div
                    animate={{
                      backgroundColor: statusBg(status),
                    }}
                    transition={{ duration: 0.3 }}
                    style={{
                      padding: "16px 20px",
                      position: "relative",
                    }}
                  >
                    {/* Step Header */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 12,
                      }}
                    >
                      {/* Step Number / Status */}
                      <motion.div
                        animate={{
                          borderColor: statusColor(status),
                          color: statusColor(status),
                        }}
                        transition={{ duration: 0.3 }}
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: "50%",
                          border: `2px solid ${statusColor(status)}`,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontFamily: "var(--font-mono)",
                          fontSize: 14,
                          fontWeight: 700,
                          flexShrink: 0,
                        }}
                      >
                        {status === "active" ? (
                          <motion.span
                            animate={{ scale: [1, 1.3, 1] }}
                            transition={{
                              duration: 0.8,
                              repeat: Infinity,
                            }}
                          >
                            {statusIcon(status)}
                          </motion.span>
                        ) : statusIcon(status) ? (
                          <motion.span
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{
                              type: "spring",
                              stiffness: 300,
                              damping: 15,
                            }}
                          >
                            {statusIcon(status)}
                          </motion.span>
                        ) : (
                          step.id
                        )}
                      </motion.div>

                      {/* Step Content */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "baseline",
                            gap: 8,
                            marginBottom: 4,
                          }}
                        >
                          <span
                            style={{
                              fontFamily: "var(--font-mono)",
                              fontSize: 14,
                              fontWeight: 600,
                              color:
                                status !== "idle"
                                  ? statusColor(status)
                                  : colors.text,
                            }}
                          >
                            {step.label}
                          </span>
                          {status === "success" && (
                            <motion.span
                              initial={{ opacity: 0, x: -8 }}
                              animate={{ opacity: 1, x: 0 }}
                              style={{
                                fontFamily: "var(--font-mono)",
                                fontSize: 12,
                                color: colors.green,
                                fontWeight: 600,
                              }}
                            >
                              已恢复！
                            </motion.span>
                          )}
                          {status === "failure" && isLast && (
                            <motion.span
                              initial={{ opacity: 0, x: -8 }}
                              animate={{ opacity: 1, x: 0 }}
                              style={{
                                fontFamily: "var(--font-mono)",
                                fontSize: 12,
                                color: colors.red,
                                fontWeight: 600,
                              }}
                            >
                              所有恢复手段已耗尽
                            </motion.span>
                          )}
                        </div>
                        <p
                          style={{
                            fontSize: 13,
                            color: colors.textMuted,
                            margin: "0 0 6px 0",
                            lineHeight: 1.5,
                          }}
                        >
                          {step.description}
                        </p>
                        <div
                          style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: 11,
                            color: colors.textMuted,
                            opacity: 0.8,
                            lineHeight: 1.5,
                          }}
                        >
                          {step.detail}
                        </div>

                        {/* Success criteria */}
                        <div
                          style={{
                            marginTop: 8,
                            fontSize: 12,
                            fontFamily: "var(--font-mono)",
                            color:
                              status === "success"
                                ? colors.green
                                : colors.textMuted,
                            opacity: status === "idle" ? 0.5 : 0.9,
                          }}
                        >
                          <span style={{ opacity: 0.6 }}>\u2192 </span>
                          {step.successCriteria}
                        </div>
                      </div>
                    </div>
                  </motion.div>

                  {/* Escalation Arrow */}
                  {!isLast && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        paddingLeft: 34,
                        height: 28,
                        position: "relative",
                      }}
                    >
                      <motion.div
                        animate={{
                          opacity:
                            getStepStatus(step.id) === "failure" ? 1 : 0.3,
                          color:
                            getStepStatus(step.id) === "failure"
                              ? colors.red
                              : colors.border,
                        }}
                        transition={{ duration: 0.3 }}
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 12,
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <span style={{ fontSize: 16 }}>\u2193</span>
                        <span>
                          {getStepStatus(step.id) === "failure"
                            ? "失败——正在升级..."
                            : "升级至"}
                        </span>
                      </motion.div>
                    </div>
                  )}
                </div>
              );
            })}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Death Spiral Guards */}
      <div
        style={{
          marginTop: 16,
          padding: "12px 16px",
          borderRadius: 8,
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          fontSize: 12,
          fontFamily: "var(--font-mono)",
          color: colors.textMuted,
          lineHeight: 1.6,
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 6, color: colors.text }}>
          死循环防护机制
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span>
            \u2022 <code>hasAttemptedReactiveCompact</code>——单次触发标志，每种错误仅触发一次
          </span>
          <span>
            \u2022 <code>MAX_OUTPUT_TOKENS_RECOVERY_LIMIT = 3</code>——继续生成的硬性上限
          </span>
          <span>
            \u2022 连续 3 次失败后触发自动压缩熔断器
          </span>
          <span>
            \u2022 错误响应不触发 stop hooks（防止出现“错误 \u2192 hook \u2192 重试 \u2192 错误”的死循环）
          </span>
        </div>
      </div>
    </div>
  );
}
