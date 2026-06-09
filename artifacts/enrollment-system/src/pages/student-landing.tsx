import { useRef, useState, useEffect } from "react";
import { motion, AnimatePresence, useInView } from "framer-motion";
import { useLocation } from "wouter";
import {
  useRegisterStudent,
  useGetTvDisplay, getGetTvDisplayQueryKey,
  useListAnnouncements, getListAnnouncementsQueryKey,
  useGetAnalyticsSummary, getGetAnalyticsSummaryQueryKey,
  useListCounters, getListCountersQueryKey,
  getStudentQueueByNumber,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { CcsLogo } from "@/components/ccs-logo";
import {
  ChevronRight, ChevronLeft, CheckCircle,
  Users, Hash, ClipboardCheck, Tag, GraduationCap,
  RefreshCw, UserRound, ArrowDown, Megaphone,
  Activity, Clock, ShieldCheck,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

type Category = "regular" | "wep" | "transferee" | "old";
type YearLevel = "1st" | "2nd" | "3rd" | "4th";
type Regularity = "regular" | "irregular";
type Step = "start" | "category" | "info" | "success";

interface FormData {
  fullName: string;
  studentNumber: string;
  category: Category | null;
  yearLevel: YearLevel | null;
  regularity: Regularity | null;
}

interface QueueResult {
  id: number;
  queueNumber: string;
  assignedCounterName: string | null;
}

// ─── Shared Styles ───────────────────────────────────────────────────────────

const MAROON = "#800020";
const MAROON_DARK = "#4a0012";

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: "44px",
  padding: "0 14px",
  borderRadius: "10px",
  fontSize: "14px",
  color: "#111827",
  outline: "none",
  background: "rgba(0,0,0,0.04)",
  border: "1.5px solid rgba(0,0,0,0.09)",
  fontFamily: "inherit",
  transition: "border 0.15s",
};

const btnPrimary: React.CSSProperties = {
  background: `linear-gradient(135deg, ${MAROON} 0%, ${MAROON_DARK} 100%)`,
  boxShadow: "0 4px 18px rgba(128,0,32,0.28)",
  color: "white",
  border: "none",
  borderRadius: "12px",
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "14px",
};

// ─── Section Reveal ──────────────────────────────────────────────────────────

function SectionReveal({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 32 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ─── Marquee ─────────────────────────────────────────────────────────────────

function Marquee({ items }: { items: string[] }) {
  if (!items.length) return null;
  const duped = [...items, ...items, ...items];
  return (
    <div className="overflow-hidden relative w-full" style={{ maskImage: "linear-gradient(to right, transparent 0%, black 6%, black 94%, transparent 100%)" }}>
      <motion.div
        animate={{ x: ["0%", "-33.333%"] }}
        transition={{ duration: Math.max(items.length * 8, 24), ease: "linear", repeat: Infinity }}
        style={{ display: "flex", gap: "2rem", width: "max-content", willChange: "transform" }}
      >
        {duped.map((item, i) => (
          <div
            key={i}
            className="flex items-center gap-2 whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium shrink-0"
            style={{ background: "rgba(128,0,32,0.07)", color: MAROON, border: "1px solid rgba(128,0,32,0.15)" }}
          >
            <Megaphone className="w-3.5 h-3.5" />
            {item}
          </div>
        ))}
      </motion.div>
    </div>
  );
}

// ─── Registration Card (Multi-Step Form) ─────────────────────────────────────

function RegistrationCard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const registerStudent = useRegisterStudent();

  const [step, setStep] = useState<Step>("start");
  const [form, setForm] = useState<FormData>({
    fullName: "", studentNumber: "", category: null, yearLevel: null, regularity: null,
  });
  const [queueResult, setQueueResult] = useState<QueueResult | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const doRegister = (data: FormData) => {
    if (!data.category) return;
    registerStudent.mutate(
      {
        data: {
          fullName: data.fullName.trim(),
          studentNumber: data.studentNumber.trim() || undefined,
          category: data.category,
          yearLevel: data.yearLevel ?? undefined,
          regularity: data.regularity ?? undefined,
        },
      },
      {
        onSuccess: (result) => {
          setQueueResult({
            id: result.id,
            queueNumber: result.queueNumber,
            assignedCounterName: result.assignedCounterName ?? result.taggerCounterName ?? null,
          });
          localStorage.setItem("activeQueueId", result.id.toString());
          setStep("success");
        },
        onError: () => toast({ title: "Registration failed", description: "Please try again.", variant: "destructive" }),
      }
    );
  };

  const handleInfoSubmit = () => {
    const errs: Record<string, string> = {};
    if (!form.fullName.trim() || form.fullName.trim().length < 2) errs.fullName = "Full name is required";
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    doRegister(form);
  };

  const handleCategorySelect = (cat: Category) => {
    setForm(f => ({ ...f, category: cat, yearLevel: null, regularity: null }));
    setStep("info");
  };

  const reset = () => {
    localStorage.removeItem("activeQueueId");
    setStep("start"); setForm({ fullName: "", studentNumber: "", category: null, yearLevel: null, regularity: null });
    setQueueResult(null); setErrors({});
  };

  const categoryCards = [
    { id: "regular" as Category, icon: <UserRound className="w-5 h-5" />, title: "Regular / New Student", sub: "First-time enrollment and regular enrollment." },
    { id: "wep" as Category, icon: <ShieldCheck className="w-5 h-5" />, title: "WEP", sub: "Working student program" },
    { id: "transferee" as Category, icon: <RefreshCw className="w-5 h-5" />, title: "Transferee", sub: "From another school" },
    { id: "old" as Category, icon: <GraduationCap className="w-5 h-5" />, title: "Old Student", sub: "Continuing / Returnee" },
  ];

  const stepIndicators = ["start", "category", "info"];
  const stepIdx = stepIndicators.indexOf(step);

  return (
    <div
      className="relative w-full overflow-hidden"
      style={{
        background: "rgba(255,255,255,0.82)",
        backdropFilter: "blur(28px)",
        WebkitBackdropFilter: "blur(28px)",
        borderRadius: "24px",
        border: "1px solid rgba(128,0,32,0.12)",
        boxShadow: "0 32px 80px -12px rgba(0,0,0,0.12), 0 0 0 1px rgba(255,255,255,0.9), inset 0 1px 0 rgba(255,255,255,0.95)",
      }}
    >
      {/* Top accent bar */}
      <div className="h-1 w-full" style={{ background: `linear-gradient(90deg, transparent 0%, ${MAROON} 40%, ${MAROON} 60%, transparent 100%)` }} />

      {/* Step progress (non-success) */}
      {step !== "success" && (
        <div className="px-7 pt-5 pb-0">
          <div className="flex items-center gap-1.5">
            {stepIndicators.map((s, i) => (
              <div
                key={s}
                className="h-0.5 flex-1 rounded-full transition-all duration-500"
                style={{ background: i <= stepIdx ? MAROON : "rgba(0,0,0,0.08)" }}
              />
            ))}
          </div>
        </div>
      )}

      <AnimatePresence mode="wait">
        {/* Step 1 — Start */}
        {step === "start" && (
          <motion.div key="start" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.22 }} className="p-10 flex flex-col items-center justify-center text-center">
            <CcsLogo size="large" className="mb-6" />
            <h3 className="text-xl font-black text-gray-900 mb-2 uppercase tracking-wide">Start Queue</h3>
            <p className="text-sm text-gray-500 mb-8 max-w-62.5">
              Choose your student type, enter your name, and receive your queue number instantly.
            </p>
            <button onClick={() => setStep("category")} style={{ ...btnPrimary, width: "100%", height: "54px", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", fontSize: "16px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Start Queue <ChevronRight className="w-5 h-5" />
            </button>
          </motion.div>
        )}

        {/* Step 2 — Category */}
        {step === "category" && (
          <motion.div key="cat" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.22 }} className="p-7">
            <button onClick={() => setStep("start")} style={{ color: "#9ca3af", background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: "12px", display: "flex", alignItems: "center", gap: "4px", marginBottom: "12px" }}>
              <ChevronLeft className="w-3.5 h-3.5" /> Back
            </button>
            <h3 className="text-base font-bold text-gray-900 mb-0.5">Student Type</h3>
            <p className="text-xs text-gray-400 mb-4">Select your enrollment category.</p>
            <div className="space-y-2">
              {categoryCards.map((card, i) => (
                <motion.button key={card.id}
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                  onClick={() => handleCategorySelect(card.id)}
                  disabled={registerStudent.isPending}
                  className="w-full text-left flex items-center gap-3 group active:scale-[0.98] disabled:opacity-50 transition-all"
                  style={{ padding: "12px 14px", borderRadius: "12px", border: "1.5px solid rgba(0,0,0,0.07)", background: "rgba(255,255,255,0.5)", cursor: "pointer" }}
                  onMouseEnter={e => { e.currentTarget.style.border = "1.5px solid rgba(128,0,32,0.3)"; e.currentTarget.style.background = "rgba(128,0,32,0.03)"; }}
                  onMouseLeave={e => { e.currentTarget.style.border = "1.5px solid rgba(0,0,0,0.07)"; e.currentTarget.style.background = "rgba(255,255,255,0.5)"; }}
                >
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(128,0,32,0.08)", color: MAROON }}>
                    {registerStudent.isPending && form.category === card.id
                      ? <span className="w-4 h-4 rounded-full border-2 animate-spin" style={{ borderColor: "rgba(128,0,32,0.25)", borderTopColor: MAROON }} />
                      : card.icon}
                  </div>
                  <div className="flex-1">
                    <div style={{ fontWeight: 600, fontSize: "13px", color: "#111827" }}>{card.title}</div>
                    <div style={{ fontSize: "11px", color: "#9ca3af" }}>{card.sub}</div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-200 group-hover:text-[#800020] transition-colors" />
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}

        {/* Step 3 — Info */}
        {step === "info" && (
          <motion.div key="info" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.22 }} className="p-7">
            <button onClick={() => setStep("category")} style={{ color: "#9ca3af", background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: "12px", display: "flex", alignItems: "center", gap: "4px", marginBottom: "12px" }}>
              <ChevronLeft className="w-3.5 h-3.5" /> Back
            </button>
            <h3 className="text-base font-bold text-gray-900 mb-0.5">Student Information</h3>
            <p className="text-xs text-gray-400 mb-5">Enter your details to get your queue number.</p>
            <div className="space-y-3">
              <div>
                <label htmlFor="student-full-name" style={{ display: "block", fontSize: "10px", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "#6b7280", marginBottom: "5px" }}>Full Name</label>
                <input
                  id="student-full-name"
                  name="fullName"
                  type="text" placeholder="Juan dela Cruz" value={form.fullName}
                  onChange={(e) => { setForm(f => ({ ...f, fullName: e.target.value })); setErrors({}); }}
                  style={{ ...inputStyle, border: errors.fullName ? "1.5px solid #ef4444" : inputStyle.border }}
                  onFocus={e => e.currentTarget.style.border = `1.5px solid ${MAROON}`}
                  onBlur={e => e.currentTarget.style.border = errors.fullName ? "1.5px solid #ef4444" : "1.5px solid rgba(0,0,0,0.09)"}
                />
                {errors.fullName && <p style={{ color: "#ef4444", fontSize: "11px", marginTop: "3px" }}>{errors.fullName}</p>}
              </div>
              <div>
                <label htmlFor="student-number" style={{ display: "block", fontSize: "10px", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "#6b7280", marginBottom: "5px" }}>
                  Student No. <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "#9ca3af" }}>(optional)</span>
                </label>
                <input id="student-number" name="studentNumber" type="text" placeholder="2023-0001" value={form.studentNumber}
                  onChange={(e) => setForm(f => ({ ...f, studentNumber: e.target.value }))}
                  style={inputStyle}
                  onFocus={e => e.currentTarget.style.border = `1.5px solid ${MAROON}`}
                  onBlur={e => e.currentTarget.style.border = "1.5px solid rgba(0,0,0,0.09)"}
                />
              </div>
            </div>
            
            <button onClick={handleInfoSubmit} disabled={registerStudent.isPending}
              style={{ ...btnPrimary, width: "100%", height: "44px", marginTop: "24px", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", opacity: registerStudent.isPending ? 0.6 : 1, cursor: registerStudent.isPending ? "not-allowed" : "pointer" }}
            >
              {registerStudent.isPending
                ? <><span className="w-4 h-4 rounded-full border-2 animate-spin" style={{ borderColor: "rgba(255,255,255,0.3)", borderTopColor: "white" }} />Generating...</>
                : <>Get Queue Number <ChevronRight className="w-4 h-4" /></>}
            </button>
          </motion.div>
        )}

        {/* Success */}
        {step === "success" && queueResult && (
          <motion.div key="ok" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }} className="p-7 text-center">
            <motion.div initial={{ scale: 0.5 }} animate={{ scale: 1 }} transition={{ delay: 0.05, type: "spring", stiffness: 220, damping: 14 }}
              className="w-16 h-16 rounded-full mx-auto flex items-center justify-center mb-4"
              style={{ background: "rgba(128,0,32,0.08)", border: `2px solid rgba(128,0,32,0.18)` }}
            >
              <CheckCircle className="w-8 h-8" style={{ color: MAROON }} />
            </motion.div>
            <p style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.18em", textTransform: "uppercase", color: "#9ca3af", marginBottom: "6px" }}>Your Queue Number</p>
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
              style={{ fontSize: "64px", fontWeight: 900, letterSpacing: "-0.03em", color: MAROON, lineHeight: 1, marginBottom: "12px" }}>
              {queueResult.queueNumber}
            </motion.div>
            {queueResult.assignedCounterName ? (
              <p style={{ fontSize: "13px", color: "#6b7280", marginBottom: "4px" }}>
                Assigned to <span style={{ fontWeight: 700, color: "#111827" }}>{queueResult.assignedCounterName}</span>
              </p>
            ) : (
              <p style={{ fontSize: "13px", color: "#b45309", marginBottom: "4px" }}>
                Waiting for available staff...
              </p>
            )}
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium mb-5" style={{ background: "rgba(128,0,32,0.07)", color: MAROON }}>
              <span className="w-1.5 h-1.5 rounded-full animate-pulse inline-block" style={{ background: MAROON }} /> {queueResult.assignedCounterName ? "Waiting" : "Standby"}
            </div>
            <div className="space-y-2">
              <button onClick={() => setLocation(`/track/${queueResult.id}`)} style={{ ...btnPrimary, width: "100%", height: "42px", display: "block" }}>Track My Status</button>
              <button onClick={reset} style={{ width: "100%", height: "36px", background: "none", border: "none", cursor: "pointer", fontSize: "12px", color: "#9ca3af" }}
                onMouseEnter={e => e.currentTarget.style.color = "#374151"} onMouseLeave={e => e.currentTarget.style.color = "#9ca3af"}
              >Register another student</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main Landing Page ────────────────────────────────────────────────────────

export default function StudentLanding() {
  const heroRef = useRef<HTMLDivElement>(null);
  const [, setLocation] = useLocation();
  const [activeQueueId, setActiveQueueId] = useState<string | null>(null);
  
  // Track form state
  const [trackNumber, setTrackNumber] = useState("");
  const [isTracking, setIsTracking] = useState(false);
  const [trackError, setTrackError] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem("activeQueueId");
    if (saved) setActiveQueueId(saved);
  }, []);

  const handleTrackSubmit = async () => {
    if (!trackNumber.trim()) return;
    setIsTracking(true);
    setTrackError("");
    try {
      const res = await getStudentQueueByNumber(trackNumber.trim());
      setLocation(`/track/${res.id}`);
    } catch (err: any) {
      if (err.response?.status === 404) {
        setTrackError("Queue number not found.");
      } else {
        setTrackError("Failed to track status.");
      }
    } finally {
      setIsTracking(false);
    }
  };

  const { data: tvDisplay } = useGetTvDisplay({
    query: { queryKey: getGetTvDisplayQueryKey(), refetchInterval: 4000 },
  });

  const { data: announcements } = useListAnnouncements({
    query: { queryKey: getListAnnouncementsQueryKey(), refetchInterval: 10000 },
  });

  const { data: summary } = useGetAnalyticsSummary({
    query: { queryKey: getGetAnalyticsSummaryQueryKey(), refetchInterval: 6000 },
  });

  const { data: counters } = useListCounters({
    query: { queryKey: getListCountersQueryKey(), refetchInterval: 6000 },
  });

  const nowEvaluating = tvDisplay?.nowServing.filter(s => s.counterType === "evaluator") ?? [];
  const nowTagging = tvDisplay?.nowServing.filter(s => s.counterType === "tagger") ?? [];
  const activeCounters = counters?.filter(c => c.isOnline && c.status !== "offline") ?? [];
  const announcementTexts = announcements?.filter(a => a.isActive).map(a => a.message) ?? [];

  const scrollToRegister = () => {
    heroRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Process steps data
  const processSteps = [
    { icon: <Users className="w-5 h-5" />, title: "Register", desc: "Enter your name and student number to get started." },
    { icon: <Hash className="w-5 h-5" />, title: "Queue Assignment", desc: "You're assigned a unique queue number instantly." },
    { icon: <ClipboardCheck className="w-5 h-5" />, title: "Evaluation", desc: "An evaluator reviews your enrollment requirements." },
    { icon: <Tag className="w-5 h-5" />, title: "Subject Tagging", desc: "Your subjects are encoded and tagged in the system." },
    { icon: <CheckCircle className="w-5 h-5" />, title: "Enrolled", desc: "Enrollment complete. You're officially enrolled." },
  ];

  return (
    <div style={{ background: "linear-gradient(170deg, #ffffff 0%, #fdf7f8 40%, #f9eef1 100%)", minHeight: "100vh" }}>

      {/* ── STICKY NAVBAR ───────────────────────────────────────────────── */}
      <motion.nav
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="sticky top-0 z-50 flex items-center justify-between px-8 py-4"
        style={{
          background: "rgba(255,255,255,0.82)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          borderBottom: "1px solid rgba(128,0,32,0.08)",
          boxShadow: "0 1px 0 rgba(0,0,0,0.04)",
        }}
      >
        {/* Logo + name */}
        <div className="flex items-center gap-3">
          <CcsLogo size="small" className="shrink-0" />
          <div>
            <p style={{ fontWeight: 700, fontSize: "13px", color: "#111827", lineHeight: 1 }}>College of Computer Studies Department</p>
            <p style={{ fontSize: "10px", color: "#9ca3af", lineHeight: 1.4 }}>Enrollment Queue</p>
          </div>
        </div>

        {/* Center — live badge */}
        {tvDisplay && tvDisplay.totalWaiting > 0 && (
          <motion.div
            animate={{ scale: [1, 1.03, 1] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
            className="hidden md:flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold"
            style={{ background: "rgba(128,0,32,0.07)", color: MAROON, border: "1px solid rgba(128,0,32,0.15)" }}
          >
            <span className="w-1.5 h-1.5 rounded-full animate-pulse inline-block" style={{ background: MAROON }} />
            {tvDisplay.totalWaiting} Students Currently Queued
          </motion.div>
        )}

        {/* Empty placeholder to keep flex spacing if needed, or just removed entirely */}
      </motion.nav>

      {/* ── HERO SECTION ─────────────────────────────────────────────────── */}
      <section ref={heroRef} className="min-h-[calc(100vh-64px)] flex items-center px-8 lg:px-16 py-16 max-w-7xl mx-auto gap-16 flex-col lg:flex-row">

        {/* Left — Typography */}
        <div className="flex-1 min-w-0 w-full">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.05 }}
          >
            {/* Department badge */}
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold mb-7"
              style={{ background: "rgba(128,0,32,0.07)", color: MAROON, border: "1px solid rgba(128,0,32,0.15)" }}>
              <Activity className="w-3.5 h-3.5" />
              CCS Department &nbsp;·&nbsp; AY 2025–2026
            </div>

            {/* Headline */}
            <h1 style={{ fontWeight: 900, fontSize: "clamp(2.5rem, 4vw, 3.75rem)", lineHeight: 1.08, letterSpacing: "-0.04em", color: "#0a0a0a", marginBottom: "20px" }}>
              College of Computer Studies Department<br />
              <span style={{
                backgroundImage: `linear-gradient(135deg, ${MAROON} 0%, #c00040 50%, ${MAROON_DARK} 100%)`,
                backgroundClip: "text",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}>Enrollment Queue</span>
            </h1>

            {/* Subtext */}
            <p style={{ fontSize: "16px", color: "#6b7280", lineHeight: 1.7, maxWidth: "460px", marginBottom: "36px" }}>
              A guided queue lane for new students. Register once, get your queue number, and track every enrollment step live.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 max-w-xl mb-8">
              {[
                { label: "1", text: "Select student type" },
                { label: "2", text: "Enter your details" },
                { label: "3", text: "Track your queue" },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-2 rounded-xl px-3 py-2"
                  style={{ background: "rgba(255,255,255,0.65)", border: "1px solid rgba(128,0,32,0.1)" }}>
                  <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white"
                    style={{ background: `linear-gradient(135deg, ${MAROON}, ${MAROON_DARK})` }}>
                    {item.label}
                  </span>
                  <span style={{ fontSize: "12px", color: "#374151", fontWeight: 600 }}>{item.text}</span>
                </div>
              ))}
            </div>

            {/* Live stat cards */}
            <div className="flex flex-wrap gap-3 mb-8">
              {[
                { label: "Waiting", value: summary?.totalWaiting ?? tvDisplay?.totalWaiting ?? 0, color: "#b45309" },
                { label: "In Progress", value: summary?.totalInProgress ?? 0, color: MAROON },
                { label: "Completed Today", value: summary?.totalCompleted ?? 0, color: "#15803d" },
              ].map(({ label, value, color }) => (
                <div key={label} className="px-4 py-2.5 rounded-xl"
                  style={{ background: "rgba(255,255,255,0.7)", border: "1px solid rgba(0,0,0,0.08)", backdropFilter: "blur(8px)" }}>
                  <AnimatePresence mode="wait">
                    <motion.div key={value} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
                      style={{ fontWeight: 800, fontSize: "22px", color, lineHeight: 1 }}>
                      {value}
                    </motion.div>
                  </AnimatePresence>
                  <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "2px", fontWeight: 500 }}>{label}</div>
                </div>
              ))}
            </div>

            {/* Scroll prompt */}
            <div className="flex items-center gap-4">
              <motion.button
                animate={{ y: [0, 5, 0] }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                onClick={scrollToRegister}
                className="flex items-center gap-2 text-sm"
                style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", padding: 0 }}
                onMouseEnter={e => e.currentTarget.style.color = MAROON}
                onMouseLeave={e => e.currentTarget.style.color = "#9ca3af"}
              >
                <ArrowDown className="w-4 h-4" /> Scroll to register
              </motion.button>
              
              {activeQueueId && (
                <button
                  onClick={() => setLocation(`/track/${activeQueueId}`)}
                  className="px-4 py-2 text-sm font-semibold rounded-full flex items-center gap-2 shadow-sm transition-transform hover:scale-105 active:scale-95"
                  style={{ background: "white", color: MAROON, border: `1px solid rgba(128,0,32,0.2)` }}
                >
                  <Activity className="w-4 h-4" /> Resume Tracking
                </button>
              )}
            </div>

            {/* Track Queue Number manually */}
            <div className="mt-8 pt-6 border-t max-w-sm" style={{ borderColor: "rgba(128,0,32,0.1)" }}>
              <p style={{ fontSize: "11px", fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "12px" }}>
                Already have a queue number?
              </p>
              <div className="flex gap-2">
                <input 
                  type="text" 
                  placeholder="e.g. DT-001 or E-005" 
                  value={trackNumber}
                  onChange={e => setTrackNumber(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleTrackSubmit()}
                  style={{ flex: 1, background: "rgba(255,255,255,0.7)", border: "1px solid rgba(0,0,0,0.1)", borderRadius: "12px", padding: "0 16px", fontSize: "14px", outline: "none", height: "42px" }}
                  onFocus={e => e.currentTarget.style.border = `1px solid ${MAROON}`}
                  onBlur={e => e.currentTarget.style.border = "1px solid rgba(0,0,0,0.1)"}
                />
                <button 
                  onClick={handleTrackSubmit}
                  disabled={isTracking}
                  style={{ background: `linear-gradient(135deg, ${MAROON} 0%, ${MAROON_DARK} 100%)`, color: "white", padding: "0 20px", borderRadius: "12px", fontSize: "13px", fontWeight: 600, border: "none", cursor: isTracking ? "not-allowed" : "pointer", opacity: isTracking ? 0.7 : 1, height: "42px" }}
                >
                  {isTracking ? "..." : "Track Status"}
                </button>
              </div>
              {trackError && <p style={{ fontSize: "12px", color: "#ef4444", marginTop: "8px", fontWeight: 500 }}>{trackError}</p>}
            </div>
          </motion.div>
        </div>

        {/* Right — Registration Card & Mini TV */}
        <motion.div
          initial={{ opacity: 0, x: 32, y: 16 }}
          animate={{ opacity: 1, x: 0, y: 0 }}
          transition={{ duration: 0.7, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
          className="w-full lg:w-100 shrink-0 space-y-6"
        >
          {/* Mini TV Display Monitor */}
          <div className="w-full bg-white rounded-2xl overflow-hidden border border-black/5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] relative">
            <div className="bg-black text-white p-3 flex justify-between items-center text-xs">
              <div className="flex items-center gap-2 font-bold tracking-widest"><Activity className="w-3.5 h-3.5 text-primary" /> LIVE MONITOR</div>
              <div className="text-gray-400">{new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</div>
            </div>
            <div className="p-4 bg-gray-50 flex items-center gap-4 overflow-x-auto snap-x">
              <AnimatePresence>
                {tvDisplay?.nowServing && tvDisplay.nowServing.length > 0 ? (
                  tvDisplay.nowServing.map((item) => (
                    <div key={`${item.queueNumber}-${item.status}`} className="snap-start shrink-0 w-32 bg-white p-3 rounded-xl border border-black/5 shadow-sm text-center">
                      <div className="text-[10px] text-gray-400 font-semibold uppercase tracking-widest mb-1">{item.counterType}</div>
                      <div className="text-2xl font-black text-foreground">{item.queueNumber}</div>
                      <div className="text-xs text-primary font-medium mt-1 truncate">{item.counterName}</div>
                    </div>
                  ))
                ) : (
                  <div className="w-full text-center py-4 text-xs text-gray-400 tracking-widest uppercase">No Active Calls</div>
                )}
              </AnimatePresence>
            </div>
          </div>

          <motion.div
            animate={{ y: [0, -4, 0] }}
            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
          >
            <RegistrationCard />
          </motion.div>
          <p style={{ textAlign: "center", fontSize: "11px", color: "#d1d5db", marginTop: "12px" }}>
            No account needed &nbsp;·&nbsp; Free &nbsp;·&nbsp; Instant queue number
          </p>
        </motion.div>
      </section>

      {/* ── LIVE QUEUE ACTIVITY ───────────────────────────────────────────── */}
      <section style={{ background: "rgba(128,0,32,0.03)", borderTop: "1px solid rgba(128,0,32,0.08)", borderBottom: "1px solid rgba(128,0,32,0.08)", padding: "64px 0" }}>
        <div className="max-w-7xl mx-auto px-8 lg:px-16">
          <SectionReveal>
            <div className="flex items-center justify-between mb-8">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-2 h-2 rounded-full animate-pulse inline-block" style={{ background: MAROON }} />
                  <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: MAROON }}>Live</span>
                </div>
                <h2 style={{ fontWeight: 800, fontSize: "26px", color: "#111827", letterSpacing: "-0.02em" }}>Queue Activity</h2>
              </div>
              <div style={{ fontSize: "13px", color: "#9ca3af" }}>Updates every 4 seconds</div>
            </div>
          </SectionReveal>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* Now Evaluating */}
            <SectionReveal>
              <div className="h-full rounded-2xl overflow-hidden"
                style={{ background: "rgba(255,255,255,0.85)", border: "1px solid rgba(128,0,32,0.1)", backdropFilter: "blur(12px)", boxShadow: "0 4px 24px rgba(0,0,0,0.05)" }}>
                <div className="px-5 py-4 border-b" style={{ borderColor: "rgba(128,0,32,0.08)" }}>
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(128,0,32,0.1)" }}>
                      <ClipboardCheck className="w-4 h-4" style={{ color: MAROON }} />
                    </div>
                    <div>
                      <p style={{ fontWeight: 700, fontSize: "13px", color: "#111827" }}>Now Evaluating</p>
                      <p style={{ fontSize: "11px", color: "#9ca3af" }}>{nowEvaluating.length} active</p>
                    </div>
                  </div>
                </div>
                <div className="p-4 space-y-2 min-h-30">
                  <AnimatePresence>
                    {nowEvaluating.length > 0 ? nowEvaluating.map((item, i) => (
                      <motion.div key={`${item.queueNumber}-${item.counterName}`}
                        initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ delay: i * 0.06 }}
                        className="flex items-center justify-between p-3 rounded-xl"
                        style={{ background: "rgba(128,0,32,0.05)", border: "1px solid rgba(128,0,32,0.1)" }}
                      >
                        <span style={{ fontWeight: 800, fontSize: "16px", color: MAROON }}>{item.queueNumber}</span>
                        <span style={{ fontSize: "11px", color: "#6b7280", fontWeight: 500 }}>{item.counterName}</span>
                      </motion.div>
                    )) : (
                      <div className="flex items-center justify-center h-20">
                        <p style={{ fontSize: "12px", color: "#d1d5db" }}>No active evaluations</p>
                      </div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </SectionReveal>

            {/* Now Tagging */}
            <SectionReveal>
              <div className="h-full rounded-2xl overflow-hidden"
                style={{ background: "rgba(255,255,255,0.85)", border: "1px solid rgba(128,0,32,0.1)", backdropFilter: "blur(12px)", boxShadow: "0 4px 24px rgba(0,0,0,0.05)" }}>
                <div className="px-5 py-4 border-b" style={{ borderColor: "rgba(128,0,32,0.08)" }}>
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(128,0,32,0.1)" }}>
                      <Tag className="w-4 h-4" style={{ color: MAROON }} />
                    </div>
                    <div>
                      <p style={{ fontWeight: 700, fontSize: "13px", color: "#111827" }}>Now Tagging</p>
                      <p style={{ fontSize: "11px", color: "#9ca3af" }}>{nowTagging.length} active</p>
                    </div>
                  </div>
                </div>
                <div className="p-4 space-y-2 min-h-30">
                  <AnimatePresence>
                    {nowTagging.length > 0 ? nowTagging.map((item, i) => (
                      <motion.div key={`${item.queueNumber}-${item.counterName}`}
                        initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ delay: i * 0.06 }}
                        className="flex items-center justify-between p-3 rounded-xl"
                        style={{ background: "rgba(128,0,32,0.05)", border: "1px solid rgba(128,0,32,0.1)" }}
                      >
                        <span style={{ fontWeight: 800, fontSize: "16px", color: MAROON }}>{item.queueNumber}</span>
                        <span style={{ fontSize: "11px", color: "#6b7280", fontWeight: 500 }}>{item.counterName}</span>
                      </motion.div>
                    )) : (
                      <div className="flex items-center justify-center h-20">
                        <p style={{ fontSize: "12px", color: "#d1d5db" }}>No active tagging</p>
                      </div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </SectionReveal>

            {/* Queue Stats + Active Counters */}
            <SectionReveal>
              <div className="h-full rounded-2xl overflow-hidden"
                style={{ background: "rgba(255,255,255,0.85)", border: "1px solid rgba(128,0,32,0.1)", backdropFilter: "blur(12px)", boxShadow: "0 4px 24px rgba(0,0,0,0.05)" }}>
                <div className="px-5 py-4 border-b" style={{ borderColor: "rgba(128,0,32,0.08)" }}>
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(128,0,32,0.1)" }}>
                      <Activity className="w-4 h-4" style={{ color: MAROON }} />
                    </div>
                    <div>
                      <p style={{ fontWeight: 700, fontSize: "13px", color: "#111827" }}>Queue Overview</p>
                      <p style={{ fontSize: "11px", color: "#9ca3af" }}>Live system status</p>
                    </div>
                  </div>
                </div>
                <div className="p-4">
                  <div className="grid grid-cols-2 gap-2 mb-4">
                    {[
                      { label: "Waiting", value: summary?.totalWaiting ?? tvDisplay?.totalWaiting ?? 0 },
                      { label: "In Progress", value: summary?.totalInProgress ?? 0 },
                      { label: "Completed", value: summary?.totalCompleted ?? 0 },
                      { label: "Counters Active", value: activeCounters.length },
                    ].map(({ label, value }) => (
                      <div key={label} className="p-3 rounded-xl text-center"
                        style={{ background: "rgba(128,0,32,0.04)", border: "1px solid rgba(128,0,32,0.07)" }}>
                        <div style={{ fontWeight: 800, fontSize: "22px", color: "#111827", lineHeight: 1 }}>{value}</div>
                        <div style={{ fontSize: "10px", color: "#9ca3af", marginTop: "2px" }}>{label}</div>
                      </div>
                    ))}
                  </div>
                  {/* Staff Status List */}
                  <div className="mt-4 border-t border-black/5 pt-4">
                    <div className="flex items-center justify-between mb-3">
                      <p style={{ fontSize: "11px", fontWeight: 700, color: "#111827", textTransform: "uppercase", letterSpacing: "0.05em" }}>Staff Availability</p>
                    </div>
                    <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                      {counters && counters.length > 0 ? counters.map(c => {
                        const isOffline = !c.isOnline || c.status === "offline";
                        const isBusy = c.isOnline && c.status === "busy";
                        const isBreak = c.isOnline && c.status === "break";
                        const isAvailable = c.isOnline && c.status === "available";
                        
                        let dotColor = "#ef4444"; // Offline
                        let statusText = "Offline";
                        if (isAvailable) { dotColor = "#16a34a"; statusText = "Online"; }
                        else if (isBusy) { dotColor = MAROON; statusText = "Busy"; }
                        else if (isBreak) { dotColor = "#f59e0b"; statusText = "Lunch Break"; }

                        return (
                          <div key={c.id} className="flex items-center justify-between px-3 py-2 rounded-lg"
                            style={{ background: "rgba(0,0,0,0.02)" }}>
                            <div className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full inline-block" style={{ background: dotColor }} />
                              <span style={{ fontSize: "12px", color: isOffline ? "#9ca3af" : "#374151", fontWeight: 500 }}>{c.name}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span style={{ fontSize: "10px", color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.07em" }}>{c.type}</span>
                              <span style={{ fontSize: "10px", fontWeight: 600, color: dotColor }}>{statusText}</span>
                            </div>
                          </div>
                        );
                      }) : (
                        <div className="flex items-center justify-center h-12">
                          <p style={{ fontSize: "12px", color: "#d1d5db" }}>No staff configured</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </SectionReveal>
          </div>
        </div>
      </section>

      {/* ── HOW ENROLLMENT WORKS ─────────────────────────────────────────── */}
      <section style={{ padding: "80px 0" }}>
        <div className="max-w-7xl mx-auto px-8 lg:px-16">
          <SectionReveal className="text-center mb-12">
            <p style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: MAROON, marginBottom: "8px" }}>Process</p>
            <h2 style={{ fontWeight: 800, fontSize: "28px", color: "#111827", letterSpacing: "-0.02em", marginBottom: "8px" }}>How Enrollment Works</h2>
            <p style={{ fontSize: "15px", color: "#9ca3af", maxWidth: "480px", margin: "0 auto" }}>Five simple steps from registration to enrollment completion.</p>
          </SectionReveal>

          <div className="relative">
            {/* Connector line */}
            <div className="hidden md:block absolute top-10 left-[10%] right-[10%] h-px" style={{ background: "linear-gradient(90deg, transparent 0%, rgba(128,0,32,0.2) 10%, rgba(128,0,32,0.2) 90%, transparent 100%)" }} />

            <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
              {processSteps.map((s, i) => (
                <SectionReveal key={s.title}>
                  <motion.div
                    whileHover={{ y: -6, boxShadow: "0 16px 48px rgba(128,0,32,0.12)" }}
                    transition={{ duration: 0.25 }}
                    className="text-center p-6 rounded-2xl relative"
                    style={{ background: "rgba(255,255,255,0.7)", border: "1px solid rgba(128,0,32,0.09)", cursor: "default", boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}
                  >
                    {/* Step number */}
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold"
                      style={{ background: `linear-gradient(135deg, ${MAROON}, ${MAROON_DARK})`, boxShadow: "0 2px 8px rgba(128,0,32,0.3)" }}>
                      {i + 1}
                    </div>
                    {/* Icon */}
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-4 mt-2"
                      style={{ background: "rgba(128,0,32,0.08)", color: MAROON }}>
                      {s.icon}
                    </div>
                    <h3 style={{ fontWeight: 700, fontSize: "14px", color: "#111827", marginBottom: "6px" }}>{s.title}</h3>
                    <p style={{ fontSize: "12px", color: "#9ca3af", lineHeight: 1.5 }}>{s.desc}</p>
                  </motion.div>
                </SectionReveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── ANNOUNCEMENTS ─────────────────────────────────────────────────── */}
      {announcementTexts.length > 0 && (
        <section style={{ background: "rgba(128,0,32,0.03)", borderTop: "1px solid rgba(128,0,32,0.08)", borderBottom: "1px solid rgba(128,0,32,0.08)", padding: "40px 0" }}>
          <div className="max-w-7xl mx-auto px-8 lg:px-16">
            <SectionReveal className="mb-5">
              <div className="flex items-center gap-2">
                <Megaphone className="w-4 h-4" style={{ color: MAROON }} />
                <span style={{ fontWeight: 700, fontSize: "13px", color: MAROON, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                  Live Announcements
                </span>
              </div>
            </SectionReveal>
            <Marquee items={announcementTexts} />
          </div>
        </section>
      )}

      {/* ── FOOTER ────────────────────────────────────────────────────────── */}
      <footer style={{ padding: "40px 0 32px", borderTop: "1px solid rgba(0,0,0,0.06)" }}>
        <div className="max-w-7xl mx-auto px-8 lg:px-16 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center">
                <CcsLogo size="small" className="mb-6" />
          
            </div>
            <div>
              <p style={{ fontWeight: 700, fontSize: "13px", color: "#374151", lineHeight: 1 }}>College of Computer Studies</p>
              <p style={{ fontSize: "11px", color: "#9ca3af" }}>Enrollment Queue &nbsp;·&nbsp; AY 2025–2026</p>
              <p style={{ fontSize: "11px", color: "#9ca3af" }}>Developed by Luiese Amstrong</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full animate-pulse inline-block" style={{ background: "#16a34a" }} />
            <span style={{ fontSize: "12px", color: "#9ca3af" }}>System Online</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
