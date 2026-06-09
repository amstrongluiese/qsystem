import { useEffect } from "react";
import { useLocation } from "wouter";

export interface StaffSession {
  counterId: number;
  role: "evaluator" | "tagger" | "hybrid" | "admin" | "queue_assistant";
  counterName: string;
  token: string;
}

const SESSION_KEY = "staff-session";
const ASSIGNMENT_ROLES = new Set(["evaluator", "tagger", "hybrid", "queue_assistant"]);

export function getStaffSession(): StaffSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as StaffSession) : null;
  } catch {
    return null;
  }
}

export function setStaffSession(session: StaffSession) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearStaffSession() {
  const session = getStaffSession();
  if (session && session.counterId > 0 && ASSIGNMENT_ROLES.has(session.role)) {
    const payload = JSON.stringify({ counterId: session.counterId });
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon("/api/staff/logout", new Blob([payload], { type: "application/json" }));
    } else {
      void fetch("/api/staff/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => undefined);
    }
  }
  sessionStorage.removeItem(SESSION_KEY);
}

export function useStaffAuth(): StaffSession | null {
  const [, setLocation] = useLocation();
  const session = getStaffSession();

  useEffect(() => {
    if (!session) {
      setLocation("/staff/login");
    }
  }, []);

  useEffect(() => {
    if (!session || session.counterId <= 0 || !ASSIGNMENT_ROLES.has(session.role)) return;

    const sendHeartbeat = () => {
      void fetch("/api/staff/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ counterId: session.counterId }),
        keepalive: true,
      }).catch(() => undefined);
    };

    sendHeartbeat();
    const intervalId = window.setInterval(sendHeartbeat, 20_000);
    return () => window.clearInterval(intervalId);
  }, [session?.counterId, session?.role]);

  return session;
}
