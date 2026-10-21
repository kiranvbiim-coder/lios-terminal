import { useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useState, useMemo } from "react";
import { GitCompare, Calendar, CheckSquare, AlertTriangle, Play, CheckCircle2, User } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

// Mock Synergy Capture curve
const MOCK_SYNERGY_CURVE = [
  { month: "M1", Target: 5, Actual: 4.8 },
  { month: "M2", Target: 10, Actual: 9.5 },
  { month: "M3", Target: 18, Actual: 16.2 },
  { month: "M4", Target: 25, Actual: 24.0 },
  { month: "M5", Target: 35, Actual: 35.8 },
  { month: "M6", Target: 45, Actual: 48.2 },
  { month: "M7", Target: 55, Actual: 58.0 },
  { month: "M8", Target: 65, Actual: null },
  { month: "M9", Target: 75, Actual: null },
  { month: "M10", Target: 85, Actual: null },
  { month: "M11", Target: 92, Actual: null },
  { month: "M12", Target: 100, Actual: null },
];

const MOCK_TASKS = [
  { id: 1, name: "ERP System Migration", stream: "IT", status: "In Progress", progress: 65, risk: "Medium", owner: "Sarah Chen" },
  { id: 2, name: "Unified HR Directory & Payroll", stream: "HR", status: "Completed", progress: 100, risk: "Low", owner: "Marcus Brody" },
  { id: 3, name: "Cross-Selling Force Alignment", stream: "Sales", status: "In Progress", progress: 40, risk: "High", owner: "Elena Rostova" },
  { id: 4, name: "Supply Chain & Logistics Consolidation", stream: "Operations", status: "In Progress", progress: 25, risk: "High", owner: "John Dumont" },
  { id: 5, name: "SEC/FINRA Entity Merging", stream: "Legal", status: "Completed", progress: 100, risk: "Low", owner: "Claire Vance" },
  { id: 6, name: "Brand Architecture Rollout", stream: "Marketing", status: "Not Started", progress: 0, risk: "Low", owner: "Daisuke Tanaka" },
];

