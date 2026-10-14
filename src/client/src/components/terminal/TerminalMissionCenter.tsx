import { useMemo, useState } from "react";
import { CheckCircle2, Circle, Flag, Play, RotateCcw, X } from "lucide-react";
import {
  getMissionProgress, getVisibleTerminalMissions, missionCompletionRatio, resetTerminalMission, startTerminalMission,
  type TerminalMission,
} from "@/lib/terminalMissions";
import type { ViewMode } from "@/lib/terminalTypes";

interface Props {
  onOpenView: (view: ViewMode) => void;
  onClose: () => void;
  isInternal: boolean;
}

export default function TerminalMissionCenter({ onOpenView, onClose, isInternal }: Props) {
  const missions = useMemo(() => getVisibleTerminalMissions(isInternal), [isInternal]);
  const [version, setVersion] = useState(0);
  const [selectedId, setSelectedId] = useState(missions[0]?.id ?? "");
  const selected = useMemo(() => missions.find((mission) => mission.id === selectedId) ?? missions[0], [missions, selectedId]);
  const selectedProgress = selected ? getMissionProgress(selected.id) : null;

  const launchMission = (mission: TerminalMission) => {
    const progress = startTerminalMission(mission.id);
    setVersion((value) => value + 1);
    const next = mission.steps.find((step) => !progress.completedStepIds.includes(step.id));
    if (next) onOpenView(next.view);
  };

  const reset = (mission: TerminalMission) => {
    resetTerminalMission(mission.id);
    setVersion((value) => value + 1);
  };

  void version;

  if (!selected) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-3" onMouseDown={onClose}>
      <section className="flex h-[min(720px,92vh)] w-full max-w-5xl overflow-hidden border border-border bg-[#080808] shadow-2xl" onMouseDown={(event) => event.stopPropagation()} aria-label="Outcome missions">
        <aside className="hidden w-72 shrink-0 border-r border-border md:block">
          <header className="border-b border-border p-4"><div className="flex items-center gap-2 font-terminal text-[10px] font-bold tracking-widest text-foreground"><Flag className="h-4 w-4 text-amber-300" /> OUTCOME MISSIONS</div><p className="mt-2 font-terminal text-[8px] leading-relaxed text-muted-foreground">Learn LiOS by completing real analytical outcomes, not a generic product tour. Inaccessible audience-only steps are never surfaced.</p></header>
          <div className="p-2">{missions.map((mission) => { const progress = getMissionProgress(mission.id); const ratio = missionCompletionRatio(mission, progress); return <button key={mission.id} onClick={() => setSelectedId(mission.id)} className={`mb-1 w-full border p-3 text-left ${selected.id === mission.id ? "border-amber-400/50 bg-amber-400/[0.05]" : "border-transparent hover:border-border hover:bg-white/[0.03]"}`}><div className="flex items-center justify-between gap-2"><span className="font-terminal text-[9px] text-foreground">{mission.label}</span><span className="font-terminal text-[7px] text-muted-foreground">{Math.round(ratio * 100)}%</span></div><div className="mt-2 h-1 bg-border"><div className="h-full bg-amber-400" style={{ width: `${ratio * 100}%` }} /></div></button>; })}</div>
        </aside>
        <main className="min-w-0 flex-1 overflow-y-auto scrollbar-thin">
          <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-[#080808] p-4"><div className="min-w-0 flex-1"><div className="font-terminal text-[11px] font-bold tracking-widest text-foreground">{selected.label}</div><div className="mt-1 font-terminal text-[8px] text-muted-foreground">~{selected.estimatedMinutes} MIN · OUTCOME: {selected.outcome.toUpperCase()}</div></div><button onClick={onClose} className="border border-border p-1.5 text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button></header>
          <div className="space-y-5 p-4 sm:p-6"><p className="max-w-2xl font-terminal text-[9px] leading-relaxed text-muted-foreground">{selected.description}</p><div className="space-y-2">{selected.steps.map((step, index) => { const complete = selectedProgress?.completedStepIds.includes(step.id) ?? false; return <button key={step.id} onClick={() => { if (!selectedProgress) startTerminalMission(selected.id); onOpenView(step.view); setVersion((value) => value + 1); }} className={`flex w-full items-start gap-3 border p-3 text-left ${complete ? "border-emerald-500/30 bg-emerald-500/[0.03]" : "border-border hover:border-amber-400/40 hover:bg-white/[0.02]"}`}><div className="mt-0.5">{complete ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : <Circle className="h-4 w-4 text-muted-foreground" />}</div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="font-terminal text-[8px] text-muted-foreground">STEP {index + 1}</span><span className="font-terminal text-[9px] font-bold text-foreground">{step.label}</span></div><p className="mt-1 font-terminal text-[8px] leading-relaxed text-muted-foreground">{step.description}</p></div><span className="border border-border px-2 py-1 font-terminal text-[7px] text-cyan-300">OPEN</span></button>; })}</div><div className="flex flex-wrap gap-2"><button onClick={() => launchMission(selected)} className="flex items-center gap-2 border border-amber-500/50 bg-amber-500/10 px-3 py-2 font-terminal text-[8px] font-bold text-amber-200"><Play className="h-3 w-3" /> {selectedProgress ? "CONTINUE MISSION" : "START MISSION"}</button>{selectedProgress && <button onClick={() => reset(selected)} className="flex items-center gap-2 border border-border px-3 py-2 font-terminal text-[8px] text-muted-foreground hover:text-foreground"><RotateCcw className="h-3 w-3" /> RESET</button>}</div></div>
        </main>
      </section>
    </div>
  );
}
