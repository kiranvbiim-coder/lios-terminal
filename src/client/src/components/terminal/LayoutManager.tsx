import { useEffect, useMemo, useState } from "react";
import {
  buildWorkspaceShareUrl, deleteLayout, getSavedLayouts, getWorkspacePanes, PRESET_LAYOUTS, saveLayout,
} from "@/lib/terminalWorkspace";
import { getTerminalCapability } from "@/lib/terminalCatalog";
import type { WorkspaceState } from "@/lib/terminalTypes";
import { Check, LayoutGrid, PanelsTopLeft, Save, Share2, Sparkles, Trash2, X } from "lucide-react";

interface Props {
  onClose: () => void;
  currentWorkspace: WorkspaceState;
  onApplyLayout: (layout: WorkspaceState) => void;
}

interface SceneMeta {
  title: string;
  description: string;
  intent: string;
}

const SCENE_META: Record<string, SceneMeta> = {
  MORNING: { title: "Morning Review", description: "Market state and current evidence side by side.", intent: "ORIENT" },
  ANALYSIS: { title: "Quick Analysis", description: "Price structure with a focused company surface.", intent: "ANALYSE" },
  VALUATION: { title: "Valuation Studio", description: "Financials, DCF, peers and downside in one spatial model.", intent: "VALUE" },
  "EQUITY RESEARCH": { title: "Equity Research", description: "Chart, statements, valuation and news for full-company investigation.", intent: "RESEARCH" },
  "PORTFOLIO PM": { title: "Portfolio Manager", description: "Portfolio, stress, dependency and market context together.", intent: "MANAGE" },
  MACRO: { title: "Macro Regime", description: "Macro dashboard, indicators, calendar and economic context.", intent: "DIAGNOSE" },
  POLICY: { title: "Policy Scenario", description: "Signals, workbench and policy modeling in a four-pane reasoning scene.", intent: "MODEL" },
  "SUPPLY CHAIN": { title: "Supply Chain Operations", description: "Operational dashboard, freight data, model and spreadsheet delivery.", intent: "OPTIMIZE" },
  SUSTAINABILITY: { title: "Transition Intelligence", description: "Sustainability, climate, indicators and scenario modeling.", intent: "TRANSITION" },
  DATA: { title: "Data Environment", description: "Coverage, connectors and engine readiness in one technical scene.", intent: "CONNECT" },
  RISK: { title: "Risk Lens", description: "Stress and sentiment with minimal visual distraction.", intent: "CHALLENGE" },
};

function ScenePreview({ workspace }: { workspace: WorkspaceState }) {
  const panes = getWorkspacePanes(workspace);
  const count = panes.length;
  const gridClass = count <= 1 ? "grid-cols-1" : count === 2 ? "grid-cols-2" : "grid-cols-2";
  return (
    <div className={`grid ${gridClass} h-16 gap-1 rounded-lg border border-border/55 bg-black/15 p-1.5`} aria-hidden="true">
      {panes.map(({ id, pane }) => <div key={id} className={`relative overflow-hidden rounded border border-border/50 bg-white/[0.018] ${count === 3 && id === "primary" ? "row-span-2" : ""}`}><div className="absolute inset-x-1 top-1 h-px bg-amber-300/25" /><div className="font-ui absolute bottom-1 left-1 right-1 truncate text-[6px] text-muted-foreground/60">{getTerminalCapability(pane.view).shortLabel}</div></div>)}
    </div>
  );
}

