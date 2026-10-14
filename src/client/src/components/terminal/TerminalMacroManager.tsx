import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Copy, Play, Plus, Save, Trash2, Workflow, X } from "lucide-react";
import { TERMINAL_CAPABILITIES, isCapabilityVisible } from "@/lib/terminalCatalog";
import {
  createTerminalMacro, duplicateTerminalMacro, loadTerminalMacros, resolveTerminalMacro, saveCustomTerminalMacros,
  validateTerminalMacro, type ResolvedMacroStep, type TerminalMacro, type TerminalMacroStep,
} from "@/lib/terminalMacros";

interface Props {
  activeSymbol?: string;
  isInternal: boolean;
  onRunStep: (step: ResolvedMacroStep) => void;
  onClose: () => void;
}

function newStep(view = "market" as TerminalMacroStep["view"]): TerminalMacroStep {
  return { id: `step-${Date.now()}-${Math.random().toString(36).slice(2)}`, view, symbolMode: "active", openMode: "tab" };
}

export default function TerminalMacroManager({ activeSymbol, isInternal, onRunStep, onClose }: Props) {
  const [macros, setMacros] = useState<TerminalMacro[]>(() => loadTerminalMacros());
  const [selectedId, setSelectedId] = useState(macros[0]?.id ?? "");
  const [editing, setEditing] = useState<TerminalMacro | null>(null);
  const selected = macros.find((macro) => macro.id === selectedId) ?? macros[0];
  const capabilities = useMemo(() => TERMINAL_CAPABILITIES.filter((capability) => isCapabilityVisible(capability, isInternal)), [isInternal]);

  const persist = (next: TerminalMacro[]) => {
    setMacros(next);
    saveCustomTerminalMacros(next);
  };

  const run = (macro: TerminalMacro) => {
    for (const step of resolveTerminalMacro(macro, activeSymbol)) onRunStep(step);
    onClose();
  };

  const duplicate = (macro: TerminalMacro) => {
    const copy = duplicateTerminalMacro(macro);
    const next = [...macros, copy];
    persist(next);
    setSelectedId(copy.id);
    setEditing(copy);
  };

  const startNew = () => {
    const macro = createTerminalMacro({ name: "New Workflow", description: "", steps: [newStep()] });
    setEditing(macro);
    setSelectedId(macro.id);
  };

  const saveEdit = () => {
    if (!editing) return;
    const errors = validateTerminalMacro(editing);
    if (errors.length) return;
    const saved = { ...editing, updatedAt: Date.now(), builtIn: false };
    const exists = macros.some((macro) => macro.id === saved.id);
    const next = exists ? macros.map((macro) => macro.id === saved.id ? saved : macro) : [...macros, saved];
    persist(next);
    setSelectedId(saved.id);
    setEditing(null);
  };

  const remove = (macro: TerminalMacro) => {
    if (macro.builtIn) return;
    const next = macros.filter((item) => item.id !== macro.id);
    persist(next);
    setSelectedId(next[0]?.id ?? "");
    setEditing(null);
  };

  const moveStep = (index: number, direction: -1 | 1) => {
    if (!editing) return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= editing.steps.length) return;
    const steps = [...editing.steps];
    const [item] = steps.splice(index, 1);
    steps.splice(nextIndex, 0, item);
    setEditing({ ...editing, steps });
  };

  const updateStep = (index: number, patch: Partial<TerminalMacroStep>) => {
    if (!editing) return;
    setEditing({ ...editing, steps: editing.steps.map((step, stepIndex) => stepIndex === index ? { ...step, ...patch } : step) });
  };

  const validationErrors = editing ? validateTerminalMacro(editing) : [];

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-3" onMouseDown={onClose}>
      <section className="flex h-[min(760px,92vh)] w-full max-w-5xl overflow-hidden border border-border bg-[#080808] shadow-2xl" onMouseDown={(event) => event.stopPropagation()} aria-label="Terminal macro manager">
        <aside className="hidden w-64 shrink-0 border-r border-border md:flex md:flex-col">
          <header className="border-b border-border px-3 py-3"><div className="flex items-center gap-2 font-terminal text-[9px] font-bold tracking-widest text-foreground"><Workflow className="h-4 w-4 text-fuchsia-300" /> WORKFLOW MACROS</div><p className="mt-1 font-terminal text-[7px] leading-relaxed text-muted-foreground">Every step is visible, editable, and replayable.</p></header>
          <div className="min-h-0 flex-1 overflow-y-auto p-2 scrollbar-thin">{macros.map((macro) => <button key={macro.id} onClick={() => { setSelectedId(macro.id); setEditing(null); }} className={`mb-1 w-full border px-2 py-2 text-left ${selectedId === macro.id ? "border-fuchsia-400/50 bg-fuchsia-400/[0.06]" : "border-transparent hover:border-border hover:bg-white/[0.03]"}`}><div className="font-terminal text-[9px] text-foreground">{macro.name}</div><div className="mt-1 font-terminal text-[7px] text-muted-foreground">{macro.steps.length} STEPS · {macro.builtIn ? "BUILT IN" : "CUSTOM"}</div></button>)}</div>
          <button onClick={startNew} className="m-2 flex items-center justify-center gap-2 border border-border px-3 py-2 font-terminal text-[8px] text-muted-foreground hover:border-fuchsia-400/50 hover:text-foreground"><Plus className="h-3 w-3" /> NEW MACRO</button>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto scrollbar-thin">
          <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-[#080808] px-4 py-3"><div className="min-w-0 flex-1"><div className="font-terminal text-[10px] font-bold tracking-widest text-foreground">{editing ? "EDIT MACRO" : selected?.name ?? "MACROS"}</div>{!editing && selected && <div className="mt-1 font-terminal text-[8px] text-muted-foreground">{selected.description}</div>}</div><button onClick={onClose} className="border border-border p-1.5 text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button></header>

          {editing ? (
            <div className="space-y-4 p-4">
              <div className="grid gap-3 md:grid-cols-2"><label className="space-y-1"><span className="font-terminal text-[7px] tracking-widest text-muted-foreground">NAME</span><input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} className="w-full border border-border bg-black px-3 py-2 font-terminal text-[9px] text-foreground outline-none focus:border-fuchsia-400/50" /></label><label className="space-y-1"><span className="font-terminal text-[7px] tracking-widest text-muted-foreground">DESCRIPTION</span><input value={editing.description} onChange={(event) => setEditing({ ...editing, description: event.target.value })} className="w-full border border-border bg-black px-3 py-2 font-terminal text-[9px] text-foreground outline-none focus:border-fuchsia-400/50" /></label></div>
              <div><div className="mb-2 flex items-center justify-between"><span className="font-terminal text-[8px] font-bold tracking-widest text-foreground">VISIBLE STEPS</span><button onClick={() => setEditing({ ...editing, steps: [...editing.steps, newStep()] })} className="flex items-center gap-1 border border-border px-2 py-1 font-terminal text-[7px] text-muted-foreground hover:text-foreground"><Plus className="h-3 w-3" /> ADD STEP</button></div><div className="space-y-2">{editing.steps.map((step, index) => <div key={step.id} className="grid gap-2 border border-border bg-[#0b0b0b] p-2 lg:grid-cols-[30px_1fr_120px_130px_90px]"><div className="flex items-center justify-center font-terminal text-[8px] text-muted-foreground">{index + 1}</div><select value={step.view} onChange={(event) => updateStep(index, { view: event.target.value as TerminalMacroStep["view"] })} className="border border-border bg-black px-2 py-2 font-terminal text-[8px] text-foreground">{capabilities.map((capability) => <option key={capability.view} value={capability.view}>{capability.label}</option>)}</select><select value={step.symbolMode} onChange={(event) => updateStep(index, { symbolMode: event.target.value as TerminalMacroStep["symbolMode"] })} className="border border-border bg-black px-2 py-2 font-terminal text-[8px] text-foreground"><option value="active">ACTIVE SYMBOL</option><option value="fixed">FIXED SYMBOL</option><option value="none">NO SYMBOL</option></select><select value={step.openMode} onChange={(event) => updateStep(index, { openMode: event.target.value as TerminalMacroStep["openMode"] })} className="border border-border bg-black px-2 py-2 font-terminal text-[8px] text-foreground"><option value="tab">NEW TAB</option><option value="current">CURRENT</option><option value="split-right">SPLIT RIGHT</option><option value="split-below">SPLIT BELOW</option></select><div className="flex items-center justify-end gap-1"><button onClick={() => moveStep(index, -1)} className="border border-border p-1.5 text-muted-foreground hover:text-foreground"><ArrowUp className="h-3 w-3" /></button><button onClick={() => moveStep(index, 1)} className="border border-border p-1.5 text-muted-foreground hover:text-foreground"><ArrowDown className="h-3 w-3" /></button><button onClick={() => setEditing({ ...editing, steps: editing.steps.filter((_, stepIndex) => stepIndex !== index) })} className="border border-border p-1.5 text-muted-foreground hover:text-red-300"><Trash2 className="h-3 w-3" /></button></div>{step.symbolMode === "fixed" && <input value={step.fixedSymbol ?? ""} onChange={(event) => updateStep(index, { fixedSymbol: event.target.value.toUpperCase() })} placeholder="FIXED SYMBOL" className="lg:col-start-2 border border-border bg-black px-2 py-2 font-terminal text-[8px] text-amber-300" />}</div>)}</div></div>
              {validationErrors.length > 0 && <div className="border border-amber-500/30 bg-amber-500/[0.04] p-3">{validationErrors.map((error) => <div key={error} className="font-terminal text-[8px] text-amber-200">• {error}</div>)}</div>}
              <div className="flex justify-end gap-2"><button onClick={() => setEditing(null)} className="border border-border px-3 py-2 font-terminal text-[8px] text-muted-foreground hover:text-foreground">CANCEL</button><button disabled={validationErrors.length > 0} onClick={saveEdit} className="flex items-center gap-2 border border-fuchsia-400/50 bg-fuchsia-400/[0.06] px-3 py-2 font-terminal text-[8px] text-fuchsia-200 disabled:opacity-40"><Save className="h-3 w-3" /> SAVE MACRO</button></div>
            </div>
          ) : selected ? (
            <div className="space-y-4 p-4"><div className="flex flex-wrap gap-2"><button onClick={() => run(selected)} className="flex items-center gap-2 border border-amber-500/50 bg-amber-500/10 px-3 py-2 font-terminal text-[8px] font-bold text-amber-200"><Play className="h-3 w-3" /> RUN {selected.steps.length} STEPS</button><button onClick={() => duplicate(selected)} className="flex items-center gap-2 border border-border px-3 py-2 font-terminal text-[8px] text-muted-foreground hover:text-foreground"><Copy className="h-3 w-3" /> DUPLICATE & EDIT</button>{!selected.builtIn && <><button onClick={() => setEditing({ ...selected, steps: selected.steps.map((step) => ({ ...step })) })} className="border border-border px-3 py-2 font-terminal text-[8px] text-muted-foreground hover:text-foreground">EDIT</button><button onClick={() => remove(selected)} className="flex items-center gap-2 border border-border px-3 py-2 font-terminal text-[8px] text-muted-foreground hover:text-red-300"><Trash2 className="h-3 w-3" /> DELETE</button></>}</div><div className="border border-border"><div className="grid grid-cols-[40px_1fr_130px_120px] border-b border-border bg-black px-2 py-2 font-terminal text-[7px] tracking-widest text-muted-foreground"><span>#</span><span>ACTION</span><span>CONTEXT</span><span>OPEN</span></div>{resolveTerminalMacro(selected, activeSymbol).map((step) => <div key={step.id} className="grid grid-cols-[40px_1fr_130px_120px] border-b border-border/60 px-2 py-2.5 last:border-0"><span className="font-terminal text-[8px] text-muted-foreground">{step.index + 1}</span><span className="font-terminal text-[9px] text-foreground">{step.label}</span><span className="font-terminal text-[8px] text-cyan-300">{step.symbol ?? "GLOBAL"}</span><span className="font-terminal text-[8px] text-muted-foreground">{step.openMode.toUpperCase()}</span></div>)}</div><div className="font-terminal text-[8px] leading-relaxed text-muted-foreground">Macros never hide their sequence. Each step resolves to the same deterministic navigation/opening actions available manually.</div></div>
          ) : <div className="p-6 font-terminal text-[9px] text-muted-foreground">No macros available.</div>}
        </main>
      </section>
    </div>
  );
}
