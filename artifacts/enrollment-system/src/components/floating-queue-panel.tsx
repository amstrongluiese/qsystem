import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ForwardedRef } from "react";
import { createPortal } from "react-dom";
import { Maximize2, Minimize2, Users, SkipForward, PauseCircle, CheckCircle2, PlayCircle } from "lucide-react";
import { Switch } from "@/components/ui/switch";

type FloatingQueueEntry = {
  id: number;
  queueNumber: string;
  fullName: string;
  status: string;
};

type FloatingRole = "evaluator" | "tagger" | "hybrid";

type FloatingState =
  | "disabled"
  | "enabled"
  | "auto-floating-on"
  | "auto-floating-off"
  | "companion-open"
  | "companion-hidden"
  | "blocked"
  | "closed-by-user";

export interface FloatingQueuePanelHandle {
  prepareCompanion: () => Promise<void>;
  openCompanion: () => Promise<void>;
  toggleAutoFloat: (checked: boolean) => void;
}

type FloatingQueuePanelProps = {
  role: FloatingRole;
  staffName: string;
  counterStatus: string;
  currentStudent?: FloatingQueueEntry | null;
  waitingCount: number;
  onCallNext: () => void;
  onStartProcessing: () => void;
  onRepeatCall?: () => void;
  onComplete?: () => void;
  onSkip?: () => void;
  onHold?: () => void;
  canCallNext: boolean;
  canStartProcessing: boolean;
  canRepeatCall?: boolean;
  canComplete?: boolean;
  canSkip?: boolean;
  canHold?: boolean;
  isBusy?: boolean;
  showCompanionControls?: boolean;
};

const maroon = "#800020";
const maroonDark = "#4a0012";

