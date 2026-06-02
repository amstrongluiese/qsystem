import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion, AnimatePresence } from "framer-motion";
import {
  useGetCounter, getGetCounterQueryKey,
  useListQueue, getListQueueQueryKey,
  useCallStudent, useStartProcessing, useTransferToTagger,
  useListCounters, getListCountersQueryKey,
  useUpdateCounter,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Form, FormControl, FormField, FormItem } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { useStaffAuth, clearStaffSession } from "@/hooks/use-staff-auth";
import { useLocation } from "wouter";
import { LogOut, Users } from "lucide-react";
import { useQueueSocket } from "@/hooks/use-socket";
import { CcsLogo } from "@/components/ccs-logo";
import { FloatingQueuePanel } from "@/components/floating-queue-panel";

const transferSchema = z.object({
  taggerCounterId: z.string().min(1, "Please select a tagger"),
});

export default function EvaluatorDashboard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const session = useStaffAuth();
  const counterId = session?.counterId ?? 0;
  useQueueSocket(counterId); // Realtime updates

  const { data: counter, isLoading: counterLoading } = useGetCounter(counterId, {
    query: {
      enabled: !!counterId,
      queryKey: getGetCounterQueryKey(counterId),
    },
  });

  const { data: queue, refetch: refetchQueue } = useListQueue({ counterId }, {
    query: {
      enabled: !!counterId,
      queryKey: getListQueueQueryKey({ counterId }),
      refetchInterval: 4000,
    },
  });

  const { data: taggers } = useListCounters({
    query: {
      enabled: !!counterId,
      queryKey: getListCountersQueryKey(),
      select: (counters) => counters.filter((c) => c.type === "tagger" && c.status !== "offline"),
    },
  });

  const callStudentMutation = useCallStudent();
  const startProcessingMutation = useStartProcessing();
  const transferMutation = useTransferToTagger();
  const updateCounterMutation = useUpdateCounter();
  const [completeEvaluationPending, setCompleteEvaluationPending] = useState(false);

  const transferForm = useForm<z.infer<typeof transferSchema>>({
    resolver: zodResolver(transferSchema),
  });

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

  const handleStartProcessing = () => {
    if (!currentStudent) return;
    startProcessingMutation.mutate({ id: currentStudent.id }, {
      onSuccess: () => refetchQueue(),
    });
  };

  const handleTransfer = (data: z.infer<typeof transferSchema>) => {
    if (!currentStudent) return;
    transferMutation.mutate(
      { id: currentStudent.id, data: { taggerCounterId: parseInt(data.taggerCounterId, 10) } },
      {
        onSuccess: () => {
          toast({ title: "Transferred to tagger" });
          transferForm.reset();
          refetchQueue();
        },
      }
    );
  };

  const handleCompleteEvaluation = async () => {
    if (!currentStudent || completeEvaluationPending) return;
    const confirmed = window.confirm("Complete this evaluation without proceeding to enrollment?");
    if (!confirmed) return;

    setCompleteEvaluationPending(true);
    try {
      const response = await fetch(`/api/queue/${currentStudent.id}/complete-evaluation`, {
        method: "POST",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Unable to complete evaluation");
      }
      toast({ title: "Evaluation completed" });
      refetchQueue();
    } catch (error) {
      toast({
        title: "Evaluation completion failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setCompleteEvaluationPending(false);
    }
  };

  const handleLogout = () => {
    clearStaffSession();
    setLocation("/staff/login");
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

  if (!counter) {
    return (
      <div className="min-h-screen flex items-center justify-center text-foreground">
        Counter not found. <button onClick={handleLogout} className="ml-2 underline text-primary">Logout</button>
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
            <p className="text-primary font-semibold tracking-widest uppercase text-xs mt-1">
              Evaluator Console
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
            {!counter.isOnline ? "Offline" : counter.status === "break" ? "On Break" : "Online"}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={toggleBreak}
            disabled={updateCounterMutation.isPending}
            className="bg-white/50 hover:bg-white shadow-sm"
          >
            {counter.status === "break" ? "Resume Work" : "Go on Break"}
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

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Main — Current Student */}
        <div className="lg:col-span-8 space-y-6">
          <Card className="glass-card border-primary/30 min-h-[420px] flex flex-col">
            <CardHeader>
              <CardTitle className="text-gray-400 uppercase tracking-widest text-xs font-semibold">
                Current Student
              </CardTitle>
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

                    {currentStudent.status === "called" ? (
                      <Button
                        size="lg"
                        onClick={handleStartProcessing}
                        disabled={startProcessingMutation.isPending}
                        className="maroon-gradient h-14 px-12 text-lg shadow-[0_0_20px_rgba(128,0,32,0.4)]"
                      >
                        Start Evaluation
                      </Button>
                    ) : (
                      <div className="w-full max-w-sm mx-auto bg-white/60 p-5 rounded-2xl border border-black/5 shadow-sm">
                        <h3 className="text-gray-500 text-xs uppercase tracking-widest mb-4">
                          Evaluation Action
                        </h3>
                        <Form {...transferForm}>
                          <form
                            onSubmit={transferForm.handleSubmit(handleTransfer)}
                            className="flex gap-3"
                          >
                            <FormField
                              control={transferForm.control}
                              name="taggerCounterId"
                              render={({ field }) => (
                                <FormItem className="flex-1">
                                  <Select onValueChange={field.onChange} value={field.value}>
                                    <FormControl>
                                      <SelectTrigger className="bg-white border-black/10 h-11">
                                        <SelectValue placeholder="Select a Tagger" />
                                      </SelectTrigger>
                                    </FormControl>
                                    <SelectContent className="bg-white border-black/10">
                                      {taggers?.map((t) => (
                                        <SelectItem key={t.id} value={t.id.toString()}>
                                          {t.name}
                                          {t.currentQueueCount > 0
                                            ? ` (${t.currentQueueCount} waiting)`
                                            : " (available)"}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </FormItem>
                              )}
                            />
                            <Button
                              type="submit"
                              className="h-11 maroon-gradient"
                              disabled={transferMutation.isPending}
                            >
                              Proceed to Tagging
                            </Button>
                          </form>
                        </Form>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handleCompleteEvaluation}
                          disabled={completeEvaluationPending || transferMutation.isPending}
                          className="mt-3 w-full h-11 bg-white/70 border-black/10 text-foreground hover:bg-white"
                        >
                          Complete Evaluation
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
                      className="h-16 px-14 text-xl border border-black/10 bg-white hover:bg-gray-50 text-foreground shadow-sm"
                    >
                      {waitingStudents.length === 0 ? "Queue Empty" : "Call Next"}
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>
            </CardContent>
          </Card>
        </div>

        {/* Right — Queue List */}
        <div className="lg:col-span-4">
          <Card className="glass-card flex flex-col h-[600px] lg:h-[calc(100vh-160px)]">
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
        role="evaluator"
        staffName={counter.staffName || counter.name}
        counterStatus={!counter.isOnline ? "Offline" : counter.status}
        currentStudent={currentStudent}
        waitingCount={waitingStudents.length}
        onCallNext={handleCallNext}
        onStartProcessing={handleStartProcessing}
        onComplete={handleCompleteEvaluation}
        canCallNext={!currentStudent && waitingStudents.length > 0}
        canStartProcessing={currentStudent?.status === "called"}
        canComplete={currentStudent?.status === "in_progress"}
        isBusy={callStudentMutation.isPending || startProcessingMutation.isPending || transferMutation.isPending || completeEvaluationPending}
      />
    </div>
  );
}
