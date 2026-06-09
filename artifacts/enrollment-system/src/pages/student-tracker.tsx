import { useRoute, useLocation } from "wouter";
import { useGetStudentQueueStatus, getGetStudentQueueStatusQueryKey } from "@workspace/api-client-react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, Clock, CheckCircle, Loader2 } from "lucide-react";
import { CcsLogo } from "@/components/ccs-logo";

type QueueStatusView = {
  status: string;
  workflow: string;
  taggerCounterId?: number | null;
  taggerCounterName?: string | null;
  assignedCounterName?: string | null;
};

type Step = {
  key: string;
  label: string;
  sub: string;
};

const EVALUATION_ENROLLMENT_STEPS: Step[] = [
  { key: "registered", label: "Registered", sub: "Queue number assigned" },
  { key: "evaluating", label: "Evaluating", sub: "In evaluation" },
  { key: "tagging", label: "Tagging", sub: "Processing enrollment" },
  { key: "done", label: "Enrolled", sub: "Enrollment complete" },
];

const EVALUATION_ONLY_STEPS: Step[] = [
  { key: "registered", label: "Registered", sub: "Queue number assigned" },
  { key: "evaluating", label: "Evaluating", sub: "In evaluation" },
  { key: "evaluation_completed", label: "Evaluation Completed", sub: "Evaluation complete" },
];

const DIRECT_TAGGING_STEPS: Step[] = [
  { key: "registered", label: "Registered", sub: "Queue number assigned" },
  { key: "tagging", label: "Tagging", sub: "Processing enrollment" },
  { key: "done", label: "Enrolled", sub: "Enrollment complete" },
];

function getSteps(queue: QueueStatusView) {
  if (queue.status === "evaluation_completed") return EVALUATION_ONLY_STEPS;
  if (queue.workflow === "direct_tagging") return DIRECT_TAGGING_STEPS;
  return EVALUATION_ENROLLMENT_STEPS;
}

function getStepIndex(queue: QueueStatusView, steps: Step[]) {
  if (queue.status === "cancelled") return -1;
  if (queue.status === "completed" || queue.status === "evaluation_completed") return steps.length - 1;

  const taggingStepIndex = steps.findIndex((step) => step.key === "tagging");
  const hasTaggingAssignment = Boolean(queue.taggerCounterId || queue.taggerCounterName);

  if (queue.workflow === "direct_tagging") {
    if (queue.status === "called" || queue.status === "in_progress") return taggingStepIndex;
    return 0;
  }

  if (hasTaggingAssignment && taggingStepIndex >= 0) return taggingStepIndex;

  switch (queue.status) {
    case "called":
    case "in_progress":
      return steps.findIndex((step) => step.key === "evaluating");
    default:
      return 0;
  }
}

