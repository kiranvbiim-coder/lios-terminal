import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Copy, Play, Plus, Save, Trash2, Workflow } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TERMINAL_CAPABILITIES, getTerminalCapability, isCapabilityVisible } from "@/lib/terminalCatalog";
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

const controlClass = "min-h-11 rounded-md border border-border/70 px-3 py-2 font-ui text-sm font-medium text-muted-foreground hover:border-primary/40 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40";
const primaryClass = "min-h-11 rounded-md border border-primary/50 bg-primary/10 px-4 py-2 font-ui text-sm font-semibold text-primary hover:bg-primary/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40";
const fieldClass = "min-h-11 w-full min-w-0 rounded-md border border-border/70 bg-[#0b0b0b] px-3 py-2 font-ui text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary";

function newStep(view: TerminalMacroStep["view"] = "market"): TerminalMacroStep {
  return { id: "step-" + Date.now() + "-" + Math.random().toString(36).slice(2), view, symbolMode: "active", openMode: "tab" };
}

export default function TerminalMacroManager({ activeSymbol, isInternal, onRunStep, onClose }: Props) {
  const [macros, setMacros] = useState<TerminalMacro[]>(() => loadTerminalMacros());
  const [selectedId, setSelectedId] = useState(macros[0]?.id ?? "");
  const [editing, setEditing] = useState<TerminalMacro | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [closeAfterDiscard, setCloseAfterDiscard] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmRun, setConfirmRun] = useState(false);
  const [notice, setNotice] = useState("");

  const selected = macros.find((macro) => macro.id === selectedId) ?? macros[0];
  const capabilities = useMemo(
    () => TERMINAL_CAPABILITIES.filter((capability) => isCapabilityVisible(capability, isInternal)),
    [isInternal],
  );
  const steps = selected ? resolveTerminalMacro(selected, activeSymbol) : [];
  const hiddenSteps = steps.filter((step) => !isCapabilityVisible(getTerminalCapability(step.view), isInternal));
  const canRun = Boolean(selected && steps.length && !validateTerminalMacro(selected).length && !hiddenSteps.length);
  const validationErrors = editing ? validateTerminalMacro(editing) : [];
  const editingHiddenSteps = editing?.steps.filter((step) => !isCapabilityVisible(getTerminalCapability(step.view), isInternal)) ?? [];

  const requestClose = () => {
    if (editing) {
      setCloseAfterDiscard(true);
      setConfirmDiscard(true);
    } else {
      onClose();
    }
  };

  const persist = (next: TerminalMacro[]): boolean => {
    try {
      // The local device may deny storage; do not show a successful save if so.
      saveCustomTerminalMacros(next);
      setMacros(next);
      return true;
    } catch {
      setNotice("Could not save workflow changes on this device. Check local storage availability and retry.");
      return false;
    }
  };

  const select = (id: string) => {
    if (editing) return;
    setSelectedId(id);
    setConfirmDelete(false);
    setConfirmRun(false);
    setNotice("");
  };

  const startNew = () => {
    if (editing) return;
    setEditing(createTerminalMacro({
      name: "New Workflow",
      description: "",
      steps: [newStep(capabilities[0]?.view ?? "market")],
    }));
    setNotice("");
    setConfirmRun(false);
    setConfirmDelete(false);
  };

  const duplicate = (macro: TerminalMacro) => {
    if (editing) return;
    // No premature persistence: if the user cancels, no duplicate is stored.
    setEditing(duplicateTerminalMacro(macro));
    setConfirmRun(false);
    setConfirmDelete(false);
    setNotice("");
  };

  const saveEdit = () => {
    if (!editing || validationErrors.length || editingHiddenSteps.length) return;
    const saved: TerminalMacro = { ...editing, updatedAt: Date.now(), builtIn: false };
    const exists = macros.some((macro) => macro.id === saved.id && !macro.builtIn);
    if (!exists && macros.filter((macro) => !macro.builtIn).length >= 50) {
      setNotice("This device has reached the 50 custom workflow limit. Delete an unused custom workflow first.");
      return;
    }
    const next = exists ? macros.map((macro) => macro.id === saved.id ? saved : macro) : [...macros, saved];
    if (!persist(next)) return;
    setSelectedId(saved.id);
    setEditing(null);
    setConfirmDiscard(false);
    setNotice("Workflow saved on this device.");
  };

  const remove = (macro: TerminalMacro) => {
    if (macro.builtIn || !confirmDelete) return;
    const next = macros.filter((item) => item.id !== macro.id);
    if (!persist(next)) return;
    setSelectedId(next[0]?.id ?? "");
    setConfirmDelete(false);
    setNotice("Custom workflow deleted. Built-in workflows are unchanged.");
  };

  const moveStep = (index: number, direction: -1 | 1) => {
    if (!editing) return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= editing.steps.length) return;
    const next = [...editing.steps];
    const [item] = next.splice(index, 1);
    next.splice(nextIndex, 0, item);
    setEditing({ ...editing, steps: next });
  };

  const updateStep = (index: number, patch: Partial<TerminalMacroStep>) => {
    if (!editing) return;
    setEditing({ ...editing, steps: editing.steps.map((step, at) => at === index ? { ...step, ...patch } : step) });
  };

  const run = () => {
    if (!selected || !confirmRun || !canRun) return;
    setConfirmRun(false);
    try {
      // The professional terminal owns the original action engine. Keep order
      // and pass through the exact validated/visible resolved steps.
      for (const step of steps) onRunStep(step);
      onClose();
    } catch {
      setNotice("Workflow interrupted. Some earlier steps may already have opened; inspect your workspace before retrying.");
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) requestClose(); }}>
      <DialogContent
        className="lios-v4-overlay flex h-[min(90dvh,820px)] w-[calc(100vw-24px)] max-w-5xl flex-col gap-0 overflow-hidden rounded-xl border-border bg-[#080808] p-0 text-foreground shadow-2xl"
        onEscapeKeyDown={(event) => { if (editing) { event.preventDefault(); requestClose(); } }}
        onPointerDownOutside={(event) => { if (editing) { event.preventDefault(); requestClose(); } }}
      >
        <DialogHeader className="shrink-0 border-b border-border/70 px-4 py-4 pr-14 text-left sm:px-5">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-primary/30 bg-primary/[0.06] text-primary">
              <Workflow className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="font-ui text-xl font-semibold tracking-tight">Workflow macros</DialogTitle>
              <DialogDescription className="mt-1 font-ui text-sm leading-6 text-muted-foreground">
                Inspect each action before running it. Create reusable sequences with the existing professional Workbench tools.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
          <aside className="flex shrink-0 flex-col border-b border-border/70 p-3 md:w-64 md:border-b-0 md:border-r md:p-0" aria-label="Workflow library">
            <div className="flex items-center gap-2 md:hidden">
              <label className="min-w-0 flex-1 font-ui text-xs font-medium text-muted-foreground">
                Select workflow
                <select value={selected?.id ?? ""} onChange={(event) => select(event.target.value)} disabled={Boolean(editing)}
                  className={fieldClass + " mt-1"} aria-label="Select workflow">
                  {macros.map((macro) => <option value={macro.id} key={macro.id}>{macro.name}</option>)}
                </select>
              </label>
              <button type="button" onClick={startNew} disabled={Boolean(editing)} className={controlClass + " mt-4"}>
                <Plus className="mr-1 inline h-4 w-4" aria-hidden="true" /> New
              </button>
            </div>
            <p className="hidden border-b border-border/70 px-4 py-3 font-ui text-sm font-semibold md:block">Available workflows</p>
            <div className="hidden min-h-0 flex-1 overflow-y-auto p-2 scrollbar-thin md:block">
              {macros.map((macro) => (
                <button key={macro.id} type="button" onClick={() => select(macro.id)}
                  disabled={Boolean(editing)} aria-pressed={selected?.id === macro.id}
                  className={"mb-1 w-full rounded-md border p-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-60 " +
                    (selected?.id === macro.id ? "border-primary/50 bg-primary/[0.06]" : "border-transparent hover:border-border hover:bg-white/[0.025]")}>
                  <span className="block font-ui text-sm font-semibold text-foreground">{macro.name}</span>
                  <span className="mt-1 block font-ui text-xs text-muted-foreground">
                    {macro.steps.length} steps · {macro.builtIn ? "Built-in" : "Custom"}
                  </span>
                </button>
              ))}
            </div>
            <button type="button" onClick={startNew} disabled={Boolean(editing)} className={controlClass + " m-3 hidden md:inline-flex md:items-center md:justify-center"}>
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" /> New workflow
            </button>
          </aside>

          <main className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain p-3 scrollbar-thin sm:p-5">
            {editing ? (
              <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); saveEdit(); }}>
                <h3 className="font-ui text-lg font-semibold">{macros.some((macro) => macro.id === editing.id) ? "Edit custom workflow" : "Create workflow"}</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block font-ui text-sm font-medium">
                    Workflow name
                    <input className={fieldClass + " mt-1"} value={editing.name} maxLength={80}
                      onChange={(event) => setEditing({ ...editing, name: event.target.value })} />
                  </label>
                  <label className="block font-ui text-sm font-medium">
                    Description
                    <input className={fieldClass + " mt-1"} value={editing.description} maxLength={240}
                      onChange={(event) => setEditing({ ...editing, description: event.target.value })} />
                  </label>
                </div>
                <section aria-labelledby="macro-steps-heading">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h4 id="macro-steps-heading" className="font-ui text-base font-semibold">Visible steps</h4>
                      <p className="mt-1 font-ui text-xs text-muted-foreground">Up to 24 steps, executed in the order shown.</p>
                    </div>
                    <button type="button" disabled={editing.steps.length >= 24}
                      onClick={() => setEditing({ ...editing, steps: [...editing.steps, newStep(capabilities[0]?.view ?? "market")] })}
                      className={controlClass}><Plus className="mr-1 inline h-4 w-4" aria-hidden="true" /> Add step</button>
                  </div>
                  <ol className="space-y-3">
                    {editing.steps.map((step, index) => {
                      const visible = isCapabilityVisible(getTerminalCapability(step.view), isInternal);
                      return (
                        <li key={step.id} className="rounded-lg border border-border/70 bg-black/20 p-3">
                          <div className="mb-3 flex items-center justify-between gap-2">
                            <span className="font-ui text-sm font-semibold">Step {index + 1}</span>
                            <div className="flex items-center gap-1">
                              <button type="button" onClick={() => moveStep(index, -1)} disabled={index === 0}
                                aria-label={"Move step " + (index + 1) + " earlier"}
                                className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md border border-border/70 text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-30">
                                <ArrowUp className="h-4 w-4" aria-hidden="true" />
                              </button>
                              <button type="button" onClick={() => moveStep(index, 1)} disabled={index === editing.steps.length - 1}
                                aria-label={"Move step " + (index + 1) + " later"}
                                className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md border border-border/70 text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-30">
                                <ArrowDown className="h-4 w-4" aria-hidden="true" />
                              </button>
                              <button type="button" onClick={() => setEditing({ ...editing, steps: editing.steps.filter((_, at) => at !== index) })}
                                aria-label={"Remove step " + (index + 1)}
                                className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md border border-rose-400/30 text-rose-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-400">
                                <Trash2 className="h-4 w-4" aria-hidden="true" />
                              </button>
                            </div>
                          </div>
                          {!visible && <p role="alert" className="mb-2 font-ui text-sm text-amber-200">This tool is not available to this account. Choose an available tool before saving.</p>}
                          <div className="grid gap-3 sm:grid-cols-3">
                            <label className="font-ui text-sm font-medium">
                              Tool
                              <select className={fieldClass + " mt-1"} value={step.view}
                                onChange={(event) => updateStep(index, { view: event.target.value as TerminalMacroStep["view"] })}>
                                {!visible && <option value={step.view} disabled>{getTerminalCapability(step.view).label} · unavailable</option>}
                                {capabilities.map((capability) => <option key={capability.view} value={capability.view}>{capability.label}</option>)}
                              </select>
                            </label>
                            <label className="font-ui text-sm font-medium">
                              Symbol context
                              <select className={fieldClass + " mt-1"} value={step.symbolMode}
                                onChange={(event) => updateStep(index, { symbolMode: event.target.value as TerminalMacroStep["symbolMode"] })}>
                                <option value="active">Current symbol</option>
                                <option value="fixed">Fixed symbol</option>
                                <option value="none">No symbol</option>
                              </select>
                            </label>
                            <label className="font-ui text-sm font-medium">
                              Open as
                              <select className={fieldClass + " mt-1"} value={step.openMode}
                                onChange={(event) => updateStep(index, { openMode: event.target.value as TerminalMacroStep["openMode"] })}>
                                <option value="tab">New tab</option>
                                <option value="current">Current pane</option>
                                <option value="split-right">Split right</option>
                                <option value="split-below">Split below</option>
                              </select>
                            </label>
                          </div>
                          {step.symbolMode === "fixed" && (
                            <label className="mt-3 block font-ui text-sm font-medium">
                              Fixed symbol
                              <input className={fieldClass + " mt-1"} value={step.fixedSymbol ?? ""} maxLength={32}
                                onChange={(event) => updateStep(index, { fixedSymbol: event.target.value.toUpperCase() })}
                                placeholder="e.g. AAPL" />
                            </label>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </section>
                {(validationErrors.length > 0 || editingHiddenSteps.length > 0) && (
                  <div role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/[0.04] p-3 font-ui text-sm text-amber-200">
                    {validationErrors.map((error, index) => <p key={index}>{error}</p>)}
                    {editingHiddenSteps.length > 0 && <p>Remove or replace {editingHiddenSteps.length} unavailable steps before saving.</p>}
                  </div>
                )}
                <div className="flex flex-wrap justify-end gap-2">
                  <button type="button" className={controlClass} onClick={() => { setCloseAfterDiscard(false); setConfirmDiscard(true); }}>Cancel</button>
                  <button type="submit" disabled={validationErrors.length > 0 || editingHiddenSteps.length > 0}
                    className={primaryClass}><Save className="mr-2 inline h-4 w-4" aria-hidden="true" /> Save workflow</button>
                </div>
              </form>
            ) : selected ? (
              <div className="space-y-4">
                <div>
                  <h3 className="font-ui text-lg font-semibold">{selected.name}</h3>
                  <p className="mt-1 font-ui text-sm leading-6 text-muted-foreground">{selected.description}</p>
                  <p className="mt-1 font-ui text-xs text-muted-foreground">
                    {selected.builtIn ? "Built-in workflow · duplicate to customize" : "Custom workflow stored locally"} · {steps.length} steps
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setConfirmRun(true)} disabled={!canRun}
                    className={primaryClass}><Play className="mr-2 inline h-4 w-4" aria-hidden="true" /> Review and run</button>
                  <button type="button" onClick={() => duplicate(selected)} className={controlClass}>
                    <Copy className="mr-2 inline h-4 w-4" aria-hidden="true" /> Duplicate and edit
                  </button>
                  {!selected.builtIn && (
                    <>
                      <button type="button" onClick={() => { setEditing({ ...selected, steps: selected.steps.map((step) => ({ ...step })) }); setConfirmDelete(false); }}
                        className={controlClass}>Edit</button>
                      <button type="button" onClick={() => { setConfirmDelete(true); setConfirmRun(false); }} className={controlClass + " hover:text-rose-300"}>
                        <Trash2 className="mr-2 inline h-4 w-4" aria-hidden="true" /> Delete
                      </button>
                    </>
                  )}
                </div>
                {confirmRun && (
                  <div data-testid="macro-run-confirm" className="rounded-lg border border-primary/40 bg-primary/[0.05] p-3">
                    <p className="font-ui text-sm font-medium">Run all {steps.length} visible steps in the order shown?</p>
                    <p className="mt-1 font-ui text-xs text-muted-foreground">The active Workbench will change as each step opens.</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" onClick={() => setConfirmRun(false)} className={controlClass}>Cancel</button>
                      <button type="button" onClick={run} disabled={!canRun} className={primaryClass}>Run {steps.length} steps</button>
                    </div>
                  </div>
                )}
                {confirmDelete && !selected.builtIn && (
                  <div data-testid="macro-delete-confirm" className="rounded-lg border border-rose-400/30 bg-rose-400/[0.035] p-3">
                    <p className="font-ui text-sm">Delete the custom workflow “{selected.name}” from this device?</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" onClick={() => setConfirmDelete(false)} className={controlClass}>Cancel</button>
                      <button type="button" onClick={() => remove(selected)} className={controlClass + " border-rose-400/40 text-rose-200"}>
                        Delete workflow
                      </button>
                    </div>
                  </div>
                )}
                {hiddenSteps.length > 0 && (
                  <p role="alert" className="rounded-lg border border-amber-500/30 p-3 font-ui text-sm text-amber-200">
                    This workflow contains {hiddenSteps.length} tools not available to this account. Execution is disabled; no steps will be silently skipped.
                  </p>
                )}
                {!steps.length && <p role="status" className="font-ui text-sm text-muted-foreground">No steps in this workflow.</p>}
                <section aria-label="Workflow steps">
                  <h4 className="mb-2 font-ui text-sm font-semibold">Execution order</h4>
                  <ol className="space-y-2">
                    {steps.map((step) => (
                      <li key={step.id} className="rounded-lg border border-border/70 bg-black/20 p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-ui text-xs text-muted-foreground">{step.index + 1}.</span>
                          <span className="min-w-0 flex-1 font-ui text-sm font-semibold">{step.label}</span>
                          <span className="font-ui text-xs text-cyan-300">{step.symbol ?? "Global"}</span>
                        </div>
                        <p className="mt-1 font-ui text-xs text-muted-foreground">Opens in: {step.openMode.replaceAll("-", " ")}</p>
                      </li>
                    ))}
                  </ol>
                  <p className="mt-3 font-ui text-xs leading-5 text-muted-foreground">
                    Each step opens the same deterministic Workbench action available manually. Review the full list before running.
                  </p>
                </section>
              </div>
            ) : <p className="font-ui text-sm text-muted-foreground">No workflows available. Create a workflow to get started.</p>}
          </main>
        </div>
        {confirmDiscard && editing && (
          <div role="alert" data-testid="macro-discard-confirm" className="shrink-0 border-t border-rose-400/30 bg-rose-400/[0.06] p-3 sm:px-5">
            <p className="font-ui text-sm">Discard this unsaved workflow draft? Saved workflows will not change.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className={controlClass} onClick={() => { setConfirmDiscard(false); setCloseAfterDiscard(false); }}>Continue editing</button>
              <button type="button" className={controlClass + " border-rose-400/40 text-rose-200"}
                onClick={() => { setEditing(null); setConfirmDiscard(false); setCloseAfterDiscard(false); setNotice("Unsaved changes discarded."); if (closeAfterDiscard) onClose(); }}>
                Discard changes
              </button>
            </div>
          </div>
        )}
        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border/70 p-3 sm:px-5">
          <p role="status" aria-live="polite" className="min-w-0 flex-1 font-ui text-xs leading-5 text-muted-foreground">{notice || "Workflow changes are local to this device."}</p>
          <button type="button" onClick={requestClose} className={controlClass}>{editing ? "Close" : "Done"}</button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
