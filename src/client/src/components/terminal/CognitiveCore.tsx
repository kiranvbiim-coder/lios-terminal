import { useEffect, useMemo, useState } from "react";
import { Boxes, CircleDot, GitBranch, Layers3, Search, Sparkles, Target, X } from "lucide-react";
import type { AnalyticalOpenMode } from "@/lib/terminalActionContracts";
import { getTerminalCapability } from "@/lib/terminalCatalog";
import { GuidedCapabilityExplainer } from "./GuidedExplainer";
import {
  TERMINAL_LENSES, loadLensStack, saveLensStack, suggestedViewsForLenses, toggleLens,
  type TerminalLensState,
} from "@/lib/terminalLensStack";
import {
  createScenario, ensureDefaultScenarios, getActiveScenario, loadScenarios, saveScenarios, setActiveScenario,
  subscribeScenarioUniverse, type TerminalScenario,
} from "@/lib/terminalScenarioUniverse";
import {
  createIntelligenceObject, loadIntelligenceObjects, saveIntelligenceObjects, subscribeIntelligenceObjects, upsertIntelligenceObject,
  type IntelligenceObject,
} from "@/lib/terminalIntelligenceObjects";
import { TERMINAL_USE_CASES, searchUseCases } from "@/lib/terminalUseCaseRegistry";
import type { ViewMode } from "@/lib/terminalTypes";

type Tab = "lenses" | "scenarios" | "use-cases" | "objects";

interface Props {
  activeView: ViewMode;
  activeSymbol?: string;
  onOpen: (view: ViewMode, mode: AnalyticalOpenMode, symbol?: string) => void;
  onClose: () => void;
}

