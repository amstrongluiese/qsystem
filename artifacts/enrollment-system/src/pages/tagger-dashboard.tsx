import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  useGetCounter, getGetCounterQueryKey,
  useListQueue, getListQueueQueryKey,
  useCallStudent, useStartProcessing, useCompleteProcessing,
  useUpdateCounter,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { useStaffAuth, clearStaffSession } from "@/hooks/use-staff-auth";
import { useLocation } from "wouter";
import { LogOut, Tag, Users } from "lucide-react";
import { useQueueSocket } from "@/hooks/use-socket";
import { CcsLogo } from "@/components/ccs-logo";
import { FloatingQueuePanel, type FloatingQueuePanelHandle } from "@/components/floating-queue-panel";

export default function TaggerDashboard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const session = useStaffAuth();
  const canUseDashboard = session?.role === "tagger";
  const counterId = canUseDashboard ? session.counterId : 0;
  const companionRef = useRef<FloatingQueuePanelHandle | null>(null);
  const [queueCompanionPrepared, setQueueCompanionPrepared] = useState(false);
  const [queueCompanionAutoFloat, setQueueCompanionAutoFloat] = useState(true);

  useEffect(() => {
    if (session && session.role !== "tagger") setLocation("/staff/login");
  }, [session, setLocation]);
  useQueueSocket(counterId); // Realtime updates

  const { data: counter, isLoading: counterLoading, isError: counterError, refetch: refetchCounter } = useGetCounter(counterId, {
    query: {
      enabled: !!counterId,
      queryKey: getGetCounterQueryKey(counterId),
    },
  });

  useEffect(() => {
    if (!counter) return;
    const storagePrefix = `queueCompanion:tagger:${counter.staffName || counter.name || "staff"}`;
    setQueueCompanionPrepared(window.localStorage.getItem(`${storagePrefix}:prepared`) === "true");
    setQueueCompanionAutoFloat(window.localStorage.getItem(`${storagePrefix}:auto`) !== "false");
  }, [counter?.staffName, counter?.name, counter]);

  const { data: queue, refetch: refetchQueue } = useListQueue({ counterId }, {
    query: {
      enabled: !!counterId,
      queryKey: getListQueueQueryKey({ counterId }),
      refetchInterval: 4000,
    },
  });

  const callStudentMutation = useCallStudent();
  const startProcessingMutation = useStartProcessing();
  const completeMutation = useCompleteProcessing();
  const updateCounterMutation = useUpdateCounter();
  const [repeatCallPending, setRepeatCallPending] = useState(false);

  if (!canUseDashboard) return null;

  const currentStudent = queue?.find((q) => q.status === "called" || q.status === "in_progress");
  const waitingStudents = queue?.filter((q) => q.status === "waiting") ?? [];

  const handleCallNext = () => {
    if (waitingStudents.length === 0) return;
    const next = waitingStudents[0];
    callStudentMutation.mutate({ id: next.id }, {
      onSuccess: () => {
        toast({ title: `Called ${next.queueNumber}` });
        refetchQueue();
      },
    });
  };

  const handleRepeatCall = async () => {
    if (!currentStudent || repeatCallPending) return;
    setRepeatCallPending(true);
    console.log("[STAFF] Call Again clicked", { queueId: currentStudent.id, queueNumber: currentStudent.queueNumber });
    try {
      const response = await fetch(`/api/queue/${currentStudent.id}/call?reannounce=1`, { method: "POST" });
      if (!response.ok) throw new Error("Unable to call again");
      console.log("[STAFF] Call Again voice event sent", { type: "queue_call_again", queueId: currentStudent.id });
      toast({ title: `Called ${currentStudent.queueNumber} again` });
      refetchQueue();
    } catch (error) {
      toast({
        title: "Call Again failed",
        description: error instanceof Error ? error.message : "Unable to reannounce the active queue.",
        variant: "destructive",
      });
    } finally {
      setRepeatCallPending(false);
    }
  };

  const handleStartProcessing = () => {
    if (!currentStudent) return;
    startProcessingMutation.mutate({ id: currentStudent.id }, {
      onSuccess: () => refetchQueue(),
    });
  };

  const handleComplete = () => {
    if (!currentStudent) return;
    completeMutation.mutate({ id: currentStudent.id }, {
      onSuccess: () => {
        toast({ title: "Enrollment complete!" });
        refetchQueue();
      },
    });
  };

  const handleLogout = () => {
    clearStaffSession();
    setLocation("/staff/login");
  };

  const handleEnableQueueCompanion = async () => {
    await companionRef.current?.prepareCompanion();
    setQueueCompanionPrepared(true);
    setQueueCompanionAutoFloat(true);
  };

  const handleOpenQueueCompanion = async () => {
    await companionRef.current?.openCompanion();
    setQueueCompanionPrepared(true);
  };

  const handleToggleQueueAutoFloat = (checked: boolean) => {
    companionRef.current?.toggleAutoFloat(checked);
    setQueueCompanionAutoFloat(checked);
  };

  const toggleBreak = () => {
    if (!counter) return;
    const newStatus = counter.status === "break" ? "available" : "break";
    updateCounterMutation.mutate(
      { id: counter.id, data: { status: newStatus } }
    );
  };

  if (!session) return null;

  if (counterLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Skeleton className="h-64 w-96 glass-card" />
      </div>
    );
  }

  if (counterError) {
    return (
      <div className="min-h-screen flex items-center justify-center text-foreground">
        Failed to load staff counter. <button onClick={() => refetchCounter()} className="ml-2 underline text-primary">Retry</button>
      </div>
    );
  }

  if (!counter) {
    return (
      <div className="min-h-screen flex items-center justify-center text-foreground">
        Counter not found.{" "}
        <button onClick={handleLogout} className="ml-2 underline text-primary">
          Logout
        </button>
      </div>
    );
  }

  return (
    <div 
      className="min-h-screen p-6 text-foreground overflow-y-auto relative"
      style={{ background: "linear-gradient(170deg, #ffffff 0%, #fdf7f8 40%, #f9eef1 100%)" }}
    >
      <div className="light-blob-1" />
      <div className="light-blob-2" />
      {/* Header */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8 glass-card p-4">
        <div className="flex items-center gap-3">
          <CcsLogo size="small" className="shrink-0" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{counter.name}</h1>
            <p className="font-semibold tracking-widest uppercase text-xs mt-1" style={{ color: "#b5444a" }}>
              Tagger Console
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge
            variant="outline"
            className={`px-3 py-1 text-xs ${
              !counter.isOnline 
                ? "border-red-500/50 text-red-500 bg-red-500/10"
                : counter.status === "break" 
                  ? "border-amber-500/50 text-amber-500 bg-amber-500/10" 
                  : "border-green-500/50 text-green-400 bg-green-500/10"
            }`}
          >
            {!counter.isOnline ? "Offline" : counter.status === "break" ? "Lunch Break" : "Online"}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={toggleBreak}
            disabled={updateCounterMutation.isPending}
            className="bg-white/50 hover:bg-white shadow-sm"
          >
            {counter.status === "break" ? "Resume Work" : "Lunch Break"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleLogout}
            className="bg-white/50 hover:bg-white gap-2 shadow-sm"
          >
            <LogOut className="w-3.5 h-3.5" />
            Logout
          </Button>
        </div>
      </header>

      <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50/80 p-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.14)]" />
              <label htmlFor="tagger-queue-companion-auto-float" className="text-sm font-bold text-emerald-950">
                Enable Floating Window
              </label>
            </div>
            <p className="mt-1 text-xs font-medium text-emerald-800">
              Keep queue controls accessible when switching tabs.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-3 rounded-xl bg-white/80 px-3 py-2 shadow-sm">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-900">
                {queueCompanionAutoFloat ? "On" : "Off"}
              </span>
              <Switch
                id="tagger-queue-companion-auto-float"
                name="queueCompanionAutoFloat"
                checked={queueCompanionAutoFloat}
                onCheckedChange={handleToggleQueueAutoFloat}
              />
            </div>
            <Button onClick={handleOpenQueueCompanion}>
              Open Floating Window
            </Button>
            <Button onClick={handleEnableQueueCompanion} disabled={queueCompanionPrepared} variant="outline" className="bg-white/70">
              {queueCompanionPrepared ? "Queue Companion Enabled" : "Enable Queue Companion"}
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Main */}
        <div className="lg:col-span-8">
          <Card className="glass-card border-primary/20 min-h-105 flex flex-col">
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-gray-500 uppercase tracking-widest text-xs font-semibold flex items-center gap-2">
                  <Tag className="w-3.5 h-3.5" /> Current Queue
                </CardTitle>
                <Badge variant="outline" className="bg-white/60 border-black/10 text-gray-600">
                  {currentStudent ? currentStudent.status.replace("_", " ") : "Ready"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col justify-center items-center">
              <AnimatePresence mode="wait">
                {currentStudent ? (
                  <motion.div
                    key={currentStudent.id}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className="w-full text-center"
                  >
                    <div className="text-8xl font-black text-foreground mb-3 drop-shadow-[0_0_20px_rgba(128,0,32,0.1)]">
                      {currentStudent.queueNumber}
                    </div>
                    <div className="text-2xl text-gray-700 mb-2">{currentStudent.fullName}</div>
                    <div className="text-sm text-gray-500 mb-8 uppercase tracking-wider">
                      {currentStudent.category}
                      {currentStudent.yearLevel ? ` · ${currentStudent.yearLevel} Year` : ""}
                      {currentStudent.regularity ? ` · ${currentStudent.regularity}` : ""}
                    </div>
                    <div className="mb-3 text-xs font-bold uppercase tracking-widest text-gray-400">
                      Queue Actions
                    </div>

                    {currentStudent.status === "called" ? (
                      <div className="grid gap-3 w-full max-w-sm mx-auto">
                        <Button
                          size="lg"
                          onClick={handleStartProcessing}
                          disabled={startProcessingMutation.isPending}
                          className="maroon-gradient h-14 px-12 text-lg shadow-[0_0_20px_rgba(128,0,32,0.4)]"
                        >
                          Start Tagging
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handleRepeatCall}
                          disabled={repeatCallPending}
                          className="h-12 bg-white/70 border-black/10 text-foreground hover:bg-white"
                        >
                          Call Again
                        </Button>
                      </div>
                    ) : (
                      <div className="grid gap-3 w-full max-w-sm mx-auto">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handleRepeatCall}
                          disabled={repeatCallPending}
                          className="h-12 bg-white/70 border-black/10 text-foreground hover:bg-white"
                        >
                          Call Again
                        </Button>
                        <Button
                          size="lg"
                          onClick={handleComplete}
                          disabled={completeMutation.isPending}
                          className="h-14 px-12 text-lg bg-green-700 hover:bg-green-600 shadow-[0_0_20px_rgba(34,197,94,0.3)]"
                        >
                          Complete Enrollment
                        </Button>
                      </div>
                    )}
                  </motion.div>
                ) : (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-center"
                  >
                    <div className="w-20 h-20 rounded-full bg-white/50 border border-black/5 flex items-center justify-center mx-auto mb-5 shadow-sm">
                      <Users className="w-8 h-8 text-gray-400" />
                    </div>
                    <div className="text-gray-500 mb-6 text-lg">No student in progress</div>
                    <Button
                      size="lg"
                      onClick={handleCallNext}
                      disabled={waitingStudents.length === 0 || callStudentMutation.isPending}
                      className="h-16 px-14 text-xl maroon-gradient text-white shadow-[0_0_20px_rgba(128,0,32,0.22)] disabled:opacity-60"
                    >
                      {waitingStudents.length === 0 ? "Queue Empty" : "Call Next"}
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>
            </CardContent>
          </Card>
        </div>

        {/* Queue List */}
        <div className="lg:col-span-4">
          <Card className="glass-card flex flex-col h-150 lg:h-[calc(100vh-160px)]">
            <CardHeader className="border-b border-white/10 pb-4">
              <div className="flex justify-between items-center">
                <CardTitle className="text-gray-500 uppercase tracking-widest text-xs font-semibold">
                  Waiting Queue
                </CardTitle>
                <Badge variant="outline" className="bg-white/50 border-black/10 text-foreground">
                  {waitingStudents.length}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto p-3 space-y-2">
              <AnimatePresence>
                {waitingStudents.map((student, index) => (
                  <motion.div
                    key={student.id}
                    initial={{ opacity: 0, x: 16 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ delay: index * 0.04 }}
                    className="bg-white/60 border border-black/5 p-3 rounded-xl flex justify-between items-center shadow-sm"
                  >
                    <div>
                      <div className="text-lg font-bold text-foreground">{student.queueNumber}</div>
                      <div className="text-xs text-gray-500 truncate w-28">{student.fullName}</div>
                    </div>
                    <span className="text-[10px] text-gray-600 uppercase tracking-wider">
                      {student.category}
                    </span>
                  </motion.div>
                ))}
                {waitingStudents.length === 0 && (
                  <div className="text-center text-gray-700 py-10 text-sm">Queue is empty</div>
                )}
              </AnimatePresence>
            </CardContent>
          </Card>
        </div>
      </div>
      <FloatingQueuePanel
        ref={companionRef}
        showCompanionControls={false}
        role="tagger"
        staffName={counter.staffName || counter.name}
        counterStatus={!counter.isOnline ? "Offline" : counter.status}
        currentStudent={currentStudent}
        waitingCount={waitingStudents.length}
        onCallNext={handleCallNext}
        onRepeatCall={currentStudent ? () => handleRepeatCall() : undefined}
        onStartProcessing={handleStartProcessing}
        onComplete={handleComplete}
        canCallNext={!currentStudent && waitingStudents.length > 0}
        canRepeatCall={currentStudent?.status === "called" || currentStudent?.status === "in_progress"}
        canStartProcessing={currentStudent?.status === "called"}
        canComplete={currentStudent?.status === "in_progress"}
        isBusy={callStudentMutation.isPending || repeatCallPending || startProcessingMutation.isPending || completeMutation.isPending}
      />
    </div>
  );
}
