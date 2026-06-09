import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Printer, Search, UserPlus, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CcsLogo } from "@/components/ccs-logo";
import { clearStaffSession, useStaffAuth } from "@/hooks/use-staff-auth";
import { useToast } from "@/hooks/use-toast";
import { useQueueSocket } from "@/hooks/use-socket";

type QueueEntry = {
  id: number;
  queueNumber: string;
  fullName: string;
  workflow: "evaluation" | "direct_tagging";
  status: string;
  assignedCounterName?: string | null;
  createdAt: string;
};

export default function QueueAssistantDashboard() {
  const [, setLocation] = useLocation();
  const session = useStaffAuth();
  const { toast } = useToast();
  const [studentName, setStudentName] = useState("");
  const [studentType, setStudentType] = useState("regular_new");
  const [queueType, setQueueType] = useState("evaluation_enrollment");
  const [search, setSearch] = useState("");
  const [queues, setQueues] = useState<QueueEntry[]>([]);
  const [lastSlip, setLastSlip] = useState<QueueEntry | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  useQueueSocket(session?.role === "queue_assistant" ? session.counterId : undefined);

  useEffect(() => {
    if (session && session.role !== "queue_assistant") setLocation("/staff/login");
  }, [session, setLocation]);

  const loadQueues = async () => {
    if (!session) return;
    const response = await fetch(`/api/queue-assistant/queues?assistantId=${session.counterId}&search=${encodeURIComponent(search)}`);
    if (!response.ok) return;
    setQueues(await response.json());
  };

  useEffect(() => {
    void loadQueues();
    const interval = window.setInterval(loadQueues, 5000);
    return () => window.clearInterval(interval);
  }, [session?.counterId, search]);

  const queueTypeLabel = useMemo(() => {
    if (!lastSlip) return "";
    if (lastSlip.workflow === "direct_tagging") return "Direct Tagging";
    return queueType === "evaluation_only" ? "Evaluation Only" : "Evaluation + Enrollment";
  }, [lastSlip, queueType]);

  const handleGenerate = async () => {
    if (!session || !studentName.trim()) return;
    setIsGenerating(true);
    try {
      const response = await fetch("/api/queue-assistant/walk-ins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: studentName.trim(),
          studentType,
          queueType,
          assistantId: session.counterId,
        }),
      });
      if (!response.ok) throw new Error("Failed to generate queue");
      const created = await response.json();
      setLastSlip(created);
      setStudentName("");
      await loadQueues();
      toast({ title: `Generated ${created.queueNumber}` });
    } catch (err: any) {
      toast({ title: "Failed to generate queue", description: err.message, variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleLogout = () => {
    clearStaffSession();
    setLocation("/staff/login");
  };

  if (!session || session.role !== "queue_assistant") return null;

  return (
    <div className="min-h-screen bg-background p-6 text-foreground">
      <header className="mb-6 flex items-center justify-between rounded-xl border border-black/10 bg-white/80 p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <CcsLogo size="medium" />
          <div>
            <h1 className="text-2xl font-bold">Queue Assistant Dashboard</h1>
            <p className="text-xs uppercase tracking-widest text-primary">Walk-In Queue Operator</p>
          </div>
        </div>
        <Button variant="outline" className="gap-2 bg-white" onClick={handleLogout}>
          <LogOut className="h-4 w-4" /> Logout
        </Button>
      </header>

      <main className="grid gap-6 xl:grid-cols-[420px_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><UserPlus className="h-5 w-5 text-primary" /> Create Walk-In Queue</CardTitle>
              <CardDescription>Manual registration for students who cannot access the online queue.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input id="queue-assistant-student-name" name="studentName" value={studentName} onChange={(event) => setStudentName(event.target.value)} placeholder="Student Name" className="bg-white" />
              <Select value={studentType} onValueChange={setStudentType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="regular_new">Regular / New Student</SelectItem>
                  <SelectItem value="transferee">Transferee</SelectItem>
                  <SelectItem value="old">Old Student</SelectItem>
                  <SelectItem value="wep">WEP</SelectItem>
                </SelectContent>
              </Select>
              <Select value={queueType} onValueChange={setQueueType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="evaluation_enrollment">Evaluation + Enrollment</SelectItem>
                  <SelectItem value="evaluation_only">Evaluation Only</SelectItem>
                  <SelectItem value="direct_tagging">Direct Tagging</SelectItem>
                </SelectContent>
              </Select>
              <Button className="w-full maroon-gradient" onClick={handleGenerate} disabled={isGenerating || !studentName.trim()}>
                {isGenerating ? "Generating..." : "Generate Queue"}
              </Button>
            </CardContent>
          </Card>

          {lastSlip && (
            <Card className="print:shadow-none">
              <CardHeader>
                <CardTitle>Queue Slip</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-center">
                <div className="text-5xl font-black text-primary">{lastSlip.queueNumber}</div>
                <div className="text-xl font-semibold">{lastSlip.fullName}</div>
                <div className="text-sm text-gray-600">{queueTypeLabel}</div>
                <div className="text-sm text-gray-500">
                  {new Date(lastSlip.createdAt).toLocaleDateString()} · {new Date(lastSlip.createdAt).toLocaleTimeString()}
                </div>
                <Button variant="outline" className="gap-2 bg-white print:hidden" onClick={handlePrint}>
                  <Printer className="h-4 w-4" /> Print Queue Slip
                </Button>
              </CardContent>
            </Card>
          )}
        </div>

        <Card>
          <CardHeader className="border-b border-black/5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>Today's Generated Queues</CardTitle>
                <CardDescription>Read-only queue status monitoring.</CardDescription>
              </div>
              <div className="relative w-72">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input id="queue-assistant-search" name="queueAssistantSearch" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search queue or name" className="bg-white pl-9" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-black/5">
              {queues.map((entry) => (
                <div key={entry.id} className="grid grid-cols-[150px_1fr_140px_180px] items-center gap-4 p-4">
                  <div className="text-lg font-black text-primary">{entry.queueNumber}</div>
                  <div>
                    <div className="font-semibold">{entry.fullName}</div>
                    <div className="text-xs text-gray-500">{entry.workflow === "direct_tagging" ? "Direct Tagging" : "Evaluation"}</div>
                  </div>
                  <Badge variant="outline" className="justify-center capitalize">{entry.status.replace("_", " ")}</Badge>
                  <div className="text-sm text-gray-600">{entry.assignedCounterName ?? "Unassigned"}</div>
                </div>
              ))}
              {queues.length === 0 && <div className="p-8 text-center text-gray-400">No walk-in queues generated today.</div>}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
