import { useState } from "react";
import { motion } from "framer-motion";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { setStaffSession } from "@/hooks/use-staff-auth";
import { CcsLogo } from "@/components/ccs-logo";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";

export default function StaffLogin() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleLogin = async () => {
    const errs: Record<string, string> = {};
    if (!username.trim()) errs.username = "Username is required";
    if (!password.trim()) errs.password = "Password is required";
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setErrors({});
    setLoading(true);

    try {
      const res = await fetch("/api/staff/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password: password.trim() }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast({
          title: "Login failed",
          description: body.error || "Invalid username or password",
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      const data = await res.json();
      setStaffSession({
        counterId: data.counterId,
        role: data.role,
        counterName: data.counterName,
        token: data.token,
      });
      if (data.counterId > 0 && data.role !== "admin") {
        void fetch("/api/staff/heartbeat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ counterId: data.counterId }),
          keepalive: true,
        }).catch(() => undefined);
      }

      toast({ title: `Welcome, ${data.counterName}` });

      switch (data.role) {
        case "evaluator":
          setLocation("/evaluator");
          break;
        case "tagger":
          setLocation("/tagger");
          break;
        case "hybrid":
          setLocation("/hybrid");
          break;
        case "admin":
          setLocation("/admin");
          break;
        case "queue_assistant":
          setLocation("/queue-assistant");
          break;
        default:
          setLocation("/");
      }
    } catch {
      toast({
        title: "Connection error",
        description: "Could not reach the server. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleLogin();
  };

  return (
    <div 
      className="min-h-screen w-full flex items-center justify-center p-4 relative overflow-hidden"
      style={{ background: "linear-gradient(170deg, #ffffff 0%, #fdf7f8 40%, #f9eef1 100%)" }}
    >
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-sm z-10"
      >
        {/* Card */}
        <div className="bg-white/80 backdrop-blur-xl border border-black/10 rounded-2xl overflow-hidden shadow-2xl">
          {/* Top maroon bar */}
          <div
            className="h-1 w-full"
            style={{ background: "linear-gradient(90deg, transparent, #800020, #4a0012, transparent)" }}
          />

          <div className="p-8">
            {/* Logo */}
            <div className="text-center mb-8">
              <div className="mx-auto w-14 h-14 rounded-xl flex items-center justify-center mb-4 shadow-sm"
                style={{ background: "rgba(128,0,32,0.08)", border: "1px solid rgba(128,0,32,0.15)" }}>
                <CcsLogo size="medium" className="w-10 h-10" />
              </div>
              <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Staff Portal</h1>
              <p className="text-gray-500 text-sm mt-1">CCS Department Enrollment System</p>
            </div>

            {/* Form */}
            <div className="space-y-4" onKeyDown={handleKeyDown}>
              <div>
                <label htmlFor="staff-login-username" className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                  Username
                </label>
                <input
                  id="staff-login-username"
                  name="username"
                  type="text"
                  placeholder="evaluator1"
                  value={username}
                  autoComplete="username"
                  onChange={(e) => {
                    setUsername(e.target.value);
                    setErrors((er) => ({ ...er, username: "" }));
                  }}
                  className="w-full h-12 px-4 rounded-xl text-gray-900 text-sm outline-none transition-all"
                  style={{
                    background: "rgba(0,0,0,0.03)",
                    border: errors.username
                      ? "1.5px solid rgba(239,68,68,0.6)"
                      : "1.5px solid rgba(0,0,0,0.1)",
                    fontFamily: "inherit",
                  }}
                  onFocus={(e) =>
                    (e.currentTarget.style.border = "1.5px solid rgba(128,0,32,0.7)")
                  }
                  onBlur={(e) =>
                    (e.currentTarget.style.border = errors.username
                      ? "1.5px solid rgba(239,68,68,0.6)"
                      : "1.5px solid rgba(0,0,0,0.1)")
                  }
                />
                {errors.username && (
                  <p className="text-red-400 text-xs mt-1">{errors.username}</p>
                )}
              </div>

              <div>
                <label htmlFor="staff-login-password" className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="staff-login-password"
                    name="password"
                    type={showPw ? "text" : "password"}
                    placeholder="••••••••"
                    value={password}
                    autoComplete="current-password"
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setErrors((er) => ({ ...er, password: "" }));
                    }}
                    className="w-full h-12 px-4 pr-12 rounded-xl text-gray-900 text-sm outline-none transition-all"
                    style={{
                      background: "rgba(0,0,0,0.03)",
                      border: errors.password
                        ? "1.5px solid rgba(239,68,68,0.6)"
                        : "1.5px solid rgba(0,0,0,0.1)",
                      fontFamily: "inherit",
                    }}
                    onFocus={(e) =>
                      (e.currentTarget.style.border = "1.5px solid rgba(128,0,32,0.7)")
                    }
                    onBlur={(e) =>
                      (e.currentTarget.style.border = errors.password
                        ? "1.5px solid rgba(239,68,68,0.6)"
                        : "1.5px solid rgba(0,0,0,0.1)")
                    }
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
                  >
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {errors.password && (
                  <p className="text-red-400 text-xs mt-1">{errors.password}</p>
                )}
              </div>
            </div>

            <button
              onClick={handleLogin}
              disabled={loading}
              className="mt-6 w-full flex items-center justify-center gap-2 font-semibold text-white transition-all active:scale-[0.98] disabled:opacity-60"
              style={{
                height: "52px",
                borderRadius: "12px",
                background: "linear-gradient(135deg, #800020 0%, #4a0012 100%)",
                boxShadow: "0 4px 20px rgba(128,0,32,0.4)",
                fontSize: "15px",
                border: "none",
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              {loading ? (
                <>
                  <span
                    className="w-4 h-4 rounded-full border-2 animate-spin"
                    style={{ borderColor: "rgba(255,255,255,0.3)", borderTopColor: "white" }}
                  />
                  Authenticating...
                </>
              ) : (
                "Sign In"
              )}
            </button>

            <p className="text-center text-xs text-gray-500 mt-5">
              Student kiosk?{" "}
              <a
                href="/"
                className="text-gray-700 hover:text-black transition-colors underline underline-offset-2"
              >
                Go to enrollment
              </a>
            </p>
          </div>
        </div>

        <p className="text-center text-xs text-gray-700 mt-4">
          Authorized personnel only
        </p>
      </motion.div>
    </div>
  );
}
