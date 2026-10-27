import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { ArrowDown, ArrowUp, Boxes, LayoutGrid, Plus, Trash2 } from "lucide-react";
import { loadIntelligenceObjects, subscribeIntelligenceObjects, type IntelligenceObject } from "@/lib/terminalIntelligenceObjects";
import { readIntelligenceObjectDrag } from "@/lib/terminalObjectDnD";
import type { PaneId, PaneState, WorkspaceState } from "@/lib/terminalTypes";
import { getTerminalCapability } from "@/lib/terminalCatalog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { appendWorkspaceSlot, moveWorkspaceSlot, removeWorkspaceSlot, workspaceFromSlots, type WorkspaceSlot as Slot } from "@/lib/workspaceComposerModel";

interface Props {
  workspace: WorkspaceState;
  onApplyWorkspace: (workspace: WorkspaceState, label?: string) => boolean | void;
  onClose: () => void;
}


const PANE_IDS: PaneId[] = ["primary", "secondary", "tertiary", "quaternary"];


export default function WorkspaceComposer({ workspace, onApplyWorkspace, onClose }: Props) {
  const [objects, setObjects] = useState<IntelligenceObject[]>(() => loadIntelligenceObjects());
  const [slots, setSlots] = useState<Slot[]>(() => {
    const panes = [workspace.primary, workspace.secondary, workspace.tertiary ?? null, workspace.quaternary ?? null].filter(Boolean) as PaneState[];
    return panes.map((pane, index) => ({ objectId: `workspace:${index}`, pane }));
  });
  const [query, setQuery] = useState("");
  const [opener] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const [notice, setNotice] = useState("");
  const earlierButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const laterButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const focusAfterMove = useRef<{ target: number; direction: -1 | 1 } | null>(null);
  useEffect(() => subscribeIntelligenceObjects(setObjects), []);

  // The card is keyed by pane position. After swapping content, transfer focus
  // to an enabled control on the *moved object's* new position, not the old card.
  useEffect(() => {
    const moved = focusAfterMove.current;
    if (!moved) return;
    focusAfterMove.current = null;
    const targetButton = moved.direction === -1
      ? laterButtons.current[moved.target]
      : earlierButtons.current[moved.target];
    targetButton?.focus();
  }, [slots]);

  const candidates = useMemo(() => objects.filter((object) => object.view && `${object.label} ${object.symbol ?? ""} ${object.kind} ${object.tags.join(" ")}`.toLowerCase().includes(query.toLowerCase())).slice(0, 100), [objects, query]);

  const addObject = (object: IntelligenceObject) => {
    if (!object.view) return;
    const candidate: Slot = { objectId: object.id, pane: { view: object.view, symbol: object.symbol ?? "" } };
    if (slots.length >= PANE_IDS.length) { setNotice("All four panes are occupied. Remove one before adding another."); return; }
    if (slots.some(slot => slot.objectId === object.id)) { setNotice("This object is already added."); return; }
    setNotice("");
    setSlots(current => appendWorkspaceSlot(current, candidate));
  };

  const movePane = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    const slot = slots[index];
    if (!slot || target < 0 || target >= slots.length) return;
    focusAfterMove.current = { target, direction };
    setSlots(current => moveWorkspaceSlot(current, index, direction));
    setNotice(`${getTerminalCapability(slot.pane.view).label} moved to ${PANE_IDS[target]} pane. The original content and revision remain unchanged.`);
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
    if (onApplyWorkspace(next, "V5 Intelligence Composition") === false) {
      setNotice("Workspace not changed. Save or reset the unsaved Artifact before moving or replacing its pane.");
      return;
    }
    onClose();
  };

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="flex h-[min(90dvh,820px)] w-[calc(100vw-24px)] max-w-6xl flex-col gap-0 overflow-hidden border-border bg-background p-0"
        onCloseAutoFocus={event => { event.preventDefault(); if (opener?.isConnected) opener.focus(); }}>
        <header className="shrink-0 border-b border-border p-4 pr-12"><LayoutGrid className="mb-2 h-5 w-5 text-primary"/><DialogTitle>Compose workspace</DialogTitle><DialogDescription>Select up to four panes. Existing work is never silently replaced.</DialogDescription></header>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:grid lg:grid-cols-[minmax(0,1fr)_330px]">
          <main className="min-h-0 flex-1 overflow-y-auto p-4 scrollbar-thin">
            <div role="status" aria-live="polite" className="mb-3 font-ui text-sm text-muted-foreground">{notice || `${slots.length} of four panes. ${slots.length === PANE_IDS.length ? "Remove one to add another." : "Add an object from the library."} Use Earlier and Later to reorder without rebuilding a pane.`}</div>
            <div className="grid gap-3 md:grid-cols-2" onDragOver={(event) => event.preventDefault()} onDrop={drop}>
              {PANE_IDS.map((paneId, index) => {
                const slot = slots[index];
                return <section key={paneId} className={`min-h-44 border p-3 ${slot ? "border-[hsl(38,100%,50%)/28%] bg-[hsl(38,100%,50%)/3%]" : "border-dashed border-border/70 bg-black/15"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-ui text-sm font-semibold capitalize text-muted-foreground">{paneId} pane</span>
                    {slot && <div role="group" aria-label={`Arrange ${getTerminalCapability(slot.pane.view).label} pane`} className="flex flex-wrap items-center gap-1">
                      <button type="button" disabled={index === 0}
                        ref={node => { earlierButtons.current[index] = node; }}
                        aria-label={`Move ${getTerminalCapability(slot.pane.view).label} earlier from ${paneId} pane`}
                        onClick={() => movePane(index, -1)}
                        className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-border/60 px-2 text-xs text-foreground hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-40">
                        <ArrowUp aria-hidden="true" className="h-4 w-4" /> Earlier
                      </button>
                      <button type="button" disabled={index >= slots.length - 1}
                        ref={node => { laterButtons.current[index] = node; }}
                        aria-label={`Move ${getTerminalCapability(slot.pane.view).label} later from ${paneId} pane`}
                        onClick={() => movePane(index, 1)}
                        className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-border/60 px-2 text-xs text-foreground hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-40">
                        <ArrowDown aria-hidden="true" className="h-4 w-4" /> Later
                      </button>
                      <button type="button" aria-label={`Remove ${getTerminalCapability(slot.pane.view).label} from ${paneId} pane`}
                        onClick={() => { setSlots(current => removeWorkspaceSlot(current, index)); setNotice(""); }}
                        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-border/60 text-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                        <Trash2 aria-hidden="true" className="h-4 w-4" />
                      </button>
                    </div>}
                  </div>
                  {slot ? <div className="mt-3"><p className="font-ui text-xs text-primary">{getTerminalCapability(slot.pane.view).shortLabel}</p><h3 className="mt-2 font-ui text-base font-semibold">{getTerminalCapability(slot.pane.view).label}</h3><p className="mt-1 font-ui text-sm text-muted-foreground">{slot.pane.symbol || "Global context"}</p><p className="mt-3 font-ui text-sm leading-6 text-muted-foreground">{getTerminalCapability(slot.pane.view).description}</p></div> : <div className="flex min-h-28 items-center justify-center gap-2 font-ui text-sm text-muted-foreground"><Plus className="h-5 w-5"/>Choose an object from the library</div>}
                </section>;
              })}
            </div>
          </main>
          <aside className="min-h-44 overflow-y-auto border-t border-border bg-black/20 p-3 scrollbar-thin lg:border-l lg:border-t-0">
            <label className="flex min-h-11 items-center gap-2 rounded border border-border px-3"><Boxes className="h-4 w-4 text-primary"/><span className="sr-only">Search intelligence objects</span><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Search objects…" className="min-w-0 flex-1 bg-transparent font-ui text-sm outline-none"/></label>
            <div className="mt-3 space-y-2">{candidates.length ? candidates.map(object => {
              const selected = slots.some(slot => slot.objectId === object.id);
              return <button key={object.id} type="button" disabled={selected || slots.length >= PANE_IDS.length} onClick={() => addObject(object)} aria-label={`${selected ? "Already added" : "Add"} ${object.label}`} className="min-h-12 w-full rounded border border-border p-3 text-left font-ui text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"><span className="block text-xs text-primary">{object.kind}</span><span className="block break-words">{object.label}</span><span className="block text-xs text-muted-foreground">{object.symbol ?? "Global"} · {getTerminalCapability(object.view!).shortLabel}</span></button>;
            }) : <p role="status" className="p-3 font-ui text-sm text-muted-foreground">No matching objects.</p>}</div>
          </aside>
        </div>
        <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border p-3"><button type="button" onClick={onClose} className="min-h-11 rounded border border-border px-4 py-2 font-ui text-sm">Cancel</button><button type="button" onClick={apply} disabled={!slots.length} className="min-h-11 rounded border border-primary px-4 py-2 font-ui text-sm text-primary disabled:opacity-40">Apply workspace</button></footer>
      </DialogContent>
    </Dialog>
  );
}