function titleCaseRole(role: FloatingRole) {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function getCounterStatusLabel(status: string) {
  const normalized = status.toLowerCase().replace(/\s+/g, "_");
  if (normalized === "break" || normalized === "paused" || normalized === "lunch_break") return "Lunch Break";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function FloatingQueuePanelInner(
  {
    role,
    staffName,
    counterStatus,
    currentStudent,
    waitingCount,
    onCallNext,
    onStartProcessing,
    onRepeatCall,
    onComplete,
    onSkip,
    onHold,
    canCallNext,
    canStartProcessing,
    canRepeatCall = false,
    canComplete = false,
    canSkip = false,
    canHold = false,
    isBusy = false,
    showCompanionControls = true,
  }: FloatingQueuePanelProps,
  ref: ForwardedRef<FloatingQueuePanelHandle>,
) {
  const displayRole = titleCaseRole(role);
  const storagePrefix = `queueCompanion:${role}:${staffName || "staff"}`;
  const preparedKey = `${storagePrefix}:prepared`;
  const autoKey = `${storagePrefix}:auto`;

  const companionRef = useRef<Window | null>(null);
  const eventTimerRef = useRef<number | null>(null);
  const [portalWindow, setPortalWindow] = useState<Window | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isPrepared, setIsPrepared] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(preparedKey) === "true";
  });
  const [isAutoFloating, setIsAutoFloating] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem(autoKey) !== "false";
  });
  const [isCompanionVisible, setIsCompanionVisible] = useState(false);
  const [floatingState, setFloatingState] = useState<FloatingState>(() => {
    if (typeof window === "undefined") return "disabled";
    return window.localStorage.getItem(autoKey) === "false" ? "auto-floating-off" : "enabled";
  });
  const [notice, setNotice] = useState("");

  const isOnline = counterStatus !== "offline" && counterStatus !== "Offline";
  const companionClosed = !companionRef.current || companionRef.current.closed;

  const statusText = useMemo(() => {
    if (!currentStudent) return waitingCount > 0 ? "Ready for next" : "Queue is empty";
    return currentStudent.status === "called" ? "Called" : "In progress";
  }, [currentStudent, waitingCount]);

  const markClosedByUser = useCallback(() => {
    companionRef.current = null;
    setPortalWindow(null);
    setIsCompanionVisible(false);
    setIsPrepared(false);
    window.localStorage.setItem(preparedKey, "false");
    setFloatingState("closed-by-user");
    setNotice("Queue Companion closed. Click Enable to open again.");
  }, [preparedKey]);

  const openPreparedCompanion = useCallback(async () => {
    if (companionRef.current && !companionRef.current.closed) {
      return companionRef.current;
    }

    let companion: Window | null = null;
    let isPip = false;

    if ('documentPictureInPicture' in window) {
      try {
        companion = await (window as any).documentPictureInPicture.requestWindow({
          width: 420,
          height: 560,
        });
        isPip = true;

        [...document.styleSheets].forEach((styleSheet) => {
          try {
            const cssRules = [...styleSheet.cssRules].map((rule) => rule.cssText).join('');
            const style = document.createElement('style');
            style.textContent = cssRules;
            companion!.document.head.appendChild(style);
          } catch (e) {
            if (styleSheet.href) {
              const link = document.createElement('link');
              link.rel = 'stylesheet';
              link.type = styleSheet.type;
              link.media = styleSheet.media as unknown as string;
              link.href = styleSheet.href;
              companion!.document.head.appendChild(link);
            }
          }
        });

        companion!.addEventListener("pagehide", () => {
          markClosedByUser();
        });
      } catch (err) {
        console.warn("PiP not supported or blocked, falling back to window.open", err);
      }
    }

    if (!companion) {
      companion = window.open(
        "",
        `queue-companion-${role}-${staffName}`.replace(/\s+/g, "-").toLowerCase(),
        "popup=yes,width=420,height=560,resizable=yes,scrollbars=no"
      );

      if (!companion) {
        setFloatingState("blocked");
        setNotice("Queue Companion blocked. Allow popups to enable it.");
        return null;
      }

      const closedCheck = window.setInterval(() => {
        if (companion!.closed) {
          window.clearInterval(closedCheck);
          markClosedByUser();
        }
      }, 1000);
    }

    companion.document.title = `${staffName} - ${displayRole}`;
    companion.document.body.style.margin = "0";
    companion.document.body.style.background = "#fdf7f8";
    companion.document.body.style.fontFamily = "Inter, ui-sans-serif, system-ui, sans-serif";
    
    if (!isPip) {
        const meta = companion.document.createElement('meta');
        meta.name = 'viewport';
        meta.content = 'width=device-width, initial-scale=1.0';
        companion.document.head.appendChild(meta);
    }

    companionRef.current = companion;
    setPortalWindow(companion);
    setNotice("");
    setFloatingState("companion-hidden");

    return companion;
  }, [displayRole, markClosedByUser, role, staffName]);

  const prepareCompanion = async () => {
    const companion = await openPreparedCompanion();
    if (!companion) return;

    window.localStorage.setItem(preparedKey, "true");
    setIsPrepared(true);
    setIsAutoFloating(true);
    window.localStorage.setItem(autoKey, "true");
    setIsCompanionVisible(false);
    setFloatingState("enabled");
  };

  const openCompanion = async () => {
    const companion = await openPreparedCompanion();
    if (!companion) return;

    window.localStorage.setItem(preparedKey, "true");
    setIsPrepared(true);
    setIsCompanionVisible(true);
    setFloatingState("companion-open");
    companion.focus();
  };

  const showCompanion = useCallback(() => {
    if (!isAutoFloating) {
      setFloatingState("auto-floating-off");
      return;
    }

    if (!isPrepared) return;

    if (companionClosed) {
      markClosedByUser();
      return;
    }

    setIsCompanionVisible(true);
    setFloatingState("companion-open");
    companionRef.current?.focus();
  }, [companionClosed, isAutoFloating, isPrepared, markClosedByUser]);

  const hideCompanion = useCallback(() => {
    if (!isPrepared || companionClosed) return;
    setIsCompanionVisible(false);
    setFloatingState("companion-hidden");
  }, [companionClosed, isPrepared]);

  const scheduleEvent = useCallback((next: "show" | "hide") => {
    if (eventTimerRef.current) {
      window.clearTimeout(eventTimerRef.current);
    }
    eventTimerRef.current = window.setTimeout(() => {
      if (next === "show") showCompanion();
      else hideCompanion();
    }, 120);
  }, [hideCompanion, showCompanion]);

  useEffect(() => {
    return () => {
      if (eventTimerRef.current) window.clearTimeout(eventTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      scheduleEvent(document.hidden ? "show" : "hide");
    };
    const handleBlur = () => scheduleEvent("show");
    const handleFocus = () => scheduleEvent("hide");
    const handlePageShow = () => scheduleEvent("hide");
    const handlePageHide = () => scheduleEvent("show");

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleBlur);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("pageshow", handlePageShow);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [scheduleEvent]);

  const handleAutoSwitch = (checked: boolean) => {
    setIsAutoFloating(checked);
    window.localStorage.setItem(autoKey, checked ? "true" : "false");

    if (!checked) {
      setIsCompanionVisible(false);
      setFloatingState("auto-floating-off");
      setNotice("");
      return;
    }

    setFloatingState("auto-floating-on");
  };

  useImperativeHandle(ref, () => ({
    prepareCompanion,
    openCompanion,
    toggleAutoFloat: handleAutoSwitch,
  }), [prepareCompanion, openCompanion, handleAutoSwitch]);

  const panel = (
    <div
      style={{
        width: portalWindow ? "100%" : isCollapsed ? "240px" : "360px",
        height: portalWindow ? "100vh" : "auto",
        fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
        color: "#111827",
        background: portalWindow ? "transparent" : "rgba(255,255,255,0.96)",
        border: portalWindow ? "none" : "1px solid rgba(128,0,32,0.16)",
        borderRadius: portalWindow ? "0" : "20px",
        boxShadow: portalWindow ? "none" : "0 24px 60px rgba(0,0,0,0.18)",
        overflow: "hidden",
        backdropFilter: portalWindow ? "none" : "blur(18px)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          padding: portalWindow ? "16px 20px" : "12px 14px",
          background: `linear-gradient(135deg, ${maroon} 0%, ${maroonDark} 100%)`,
          color: "white",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "10px",
          boxShadow: "0 4px 20px rgba(128,0,32,0.25)",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "7px", fontSize: "10px", fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", opacity: 0.9 }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "999px", background: isOnline ? "#22c55e" : "#ef4444", boxShadow: isOnline ? "0 0 0 3px rgba(34,197,94,0.25)" : "0 0 0 3px rgba(239,68,68,0.25)" }} />
            {isOnline ? "Online" : "Offline"}
          </div>
          <div style={{ fontSize: "16px", fontWeight: 800, lineHeight: 1.2, marginTop: "4px", textShadow: "0 1px 2px rgba(0,0,0,0.2)" }}>{staffName}</div>
          <div style={{ fontSize: "12px", opacity: 0.8, fontWeight: 500 }}>{displayRole}</div>
        </div>
        {!portalWindow && (
          <button
            type="button"
            onClick={() => setIsCollapsed((value) => !value)}
            aria-label={isCollapsed ? "Expand queue companion panel" : "Collapse queue companion panel"}
            style={{ width: "32px", height: "32px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.24)", background: "rgba(255,255,255,0.12)", color: "white", display: "grid", placeItems: "center", cursor: "pointer", transition: "all 0.2s" }}
          >
            {isCollapsed ? <Maximize2 size={16} /> : <Minimize2 size={16} />}
          </button>
        )}
      </div>

      {!isCollapsed && (
        <div style={{ flex: 1, padding: portalWindow ? "24px 20px" : "16px", display: "flex", flexDirection: "column", gap: "16px", overflowY: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
             <div style={{ fontSize: "13px", color: "#4b5563", fontWeight: 600 }}>{getCounterStatusLabel(counterStatus)}</div>
             <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "6px 12px", borderRadius: "999px", background: "rgba(128,0,32,0.08)", color: maroon, fontSize: "12px", fontWeight: 700 }}>
                <span style={{ width: "8px", height: "8px", borderRadius: "999px", background: currentStudent ? maroon : "#16a34a" }} />
                {statusText}
             </div>
          </div>

          <div style={{ borderRadius: "20px", border: "1px solid rgba(128,0,32,0.1)", background: "white", padding: "24px 16px", textAlign: "center", boxShadow: "0 4px 20px rgba(0,0,0,0.03)" }}>
            <div style={{ fontSize: "11px", color: "#9ca3af", fontWeight: 800, letterSpacing: "0.15em", textTransform: "uppercase" }}>
              Current Student
            </div>
            <div style={{ fontSize: currentStudent ? "56px" : "32px", color: currentStudent ? maroon : "#d1d5db", fontWeight: 900, lineHeight: 1.1, marginTop: "8px", letterSpacing: "-0.02em" }}>
              {currentStudent?.queueNumber ?? "--"}
            </div>
            <div style={{ minHeight: "24px", marginTop: "8px", fontSize: "15px", color: "#1f2937", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {currentStudent?.fullName ?? "No active student"}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {(!currentStudent || currentStudent.status === "waiting") && (
              <button
                type="button"
                onClick={onCallNext}
                disabled={!canCallNext || isBusy}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
                  height: "50px", borderRadius: "14px", border: "1px solid rgba(0,0,0,0.08)",
                  background: !canCallNext || isBusy ? "#f3f4f6" : "white",
                  color: !canCallNext || isBusy ? "#9ca3af" : "#111827",
                  fontSize: "14px", fontWeight: 800, cursor: !canCallNext || isBusy ? "not-allowed" : "pointer",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.04)"
                }}
              >
                <Users size={18} /> Call Next Student
              </button>
            )}

            {currentStudent?.status === "called" && (
              <>
                <button
                  type="button"
                  onClick={onStartProcessing}
                  disabled={!canStartProcessing || isBusy}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
                    height: "50px", borderRadius: "14px", border: "none",
                    background: !canStartProcessing || isBusy ? "#e5e7eb" : `linear-gradient(135deg, ${maroon} 0%, ${maroonDark} 100%)`,
                    color: !canStartProcessing || isBusy ? "#9ca3af" : "white",
                    fontSize: "14px", fontWeight: 800, cursor: !canStartProcessing || isBusy ? "not-allowed" : "pointer",
                    boxShadow: "0 4px 14px rgba(128,0,32,0.3)"
                  }}
                >
                  <PlayCircle size={18} /> Start Processing
                </button>
                <button
                  type="button"
                  onClick={onRepeatCall}
                  disabled={!canRepeatCall || isBusy}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
                    height: "50px", borderRadius: "14px", border: "1px solid rgba(0,0,0,0.08)",
                    background: !canRepeatCall || isBusy ? "#f3f4f6" : "white",
                    color: !canRepeatCall || isBusy ? "#9ca3af" : "#111827",
                    fontSize: "14px", fontWeight: 800, cursor: !canRepeatCall || isBusy ? "not-allowed" : "pointer",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.04)"
                  }}
                >
                  <Users size={18} /> Repeat Call
                </button>
              </>
            )}

            {currentStudent?.status === "in_progress" && (
              <button
                type="button"
                onClick={onComplete}
                disabled={!canComplete || isBusy}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
                  height: "50px", borderRadius: "14px", border: "none",
                  background: !canComplete || isBusy ? "#e5e7eb" : "#15803d",
                  color: !canComplete || isBusy ? "#9ca3af" : "white",
                  fontSize: "14px", fontWeight: 800, cursor: !canComplete || isBusy ? "not-allowed" : "pointer",
                  boxShadow: "0 4px 14px rgba(21,128,61,0.3)"
                }}
              >
                <CheckCircle2 size={18} /> Mark Done
              </button>
            )}

            {(onSkip || onHold) && currentStudent && (
              <div style={{ display: "grid", gridTemplateColumns: onSkip && onHold ? "1fr 1fr" : "1fr", gap: "10px", marginTop: "4px" }}>
                {onHold && (
                   <button
                     type="button"
                     onClick={onHold}
                     disabled={!canHold || isBusy}
                     style={{
                       display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
                       height: "44px", borderRadius: "12px", border: "1px solid #fcd34d",
                       background: !canHold || isBusy ? "#f3f4f6" : "#fffbeb",
                       color: !canHold || isBusy ? "#9ca3af" : "#b45309",
                       fontSize: "13px", fontWeight: 700, cursor: !canHold || isBusy ? "not-allowed" : "pointer",
                     }}
                   >
                     <PauseCircle size={16} /> Hold
                   </button>
                )}
                {onSkip && (
                   <button
                     type="button"
                     onClick={onSkip}
                     disabled={!canSkip || isBusy}
                     style={{
                       display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
                       height: "44px", borderRadius: "12px", border: "1px solid #fca5a5",
                       background: !canSkip || isBusy ? "#f3f4f6" : "#fef2f2",
                       color: !canSkip || isBusy ? "#9ca3af" : "#b91c1c",
                       fontSize: "13px", fontWeight: 700, cursor: !canSkip || isBusy ? "not-allowed" : "pointer",
                     }}
                   >
                     <SkipForward size={16} /> Skip
                   </button>
                )}
              </div>
            )}
          </div>

          {showCompanionControls ? (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", borderRadius: "14px", border: "1px solid rgba(128,0,32,0.08)", background: "rgba(128,0,32,0.03)", padding: "12px 14px", marginTop: "auto" }}>
                <div>
                  <div style={{ color: "#111827", fontSize: "13px", fontWeight: 800 }}>Auto Float</div>
                  <div style={{ color: "#6b7280", fontSize: "11px", lineHeight: 1.4, marginTop: "2px" }}>
                    {isAutoFloating ? "Appears on tab switch" : "Off"}
                  </div>
                </div>
                <Switch
                  id={`${storagePrefix}:auto-switch`}
                  name={`${storagePrefix}:auto`}
                  checked={isAutoFloating}
                  onCheckedChange={handleAutoSwitch}
                  aria-label="Toggle automatic floating window"
                />
              </div>

              {(!isPrepared || companionClosed) && (
                <button
                  type="button"
                  onClick={prepareCompanion}
                  style={{
                    height: "44px",
                    borderRadius: "14px",
                    border: `1px solid rgba(128,0,32,0.22)`,
                    background: "rgba(128,0,32,0.06)",
                    color: maroon,
                    fontSize: "13px",
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  Enable Queue Companion
                </button>
              )}
            </>
          ) : null}

          {notice && !portalWindow && (
            <div style={{ borderRadius: "12px", background: "rgba(180,83,9,0.08)", border: "1px solid rgba(180,83,9,0.18)", color: "#92400e", fontSize: "12px", lineHeight: 1.4, padding: "10px 12px" }}>
              {notice}
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "12px", color: "#6b7280", marginTop: "4px", padding: "0 4px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: 600 }}>
              <Users size={14} /> {waitingCount} waiting
            </div>
            <div style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.05em", opacity: 0.7 }}>
              {floatingState.replace(/-/g, " ")}
            </div>
          </div>
          
          {portalWindow && (
            <div style={{ textAlign: "center", fontSize: "10px", color: "#9ca3af", fontWeight: 600, marginTop: "12px", textTransform: "uppercase", letterSpacing: "0.1em" }}>
              Live Queue Companion
            </div>
          )}
        </div>
      )}
    </div>
  );

  const hiddenCompanion = (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "24px", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif", background: "linear-gradient(170deg, #ffffff 0%, #fdf7f8 100%)", color: "#6b7280" }}>
      <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
        <div style={{ width: "48px", height: "48px", borderRadius: "16px", background: `linear-gradient(135deg, ${maroon} 0%, ${maroonDark} 100%)`, color: "white", display: "grid", placeItems: "center", boxShadow: "0 8px 24px rgba(128,0,32,0.3)" }}>
          <Users size={24} />
        </div>
        <div>
          <div style={{ fontSize: "16px", fontWeight: 800, color: maroon }}>{staffName}</div>
          <div style={{ fontSize: "12px", opacity: 0.8 }}>{displayRole}</div>
        </div>
        <div style={{ fontSize: "13px", marginTop: "8px", fontWeight: 500, padding: "8px 16px", background: "white", borderRadius: "999px", boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>Queue Companion is active</div>
      </div>
    </div>
  );

  return (
    <>
      {!portalWindow && (
        <div style={{ position: "fixed", right: "24px", bottom: "24px", zIndex: 60 }}>
          {panel}
        </div>
      )}
      {portalWindow ? createPortal(isCompanionVisible ? panel : hiddenCompanion, portalWindow.document.body) : null}
    </>
  );
}

export const FloatingQueuePanel = forwardRef<FloatingQueuePanelHandle, FloatingQueuePanelProps>(FloatingQueuePanelInner);