export default function StudentTracker() {
  const [, params] = useRoute("/track/:queueId");
  const [, setLocation] = useLocation();
  const queueId = params?.queueId ? parseInt(params.queueId, 10) : 0;

  const { data: qs, isLoading, error } = useGetStudentQueueStatus(queueId, {
    query: {
      enabled: !!queueId,
      queryKey: getGetStudentQueueStatusQueryKey(queueId),
      refetchInterval: 3000,
    },
  });

  if (isLoading) {
    return (
      <div
        className="min-h-screen w-full flex items-center justify-center"
        style={{ background: "linear-gradient(160deg, #ffffff 0%, #fdf7f8 50%, #f8eef1 100%)" }}
      >
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: "#800020" }} />
          <p style={{ color: "#6b7280", fontSize: "14px" }}>Loading your queue status...</p>
        </div>
      </div>
    );
  }

  if (error || !qs) {
    return (
      <div
        className="min-h-screen w-full flex items-center justify-center p-4"
        style={{ background: "linear-gradient(160deg, #ffffff 0%, #fdf7f8 50%, #f8eef1 100%)" }}
      >
        <div className="text-center">
          <div
            className="w-16 h-16 rounded-full mx-auto flex items-center justify-center mb-4"
            style={{ background: "rgba(239,68,68,0.08)" }}
          >
            <span style={{ fontSize: "28px" }}>?</span>
          </div>
          <h2 className="font-bold text-gray-900 text-lg mb-2">Queue Not Found</h2>
          <p className="text-gray-400 text-sm mb-5">We couldn't find that queue number.</p>
          <button
            onClick={() => setLocation("/")}
            style={{
              padding: "10px 24px",
              borderRadius: "10px",
              background: "linear-gradient(135deg, #800020, #4a0012)",
              color: "white",
              fontWeight: 600,
              border: "none",
              cursor: "pointer",
              fontSize: "14px",
            }}
          >
            Register Again
          </button>
        </div>
      </div>
    );
  }

  const steps = getSteps(qs);
  const stepIndex = getStepIndex(qs, steps);
  const isCancelled = qs.status === "cancelled";
  const evaluatorName = qs.workflow === "evaluation" && !qs.taggerCounterId ? qs.assignedCounterName : null;
  const taggerName =
    qs.workflow === "direct_tagging"
      ? qs.assignedCounterName || qs.taggerCounterName
      : qs.taggerCounterName || (qs.taggerCounterId ? qs.assignedCounterName : null);
  const assignments = [
    evaluatorName ? { label: "Evaluator", name: evaluatorName } : null,
    taggerName ? { label: "Tagger", name: taggerName } : null,
  ].filter((item): item is { label: string; name: string } => Boolean(item));

  return (
    <div
      className="min-h-screen w-full flex flex-col items-center justify-start py-10 px-4 relative overflow-hidden"
      style={{ background: "linear-gradient(160deg, #ffffff 0%, #fdf7f8 50%, #f8eef1 100%)" }}
    >
      {/* Back */}
      <div className="w-full max-w-sm mb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <CcsLogo size="small" className="shrink-0" />
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest text-gray-500">College of Computer Studies</div>
            <div className="text-sm font-bold text-foreground">Queue Tracker</div>
          </div>
        </div>
        <button
          onClick={() => setLocation("/")}
          className="flex items-center gap-1 text-sm transition-colors"
          style={{ color: "#9ca3af", background: "none", border: "none", cursor: "pointer", padding: 0 }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#374151")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "#9ca3af")}
        >
          <ChevronLeft className="w-4 h-4" /> Back to kiosk
        </button>
      </div>

      {/* Main card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-sm z-10 overflow-hidden"
        style={{
          background: "rgba(255,255,255,0.9)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          borderRadius: "24px",
          border: "1px solid rgba(128,0,32,0.1)",
          boxShadow: "0 24px 60px -12px rgba(0,0,0,0.08)",
        }}
      >
        {/* Queue number hero */}
        <div
          className="p-8 text-center"
          style={{ borderBottom: "1px solid rgba(0,0,0,0.06)" }}
        >
          <p
            style={{
              fontSize: "11px",
              fontWeight: 600,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "#9ca3af",
              marginBottom: "8px",
            }}
          >
            Queue Number
          </p>
          <AnimatePresence mode="wait">
            <motion.div
              key={qs.queueNumber}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              style={{
                fontSize: "72px",
                fontWeight: 900,
                letterSpacing: "-0.03em",
                color: isCancelled ? "#9ca3af" : "#800020",
                lineHeight: 1,
              }}
            >
              {qs.queueNumber}
            </motion.div>
          </AnimatePresence>

          {/* Status badge */}
          <div className="mt-3 flex justify-center">
            {isCancelled ? (
              <span
                className="px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider"
                style={{ background: "rgba(107,114,128,0.1)", color: "#6b7280" }}
              >
                Cancelled
              </span>
            ) : qs.status === "called" ? (
              <motion.span
                animate={{ opacity: [1, 0.5, 1] }}
                transition={{ duration: 1.2, repeat: Infinity }}
                className="px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider"
                style={{ background: "rgba(128,0,32,0.1)", color: "#800020", border: "1px solid rgba(128,0,32,0.25)" }}
              >
                Now Called — Proceed to counter
              </motion.span>
            ) : qs.status === "completed" || qs.status === "evaluation_completed" ? (
              <span
                className="px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider flex items-center gap-1"
                style={{ background: "rgba(34,197,94,0.1)", color: "#16a34a" }}
              >
                <CheckCircle className="w-3 h-3" />
                {qs.status === "evaluation_completed" ? "Evaluation Completed" : "Enrollment Complete"}
              </span>
            ) : qs.assignedCounterName ? (
              <span
                className="px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider"
                style={{ background: "rgba(234,179,8,0.1)", color: "#b45309" }}
              >
                Waiting
              </span>
            ) : (
              <span
                className="px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider"
                style={{ background: "rgba(128,0,32,0.1)", color: "#800020" }}
              >
                Waiting for staff
              </span>
            )}
          </div>
        </div>

        {/* Staff Assignments block */}
        {!isCancelled && assignments.length > 0 && (
          <div className="mx-6 mt-6 mb-0 p-4 rounded-xl flex items-center justify-around text-center"
               style={{ background: "rgba(0,0,0,0.02)", border: "1px solid rgba(0,0,0,0.05)" }}>
            {assignments.map((assignment, index) => (
              <div key={assignment.label} className="contents">
                {index > 0 && <div className="w-px h-8 bg-black/10"></div>}
                <div className="flex-1">
                  <p style={{ fontSize: "10px", color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700, marginBottom: "4px" }}>
                    {assignment.label}
                  </p>
                  <p style={{ fontSize: "13px", fontWeight: 600, color: "#111827" }}>
                    {assignment.name}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Timeline */}
        {!isCancelled && (
          <div className="p-6">
            <p
              style={{
                fontSize: "11px",
                fontWeight: 600,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "#9ca3af",
                marginBottom: "20px",
              }}
            >
              Progress
            </p>
            <div className="relative">
              {steps.map((s, i) => {
                const isDone = i < stepIndex;
                const isActive = i === stepIndex;
                const isPending = i > stepIndex;
                return (
                  <div key={s.key} className="flex gap-4 relative">
                    {/* Connector line */}
                    {i < steps.length - 1 && (
                      <div
                        className="absolute left-4 top-8 w-0.5"
                        style={{
                          height: "calc(100% - 8px)",
                          background: isDone
                            ? "linear-gradient(180deg, #800020, #800020)"
                            : "rgba(0,0,0,0.08)",
                        }}
                      />
                    )}
                    {/* Dot */}
                    <div className="shrink-0 relative z-10">
                      <motion.div
                        className="w-8 h-8 rounded-full flex items-center justify-center"
                        style={{
                          background: isDone
                            ? "#800020"
                            : isActive
                            ? "rgba(128,0,32,0.12)"
                            : "rgba(0,0,0,0.05)",
                          border: isActive
                            ? "2px solid #800020"
                            : isDone
                            ? "none"
                            : "2px solid rgba(0,0,0,0.1)",
                        }}
                        animate={isActive ? { scale: [1, 1.1, 1] } : {}}
                        transition={{ duration: 1.5, repeat: Infinity }}
                      >
                        {isDone ? (
                          <CheckCircle className="w-4 h-4 text-white" />
                        ) : isActive ? (
                          <motion.div
                            className="w-2.5 h-2.5 rounded-full"
                            style={{ background: "#800020" }}
                            animate={{ opacity: [1, 0.4, 1] }}
                            transition={{ duration: 1, repeat: Infinity }}
                          />
                        ) : (
                          <div
                            className="w-2 h-2 rounded-full"
                            style={{ background: "rgba(0,0,0,0.2)" }}
                          />
                        )}
                      </motion.div>
                    </div>
                    {/* Label */}
                    <div className="pb-6">
                      <p
                        style={{
                          fontWeight: isActive ? 700 : isDone ? 600 : 400,
                          color: isDone
                            ? "#374151"
                            : isActive
                            ? "#800020"
                            : "#9ca3af",
                          fontSize: "14px",
                          lineHeight: 1.3,
                        }}
                      >
                        {s.label}
                      </p>
                      {(isDone || isActive) && (
                        <p
                          style={{
                            fontSize: "12px",
                            color: isActive ? "#800020" : "#9ca3af",
                            marginTop: "2px",
                          }}
                        >
                          {s.sub}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Stats (waiting info) */}
        {qs.status === "waiting" && (
          <div
            className="mx-6 mb-6 grid grid-cols-2 gap-3 p-4 rounded-xl"
            style={{ background: "rgba(0,0,0,0.03)", border: "1px solid rgba(0,0,0,0.05)" }}
          >
            <div className="text-center">
              <p style={{ fontSize: "11px", color: "#9ca3af", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>
                Position
              </p>
              <p style={{ fontSize: "28px", fontWeight: 700, color: "#111827", lineHeight: 1 }}>
                {qs.waitingPosition ?? "-"}
              </p>
            </div>
            <div className="text-center">
              <p style={{ fontSize: "11px", color: "#9ca3af", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>
                Est. Wait
              </p>
              <p style={{ fontSize: "28px", fontWeight: 700, color: "#111827", lineHeight: 1 }}>
                {qs.estimatedWaitMinutes ? `${qs.estimatedWaitMinutes}m` : "-"}
              </p>
            </div>
          </div>
        )}

        {/* Called: counter name */}
        {qs.status === "called" && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mx-6 mb-6 p-5 rounded-xl text-center"
            style={{
              background: "rgba(128,0,32,0.07)",
              border: "1.5px solid rgba(128,0,32,0.2)",
            }}
          >
            <p style={{ fontSize: "12px", color: "#9ca3af", marginBottom: "4px" }}>
              Please proceed to
            </p>
            <p style={{ fontSize: "22px", fontWeight: 800, color: "#800020" }}>
              {qs.assignedCounterName || qs.taggerCounterName || "Your Counter"}
            </p>
          </motion.div>
        )}

        {/* Student info footer */}
        <div
          className="px-6 py-4 flex items-center gap-3"
          style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}
        >
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
            style={{ background: "rgba(128,0,32,0.08)" }}
          >
            <span style={{ fontSize: "14px", fontWeight: 700, color: "#800020" }}>
              {qs.fullName.charAt(0).toUpperCase()}
            </span>
          </div>
          <div className="min-w-0">
            <p style={{ fontWeight: 600, color: "#111827", fontSize: "14px" }} className="truncate">
              {qs.fullName}
            </p>
            <p style={{ fontSize: "12px", color: "#9ca3af" }}>
              {qs.category.charAt(0).toUpperCase() + qs.category.slice(1)}
              {qs.yearLevel ? ` · ${qs.yearLevel} Year` : ""}
              {qs.regularity ? ` · ${qs.regularity.charAt(0).toUpperCase() + qs.regularity.slice(1)}` : ""}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-1 shrink-0">
            <Clock className="w-3.5 h-3.5" style={{ color: "#d1d5db" }} />
            <span style={{ fontSize: "11px", color: "#d1d5db" }}>Live</span>
          </div>
        </div>
      </motion.div>

      <p className="mt-6 text-xs z-10" style={{ color: "#d1d5db" }}>
        Updates automatically every 3 seconds
      </p>
    </div>
  );
}
