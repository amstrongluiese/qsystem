import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { GlobalEffects } from "@/components/layout/global-effects";

import StudentLanding from "@/pages/student-landing";
import StudentTracker from "@/pages/student-tracker";
import StaffLogin from "@/pages/staff-login";
import EvaluatorDashboard from "@/pages/evaluator-dashboard";
import TaggerDashboard from "@/pages/tagger-dashboard";
import AdminDashboard from "@/pages/admin-dashboard";
import HybridDashboard from "@/pages/hybrid-dashboard";
import TvDisplay from "@/pages/tv-display";
import TvLiteDisplay from "@/pages/tv-lite-display";
import QueueAssistantDashboard from "@/pages/queue-assistant-dashboard";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={StudentLanding} />
      <Route path="/track/:queueId" component={StudentTracker} />
      <Route path="/staff/login" component={StaffLogin} />
      <Route path="/evaluator" component={EvaluatorDashboard} />
      <Route path="/tagger" component={TaggerDashboard} />
      <Route path="/admin" component={AdminDashboard} />
      <Route path="/queue-assistant" component={QueueAssistantDashboard} />
      <Route path="/hybrid" component={HybridDashboard} />
      <Route path="/tv" component={TvDisplay} />
      <Route path="/tv-lite" component={TvLiteDisplay} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <GlobalEffects />
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