export default function LayoutManager({ onClose, currentWorkspace, onApplyLayout }: Props) {
  const [layouts, setLayouts] = useState<Record<string, WorkspaceState>>({});
  const [name, setName] = useState("");
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<"scenes" | "saved">("scenes");

  const currentPaneCount = useMemo(() => getWorkspacePanes(currentWorkspace).length, [currentWorkspace]);
  const refreshLayouts = () => setLayouts(getSavedLayouts());

  useEffect(() => { refreshLayouts(); }, []);

  const handleSave = () => {
    const cleanName = name.trim();
    if (!cleanName) return;
    saveLayout(cleanName, currentWorkspace);
    setName("");
    refreshLayouts();
    setTab("saved");
  };

  const handleDelete = (layoutName: string) => {
    deleteLayout(layoutName);
    refreshLayouts();
  };

  const handleShare = async () => {
    const url = buildWorkspaceShareUrl(currentWorkspace);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = url;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 backdrop-blur-[3px]" onClick={onClose}>
      <section className="lios-v4-overlay flex h-[min(760px,92vh)] w-full max-w-5xl overflow-hidden rounded-2xl" onClick={(event) => event.stopPropagation()} aria-label="Analysis scenes and saved layouts">
        <aside className="hidden w-64 shrink-0 border-r border-border/55 bg-black/[0.08] md:flex md:flex-col">
          <div className="p-5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-amber-500/20 bg-amber-500/[0.05] text-amber-300"><PanelsTopLeft className="h-4 w-4" /></div>
            <h2 className="font-ui mt-4 text-[14px] font-semibold tracking-tight text-foreground">Analysis Scenes</h2>
            <p className="font-ui mt-2 text-[9px] leading-relaxed text-muted-foreground">Restore a complete analytical environment instead of rebuilding panes every time.</p>
          </div>
          <nav className="px-2">
            <button onClick={() => setTab("scenes")} className={`font-ui flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-[9px] font-medium transition-colors ${tab === "scenes" ? "bg-white/[0.05] text-foreground" : "text-muted-foreground hover:bg-white/[0.025] hover:text-foreground"}`}><Sparkles className="h-3.5 w-3.5 text-amber-300/80" /> Curated scenes</button>
            <button onClick={() => setTab("saved")} className={`font-ui mt-1 flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-[9px] font-medium transition-colors ${tab === "saved" ? "bg-white/[0.05] text-foreground" : "text-muted-foreground hover:bg-white/[0.025] hover:text-foreground"}`}><LayoutGrid className="h-3.5 w-3.5 text-cyan-300/80" /> My layouts <span className="ml-auto lios-pane-code text-[7px] text-muted-foreground">{Object.keys(layouts).length}</span></button>
          </nav>
          <div className="mt-auto border-t border-border/50 p-3">
            <div className="font-ui rounded-xl border border-border/50 bg-white/[0.015] p-3 text-[8px] text-muted-foreground"><span className="font-semibold text-foreground">Current workspace</span><div className="mt-1">{currentPaneCount} pane{currentPaneCount === 1 ? "" : "s"} · safe local state</div></div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto scrollbar-thin">
          <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border/55 bg-[hsl(var(--lios-overlay)/.94)] px-4 py-3 backdrop-blur-xl">
            <div className="min-w-0 flex-1 md:hidden"><div className="font-ui text-[12px] font-semibold text-foreground">Analysis Scenes</div></div>
            <div className="hidden min-w-0 flex-1 md:block"><div className="font-ui text-[12px] font-semibold text-foreground">{tab === "scenes" ? "Choose an analytical scene" : "Saved workspace library"}</div><div className="font-ui mt-1 text-[8px] text-muted-foreground">Spatial memory is part of the analytical workflow.</div></div>
            <button onClick={handleShare} className="font-ui flex items-center gap-2 rounded-lg border border-border/60 px-2.5 py-2 text-[8px] text-muted-foreground transition-colors hover:bg-white/[0.035] hover:text-foreground" data-testid="share-workspace">{copied ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Share2 className="h-3.5 w-3.5" />}{copied ? "Copied" : "Share"}</button>
            <button onClick={onClose} className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-white/[0.035] hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
          </header>

          <div className="p-4 sm:p-5">
            <div className="mb-4 flex gap-1 md:hidden"><button onClick={() => setTab("scenes")} className={`font-ui rounded-lg border px-3 py-2 text-[8px] ${tab === "scenes" ? "border-amber-400/30 bg-amber-400/[0.05] text-amber-200" : "border-border/60 text-muted-foreground"}`}>Scenes</button><button onClick={() => setTab("saved")} className={`font-ui rounded-lg border px-3 py-2 text-[8px] ${tab === "saved" ? "border-cyan-400/30 bg-cyan-400/[0.05] text-cyan-200" : "border-border/60 text-muted-foreground"}`}>My layouts</button></div>

            {tab === "scenes" ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {Object.entries(PRESET_LAYOUTS).map(([presetName, state]) => {
                  const meta = SCENE_META[presetName] ?? { title: presetName, description: "Restore this analytical workspace.", intent: "WORK" };
                  const paneCount = getWorkspacePanes(state).length;
                  return <button key={presetName} onClick={() => { onApplyLayout(state); onClose(); }} className="group rounded-2xl border border-border/55 bg-white/[0.012] p-3 text-left transition-all duration-150 hover:-translate-y-0.5 hover:border-amber-400/25 hover:bg-white/[0.025] hover:shadow-xl"><ScenePreview workspace={state} /><div className="mt-3 flex items-start justify-between gap-2"><div className="min-w-0"><div className="font-ui text-[10px] font-semibold text-foreground">{meta.title}</div><div className="font-ui mt-1 text-[8px] leading-relaxed text-muted-foreground">{meta.description}</div></div><span className="lios-pane-code shrink-0 rounded-md border border-border/60 px-1.5 py-1 text-[6px] text-amber-300/80">{meta.intent}</span></div><div className="font-ui mt-3 flex items-center justify-between border-t border-border/40 pt-2 text-[7px] text-muted-foreground"><span>{paneCount} pane{paneCount === 1 ? "" : "s"}</span><span className="opacity-0 transition-opacity group-hover:opacity-100">Open scene →</span></div></button>;
                })}
              </div>
            ) : (
              <div className="space-y-5">
                <section className="rounded-2xl border border-border/55 bg-white/[0.012] p-4">
                  <div className="font-ui text-[10px] font-semibold text-foreground">Save current workspace</div>
                  <p className="font-ui mt-1 text-[8px] text-muted-foreground">Keep a layout you have tuned for a client, thesis, recurring review, or personal workflow.</p>
                  <div className="mt-3 flex gap-2"><input type="text" value={name} onChange={(event) => setName(event.target.value)} maxLength={40} placeholder="e.g. NVDA thesis · Q3 review" className="font-ui h-9 min-w-0 flex-1 rounded-lg border border-border/65 bg-black/15 px-3 text-[9px] text-foreground outline-none placeholder:text-muted-foreground/45 focus:border-amber-400/30" /><button onClick={handleSave} className="font-ui flex items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/[0.055] px-3 text-[8px] font-semibold text-amber-200 transition-colors hover:bg-amber-500/[0.1]"><Save className="h-3.5 w-3.5" /> Save</button></div>
                </section>
                <section>
                  {Object.keys(layouts).length === 0 ? <div className="rounded-2xl border border-dashed border-border/65 p-8 text-center"><LayoutGrid className="mx-auto h-5 w-5 text-muted-foreground/40" /><div className="font-ui mt-3 text-[10px] font-medium text-foreground">No saved layouts yet</div><div className="font-ui mt-1 text-[8px] text-muted-foreground">Tune a workspace once, save it, and reuse the spatial arrangement later.</div></div> : <div className="grid gap-3 sm:grid-cols-2">{Object.entries(layouts).map(([savedName, state]) => <article key={savedName} className="group rounded-2xl border border-border/55 bg-white/[0.012] p-3"><ScenePreview workspace={state} /><div className="mt-3 flex items-center gap-2"><button onClick={() => { onApplyLayout(state); onClose(); }} className="font-ui min-w-0 flex-1 truncate text-left text-[10px] font-semibold text-foreground hover:text-amber-200">{savedName}</button><button onClick={() => handleDelete(savedName)} className="rounded-lg p-1.5 text-muted-foreground/50 opacity-0 transition-all hover:bg-red-500/[0.04] hover:text-red-300 group-hover:opacity-100" aria-label={`Delete ${savedName}`}><Trash2 className="h-3.5 w-3.5" /></button></div><div className="font-ui mt-1 text-[7px] text-muted-foreground">{getWorkspacePanes(state).length} pane workspace</div></article>)}</div>}
                </section>
              </div>
            )}
          </div>
        </main>
      </section>
    </div>
  );
}