function TabButton({ id, active, children, onClick }: { id: Tab; active: Tab; children: React.ReactNode; onClick: (id: Tab) => void }) {
  return <button onClick={() => onClick(id)} className={`border-b-2 px-3 py-2 text-[9px] font-bold tracking-widest ${active === id ? "border-[hsl(38,100%,50%)] text-[hsl(38,100%,60%)]" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{children}</button>;
}

export default function CognitiveCore({ activeView, activeSymbol, onOpen, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("lenses");
  const [lensState, setLensState] = useState<TerminalLensState>(() => loadLensStack());
  const [scenarios, setScenarios] = useState<TerminalScenario[]>(() => ensureDefaultScenarios());
  const [activeScenario, setScenario] = useState<TerminalScenario | null>(() => getActiveScenario());
  const [objects, setObjects] = useState<IntelligenceObject[]>(() => loadIntelligenceObjects());
  const [query, setQuery] = useState("");
  const capability = getTerminalCapability(activeView);

  useEffect(() => subscribeScenarioUniverse((next, active) => { setScenarios(next); setScenario(active); }), []);
  useEffect(() => subscribeIntelligenceObjects(setObjects), []);

  const useCases = useMemo(() => searchUseCases(query).slice(0, 16), [query]);
  const suggestedViews = useMemo(() => suggestedViewsForLenses(lensState.active).slice(0, 10), [lensState.active]);

  const toggle = (id: Parameters<typeof toggleLens>[1]) => {
    const next = toggleLens(lensState, id);
    setLensState(next);
    saveLensStack(next);
  };

  const captureCurrent = () => {
    const nextObject = createIntelligenceObject({
      kind: capability.symbolAware && activeSymbol ? "entity" : "note",
      label: capability.symbolAware && activeSymbol ? `${activeSymbol} · ${capability.label}` : capability.label,
      description: capability.description,
      symbol: capability.symbolAware ? activeSymbol : undefined,
      view: activeView,
      status: "live",
      tags: ["active-context", capability.shortLabel.toLowerCase()],
      metadata: { capability: capability.label, capturedFrom: "cognitive-core" },
    });
    const next = upsertIntelligenceObject(objects, nextObject);
    setObjects(next);
    saveIntelligenceObjects(next);
    setTab("objects");
  };

  const addScenario = () => {
    const scenario = createScenario({ name: `SCENARIO ${scenarios.length + 1}`, kind: "custom", scope: capability.symbolAware ? "entity" : "global", symbol: activeSymbol, probability: 0, assumptions: [] });
    const next = [scenario, ...scenarios];
    saveScenarios(next);
    setActiveScenario(scenario.id);
  };

  return (
    <div className="fixed inset-0 z-[86] bg-black/72 p-3 backdrop-blur-[4px]" onMouseDown={onClose}>
      <section className="lios-v4-overlay mx-auto flex h-[min(780px,calc(100vh-24px))] w-full max-w-6xl flex-col overflow-hidden border" onMouseDown={(event) => event.stopPropagation()} aria-label="LiOS Cognitive Core">
        <header className="flex items-center gap-3 border-b border-border/70 px-4 py-3">
          <div className="grid h-9 w-9 place-items-center border border-[hsl(38,100%,50%)/28%] bg-[hsl(38,100%,50%)/7%] text-[hsl(38,100%,58%)]"><Sparkles className="h-4 w-4" /></div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-bold tracking-[.12em] text-foreground">COGNITIVE CORE</div>
            <div className="mt-1 text-[8px] tracking-wide text-muted-foreground">OBJECTS · LENSES · SCENARIOS · USE CASES · DECISION CHAINS</div>
          </div>
          {activeSymbol && <span className="border border-[hsl(38,100%,50%)/24%] px-2 py-1 text-[9px] font-bold text-[hsl(38,100%,58%)]">{activeSymbol}</span>}
          <button onClick={captureCurrent} className="border border-border px-2.5 py-1.5 text-[8px] font-bold text-muted-foreground hover:border-[hsl(38,100%,50%)/30%] hover:text-[hsl(38,100%,58%)]">CAPTURE CONTEXT</button>
          <button onClick={onClose} className="p-1.5 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </header>

        <div className="flex items-center border-b border-border/60 bg-black/20 px-2">
          <TabButton id="lenses" active={tab} onClick={setTab}>LENSES</TabButton>
          <TabButton id="scenarios" active={tab} onClick={setTab}>SCENARIOS</TabButton>
          <TabButton id="use-cases" active={tab} onClick={setTab}>USE CASES</TabButton>
          <TabButton id="objects" active={tab} onClick={setTab}>OBJECTS</TabButton>
          <div className="ml-auto flex items-center gap-2 px-2 text-[8px] text-muted-foreground"><CircleDot className="h-3 w-3 text-[hsl(38,100%,55%)]" />{activeScenario?.name ?? "NO SCENARIO"}</div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 scrollbar-thin">
          {tab === "lenses" && <div className="space-y-5">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">{TERMINAL_LENSES.map((lens) => {
              const active = lensState.active.includes(lens.id);
              return <button key={lens.id} onClick={() => toggle(lens.id)} className={`group min-h-32 border p-3 text-left transition-all ${active ? "border-[hsl(38,100%,50%)/40%] bg-[hsl(38,100%,50%)/6%] shadow-[inset_0_1px_0_rgba(255,255,255,.025)]" : "border-border/70 bg-white/[.012] hover:border-border hover:bg-white/[.025]"}`}>
                <div className="flex items-center justify-between"><span className="text-[8px] font-bold tracking-[.15em] text-[hsl(38,100%,58%)]">{lens.shortLabel}</span><Layers3 className="h-3.5 w-3.5 text-muted-foreground" /></div>
                <div className="mt-4 text-[10px] font-bold text-foreground">{lens.label}</div><p className="mt-2 text-[8px] leading-relaxed text-muted-foreground">{lens.description}</p>
              </button>;
            })}</div>
            <section className="border border-border/70 bg-black/15 p-3">
              <div className="mb-3 text-[8px] font-bold tracking-[.13em] text-muted-foreground">LENS STACK OUTPUT · SUGGESTED ANALYTICAL SURFACES</div>
              <div className="flex flex-wrap gap-2">{suggestedViews.length ? suggestedViews.map((view) => { const item = getTerminalCapability(view); return <GuidedCapabilityExplainer key={view} capability={item}><button onClick={() => onOpen(view, "tab", activeSymbol)} className="border border-border px-2.5 py-1.5 text-[8px] text-foreground hover:border-[hsl(38,100%,50%)/30%] hover:text-[hsl(38,100%,58%)]">{item.shortLabel} · {item.label}</button></GuidedCapabilityExplainer>; }) : <span className="text-[8px] text-muted-foreground">Activate one or more analytical lenses.</span>}</div>
            </section>
          </div>}

          {tab === "scenarios" && <div className="space-y-4">
            <div className="flex items-center justify-between"><div><div className="text-[10px] font-bold text-foreground">SCENARIO UNIVERSE</div><div className="mt-1 text-[8px] text-muted-foreground">One scenario context can be shared across linked models and panes.</div></div><button onClick={addScenario} className="border border-[hsl(38,100%,50%)/30%] bg-[hsl(38,100%,50%)/6%] px-3 py-2 text-[8px] font-bold text-[hsl(38,100%,58%)]">+ BRANCH SCENARIO</button></div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{scenarios.map((scenario) => <button key={scenario.id} onClick={() => setActiveScenario(scenario.id)} className={`min-h-32 border p-3 text-left ${activeScenario?.id === scenario.id ? "border-[hsl(38,100%,50%)/42%] bg-[hsl(38,100%,50%)/6%]" : "border-border/70 bg-white/[.012] hover:bg-white/[.025]"}`}>
              <div className="flex items-center justify-between"><span className="text-[9px] font-bold text-foreground">{scenario.name}</span><GitBranch className="h-3.5 w-3.5 text-muted-foreground" /></div>
              <div className="mt-2 flex gap-2 text-[7px] tracking-wider text-muted-foreground"><span>{scenario.kind.toUpperCase()}</span><span>·</span><span>{scenario.scope.toUpperCase()}</span>{scenario.symbol && <><span>·</span><span className="text-[hsl(38,100%,58%)]">{scenario.symbol}</span></>}</div>
              <p className="mt-3 text-[8px] leading-relaxed text-muted-foreground">{scenario.thesis || "No thesis defined yet."}</p><div className="mt-3 text-[8px] text-muted-foreground">{scenario.assumptions.length} assumptions · {scenario.probability ?? 0}% probability</div>
            </button>)}</div>
          </div>}

          {tab === "use-cases" && <div className="space-y-4">
            <div className="flex items-center gap-2 border border-border/70 bg-black/25 px-3 py-2"><Search className="h-3.5 w-3.5 text-[hsl(38,100%,55%)]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="SEARCH OUTCOME, DOMAIN, COMMAND OR DIFFERENTIATOR" className="w-full bg-transparent text-[9px] text-foreground outline-none placeholder:text-muted-foreground/60" /><span className="text-[8px] text-muted-foreground">{TERMINAL_USE_CASES.length} USE CASES</span></div>
            <div className="grid gap-3 md:grid-cols-2">{useCases.map((useCase) => <article key={useCase.id} className="border border-border/70 bg-white/[.012] p-3 hover:bg-white/[.02]">
              <div className="flex items-start gap-3"><div className="grid h-8 w-8 place-items-center border border-[hsl(38,100%,50%)/22%] bg-[hsl(38,100%,50%)/4%]"><Target className="h-3.5 w-3.5 text-[hsl(38,100%,58%)]" /></div><div className="min-w-0 flex-1"><div className="text-[10px] font-bold text-foreground">{useCase.title}</div><div className="mt-1 text-[7px] tracking-widest text-[hsl(38,100%,58%)]">{useCase.domain.toUpperCase()}</div></div></div>
              <p className="mt-3 text-[8px] leading-relaxed text-muted-foreground">{useCase.outcome}</p><div className="mt-3 border-l border-[hsl(38,100%,50%)/30%] pl-2 text-[8px] text-foreground">{useCase.commandExample}</div><div className="mt-2 text-[7px] leading-relaxed text-muted-foreground">WHY LIOS · {useCase.differentiator}</div>
              <div className="mt-3 flex flex-wrap gap-1.5">{useCase.views.slice(0, 6).map((view) => <button key={view} onClick={() => onOpen(view, "tab", activeSymbol)} className="border border-border px-2 py-1 text-[7px] text-muted-foreground hover:text-foreground">{getTerminalCapability(view).shortLabel}</button>)}</div>
            </article>)}</div>
          </div>}

          {tab === "objects" && <div className="space-y-3">
            <div className="flex items-center justify-between"><div><div className="text-[10px] font-bold text-foreground">INTELLIGENCE OBJECTS</div><div className="mt-1 text-[8px] text-muted-foreground">Every durable entity, metric, model, scenario, evidence item and decision becomes reusable terminal state.</div></div><span className="border border-border px-2 py-1 text-[8px] text-muted-foreground">{objects.length} OBJECTS</span></div>
            {objects.length ? <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{objects.slice(0, 60).map((object) => <button key={object.id} data-terminal-object onClick={() => object.view && onOpen(object.view, "current", object.symbol)} className="border border-border/70 bg-white/[.012] p-3 text-left hover:border-[hsl(38,100%,50%)/24%] hover:bg-white/[.024]">
              <div className="flex items-center justify-between"><span className="text-[7px] font-bold tracking-widest text-[hsl(38,100%,58%)]">{object.kind.toUpperCase()}</span><Boxes className="h-3 w-3 text-muted-foreground" /></div><div className="mt-2 truncate text-[9px] font-bold text-foreground">{object.label}</div><p className="mt-1 line-clamp-2 text-[7px] leading-relaxed text-muted-foreground">{object.description || "Durable LiOS intelligence object"}</p><div className="mt-2 flex gap-1 text-[7px] text-muted-foreground">{object.symbol && <span className="text-[hsl(38,100%,58%)]">{object.symbol}</span>}<span>{object.status.toUpperCase()}</span><span>· {object.relations.length} LINKS</span></div>
            </button>)}</div> : <div className="grid min-h-56 place-items-center border border-dashed border-border/70 text-center"><div><Boxes className="mx-auto h-6 w-6 text-muted-foreground" /><div className="mt-3 text-[9px] font-bold text-foreground">NO INTELLIGENCE OBJECTS YET</div><button onClick={captureCurrent} className="mt-3 text-[8px] text-[hsl(38,100%,58%)]">CAPTURE ACTIVE CONTEXT →</button></div></div>}
          </div>}
        </div>
      </section>
    </div>
  );
}