export default function IntegrationTrackerPanel() {
  const [selectedStream, setSelectedStream] = useTerminalArtifactState("IntegrationTrackerPanel.selectedStream", "All");

  const filteredTasks = useMemo(() => {
    return MOCK_TASKS.filter(t => selectedStream === "All" || t.stream === selectedStream);
  }, [selectedStream]);

  // Aggregate completion status
  const avgProgress = useMemo(() => {
    const sum = MOCK_TASKS.reduce((acc, t) => acc + t.progress, 0);
    return Math.round(sum / MOCK_TASKS.length);
  }, []);

  const getRiskBadgeColor = (risk: string) => {
    switch (risk) {
      case "High": return "text-rose-400 bg-rose-950/40 border border-rose-800";
      case "Medium": return "text-amber-400 bg-amber-950/40 border border-amber-800";
      default: return "text-emerald-400 bg-emerald-950/40 border border-emerald-800";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "Completed": return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
      case "In Progress": return <Play className="w-3.5 h-3.5 text-blue-400 animate-pulse shrink-0" />;
      default: return <Calendar className="w-3.5 h-3.5 text-slate-500 shrink-0" />;
    }
  };

  return (
    <div className="h-full flex flex-col bg-[#050505] text-foreground overflow-hidden">
      {/* Panel Top bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-[#070707] shrink-0">
        <GitCompare className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="panel-label font-bold text-xs tracking-wider">POST-MERGER INTEGRATION TRACKER</span>
        <span className="ml-auto font-terminal text-[8px] text-muted-foreground tracking-widest">PMI</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* KPI Row */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="bg-[#070707] border-border font-terminal">
            <CardContent className="p-4">
              <span className="text-[10px] text-muted-foreground uppercase">Integration Progress</span>
              <div className="flex items-center gap-4 mt-2">
                <span className="text-2xl font-bold text-emerald-400">{avgProgress}%</span>
                <Progress value={avgProgress} className="flex-1 bg-neutral-900 h-1.5" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-[#070707] border-border font-terminal">
            <CardContent className="p-4">
              <span className="text-[10px] text-muted-foreground uppercase">Synergies Realized</span>
              <div className="flex items-baseline gap-2 mt-2">
                <span className="text-2xl font-bold text-cyan-400">$48.2M</span>
                <span className="text-[10px] text-emerald-400 font-semibold">(+$3.2M vs Target)</span>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-[#070707] border-border font-terminal">
            <CardContent className="p-4">
              <span className="text-[10px] text-muted-foreground uppercase">Critical Path Risks</span>
              <div className="flex items-baseline gap-2 mt-2">
                <span className="text-2xl font-bold text-rose-500">2 Streams</span>
                <span className="text-[10px] text-rose-400 bg-rose-950/20 px-2 py-0.5 border border-rose-900/50 rounded font-terminal">CRITICAL</span>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-[#070707] border-border font-terminal">
            <CardContent className="p-4">
              <span className="text-[10px] text-muted-foreground uppercase">Target Comp Date</span>
              <div className="flex items-baseline gap-2 mt-2">
                <span className="text-xl font-bold text-slate-300">Dec 31, 2026</span>
                <span className="text-[9px] text-muted-foreground">Day 142 of 365</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Synergy Realization Curve & Task Lists */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="bg-[#070707] border-border lg:col-span-2">
            <CardHeader className="p-4 border-b border-border">
              <CardTitle className="text-xs font-bold uppercase tracking-wider text-[hsl(38,95%)]">Synergy Capture Progress Curve ($M)</CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={MOCK_SYNERGY_CURVE} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#222" />
                    <XAxis dataKey="month" stroke="#888" fontSize={10} />
                    <YAxis stroke="#888" fontSize={10} />
                    <Tooltip contentStyle={{ backgroundColor: "#0d0d0d", borderColor: "#333", color: "#fff" }} />
                    <Area type="monotone" dataKey="Target" stroke="hsl(38,95%,50%)" fill="hsl(38,95%,50%)/10%" name="Target Capture ($M)" />
                    <Area type="monotone" dataKey="Actual" stroke="#10b981" fill="#10b981/10%" name="Actual Captured ($M)" connectNulls />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Gantt / Milestones Status list */}
          <Card className="bg-[#070707] border-border flex flex-col">
            <CardHeader className="p-4 border-b border-border shrink-0">
              <CardTitle className="text-xs font-bold uppercase tracking-wider text-[hsl(38,95%)]">Operational Streams</CardTitle>
            </CardHeader>
            <CardContent className="p-4 flex-1 overflow-y-auto space-y-4 font-terminal text-xs">
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between mb-1">
                    <span>IT & Systems integration</span>
                    <span className="text-blue-400">65%</span>
                  </div>
                  <Progress value={65} className="bg-neutral-900 h-1" />
                </div>
                <div>
                  <div className="flex justify-between mb-1">
                    <span>HR & Personnel Alignment</span>
                    <span className="text-emerald-400">100%</span>
                  </div>
                  <Progress value={100} className="bg-neutral-900 h-1" />
                </div>
                <div>
                  <div className="flex justify-between mb-1">
                    <span>Commercial & Sales Teams</span>
                    <span className="text-amber-500">40%</span>
                  </div>
                  <Progress value={40} className="bg-neutral-900 h-1" />
                </div>
                <div>
                  <div className="flex justify-between mb-1">
                    <span>Operations & Logistics</span>
                    <span className="text-rose-500">25%</span>
                  </div>
                  <Progress value={25} className="bg-neutral-900 h-1" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Milestone Task Checklist Table */}
        <Card className="bg-[#070707] border-border">
          <CardHeader className="p-4 border-b border-border flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-xs font-bold uppercase tracking-wider text-[hsl(38,95%)]">Milestone Checklist</CardTitle>
              <CardDescription className="text-[9px]">Critical path items and integration checkpoints</CardDescription>
            </div>
            <select 
              value={selectedStream}
              onChange={(e) => setSelectedStream(e.target.value)}
              className="bg-[#090909] border border-border rounded px-3 py-1 text-xs text-muted-foreground focus:outline-none"
            >
              <option value="All">All Streams</option>
              <option value="IT">IT</option>
              <option value="HR">HR</option>
              <option value="Sales">Sales</option>
              <option value="Operations">Operations</option>
              <option value="Legal">Legal</option>
            </select>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-[#0d0d0d]">
                <TableRow className="border-b border-border">
                  <TableHead className="text-[10px] font-bold">Milestone Task Name</TableHead>
                  <TableHead className="text-[10px] font-bold">Stream</TableHead>
                  <TableHead className="text-[10px] font-bold">Status</TableHead>
                  <TableHead className="text-[10px] font-bold">Progress</TableHead>
                  <TableHead className="text-[10px] font-bold">Risk Level</TableHead>
                  <TableHead className="text-[10px] font-bold">Owner</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTasks.map((task) => (
                  <TableRow key={task.id} className="border-b border-border hover:bg-white/5 transition-colors">
                    <TableCell className="font-semibold text-xs text-foreground">{task.name}</TableCell>
                    <TableCell className="text-xs font-terminal">{task.stream}</TableCell>
                    <TableCell className="text-xs">
                      <div className="flex items-center gap-1.5">
                        {getStatusIcon(task.status)}
                        <span>{task.status}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs w-1/5">
                      <div className="flex items-center gap-2">
                        <span className="font-terminal font-semibold w-8 text-right shrink-0">{task.progress}%</span>
                        <Progress value={task.progress} className="bg-neutral-900 h-1 flex-1" />
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">
                      <span className={`px-2 py-0.5 rounded text-[8px] font-bold font-terminal ${getRiskBadgeColor(task.risk)}`}>
                        {task.risk.toUpperCase()}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground flex items-center gap-1">
                      <User className="w-3 h-3 text-muted-foreground" />
                      <span>{task.owner}</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
