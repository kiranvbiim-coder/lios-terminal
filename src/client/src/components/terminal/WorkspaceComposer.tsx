import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Boxes, LayoutGrid, Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { loadIntelligenceObjects, subscribeIntelligenceObjects, type IntelligenceObject } from "@/lib/terminalIntelligenceObjects";
import { readIntelligenceObjectDrag } from "@/lib/terminalObjectDnD";
import type { PaneId, PaneState, WorkspaceState } from "@/lib/terminalTypes";
import { appendWorkspaceSlot, removeWorkspaceSlot, workspaceFromSlots, type WorkspaceSlot } from "@/lib/workspaceComposerModel";
import { getTerminalCapability } from "@/lib/terminalCatalog";

interface Props {
  workspace: WorkspaceState;
  onApplyWorkspace: (workspace: WorkspaceState, label?: string) => void;
  onClose: () => void;
}

const PANE_IDS: PaneId[] = ["primary", "secondary", "tertiary", "quaternary"];

export default function WorkspaceComposer({ workspace, onApplyWorkspace, onClose }: Props) {
  const [objects, setObjects] = useState<IntelligenceObject[]>(() => loadIntelligenceObjects());
  const [slots, setSlots] = useState<WorkspaceSlot[]>(() => {
    const panes = [workspace.primary, workspace.secondary, workspace.tertiary ?? null, workspace.quaternary ?? null].filter(Boolean) as PaneState[];
    return panes.map((pane, index) => ({ objectId: `workspace:${index}`, pane }));
  });
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => subscribeIntelligenceObjects(setObjects), []);

  const candidates = useMemo(() => objects.filter((object) => object.view && `${object.label} ${object.symbol ?? ""} ${object.kind} ${object.tags.join(" ")}`.toLowerCase().includes(query.toLowerCase())).slice(0, 100), [objects, query]);

  const addObject = (object: IntelligenceObject) => {
    if (!object.view) return;
    if (slots.some((slot) => slot.objectId === object.id)) {
      setNotice("This object is already in the workspace.");
      return;
    }
    if (slots.length >= PANE_IDS.length) {
      setNotice("All four panes are occupied. Remove one before adding another.");
      return;
    }
    const candidate: WorkspaceSlot = { objectId: object.id, pane: { view: object.view, symbol: object.symbol ?? "" } };
    // Do not silently evict a pane on a fifth selection or drop.
    setSlots((current) => appendWorkspaceSlot(current, candidate));
    setNotice("Added an object to the workspace.");
  };

  const drop = (event: DragEvent) => {
    event.preventDefault();
    const payload = readIntelligenceObjectDrag(event.dataTransfer);
    if (!payload) return;
    const object = objects.find((item) => item.id === payload.objectId);
    if (object) addObject(object);
  };

  const apply = () => {
    const next = workspaceFromSlots(slots);
    if (!next) return;
    onApplyWorkspace(next, "V5 Intelligence Composition");
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="lios-v4-overlay flex h-[min(90dvh,820px)] w-[calc(100vw-24px)] max-w-6xl flex-col gap-0 overflow-hidden rounded-xl border-border bg-[#090909] p-0 text-foreground shadow-2xl"
        onOpenAutoFocus={(event) => { if (searchRef.current) { event.preventDefault(); searchRef.current.focus(); } }}
      >
        <DialogHeader className="shrink-0 border-b border-border/70 px-4 py-4 pr-14 text-left sm:px-5">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-primary/25 bg-primary/[0.06]">
              <LayoutGrid className="h-5 w-5 text-primary" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="font-ui text-lg font-semibold tracking-tight sm:text-xl">Compose workspace</DialogTitle>
              <DialogDescription className="mt-1 font-ui text-sm leading-5 text-muted-foreground">
                Select up to four analytical panes. Drag an object here or choose it from the library.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row">
          <section className="min-h-0 min-w-0 flex-[3] overflow-y-auto overscroll-contain p-3 scrollbar-thin sm:p-5"
            aria-labelledby="lios-composer-layout-heading" onDragOver={(event) => event.preventDefault()} onDrop={drop}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 id="lios-composer-layout-heading" className="font-ui text-sm font-semibold">Workspace layout</h3>
              <span className="font-ui text-xs text-muted-foreground">{slots.length} of {PANE_IDS.length} panes</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {PANE_IDS.map((paneId, index) => {
                const slot = slots[index];
                const capability = slot ? getTerminalCapability(slot.pane.view) : null;
                return (
                  <section key={paneId} aria-label={paneId + " workspace pane"}
                    className={`min-h-44 rounded-lg border p-3 sm:p-4 ${slot ? "border-primary/30 bg-primary/[0.035]" : "border-dashed border-border/70 bg-black/15"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-ui text-xs font-semibold capitalize text-muted-foreground">{paneId} pane</span>
                      {slot && (
                        <button type="button" onClick={() => {
                            setSlots((current) => removeWorkspaceSlot(current, index));
                            setNotice("Removed a pane from the workspace.");
                          }}
                          aria-label={`Remove ${capability?.label ?? paneId} from ${paneId} pane`}
                          className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md text-muted-foreground hover:bg-rose-400/[0.06] hover:text-rose-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                    {slot && capability ? (
                      <div className="mt-3">
                        <span className="font-ui text-xs font-medium text-primary">{capability.shortLabel}</span>
                        <h4 className="mt-1 font-ui text-base font-semibold">{capability.label}</h4>
                        <p className="mt-1 font-ui text-xs text-muted-foreground">{slot.pane.symbol || "Global context"}</p>
                        <p className="mt-3 font-ui text-sm leading-5 text-muted-foreground">{capability.description}</p>
                      </div>
                    ) : (
                      <div className="flex min-h-28 flex-col items-center justify-center gap-2 text-center">
                        <Plus className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                        <p className="font-ui text-sm text-muted-foreground">Choose an object from the library</p>
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          </section>
          <aside className="flex min-h-[175px] max-h-[38%] min-w-0 flex-col border-t border-border/70 bg-black/20 p-3 lg:max-h-none lg:min-h-0 lg:w-[330px] lg:flex-none lg:border-l lg:border-t-0"
            aria-labelledby="lios-composer-library-heading">
            <h3 id="lios-composer-library-heading" className="mb-2 font-ui text-sm font-semibold">Object library</h3>
            <label className="flex min-h-11 items-center gap-2 rounded-lg border border-border/70 bg-[#101010] px-3 focus-within:border-primary/50">
              <Boxes className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <span className="sr-only">Search intelligence objects</span>
              <input ref={searchRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)}
                placeholder="Search objects…" className="min-w-0 flex-1 bg-transparent py-2 font-ui text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
                aria-controls="lios-composer-object-list" />
            </label>
            {slots.length === PANE_IDS.length && (
              <p className="mt-2 font-ui text-xs leading-5 text-amber-200">All four panes are filled. Remove one to add another object.</p>
            )}
            <div id="lios-composer-object-list" className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-thin">
              {candidates.length ? (
                <ul className="space-y-2">
                  {candidates.map((object) => {
                    const selected = slots.some((slot) => slot.objectId === object.id);
                    return (
                      <li key={object.id}>
                        <button type="button" onClick={() => addObject(object)}
                          disabled={selected || slots.length >= PANE_IDS.length}
                          aria-label={selected ? object.label + " already added" : "Add " + object.label + " to workspace"}
                          className="flex min-h-12 w-full items-start justify-between gap-2 rounded-lg border border-border/70 bg-white/[0.015] p-3 text-left hover:border-primary/40 hover:bg-white/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50">
                          <span className="min-w-0">
                            <span className="block font-ui text-xs text-primary">{object.kind.replaceAll("_", " ")}</span>
                            <span className="mt-1 block break-words font-ui text-sm font-medium">{object.label}</span>
                            <span className="mt-1 block font-ui text-xs text-muted-foreground">{object.symbol ?? "Global"} · {getTerminalCapability(object.view!).shortLabel}</span>
                          </span>
                          <span className="shrink-0 pt-1 font-ui text-xs text-muted-foreground">{selected ? "Added" : <Plus className="h-4 w-4" aria-hidden="true" />}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="p-3 font-ui text-sm text-muted-foreground">No matching objects. Try another search.</p>}
            </div>
          </aside>
        </div>
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border/70 p-3 sm:px-5">
          <p role="status" aria-live="polite" className="min-w-0 flex-1 font-ui text-xs leading-5 text-muted-foreground">
            {notice || slots.length + " of " + PANE_IDS.length + " panes ready."}
          </p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="min-h-11 rounded-md border border-border px-4 py-2 font-ui text-sm text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">Cancel</button>
            <button type="button" onClick={apply} disabled={!slots.length} className="min-h-11 rounded-md border border-primary/50 bg-primary/10 px-4 py-2 font-ui text-sm font-semibold text-primary hover:bg-primary/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40">Apply workspace</button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
