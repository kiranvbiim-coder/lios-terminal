import { useEffect, useMemo, useState, type DragEvent } from "react";
import { Boxes, LayoutGrid, Plus, Trash2, X } from "lucide-react";
import { loadIntelligenceObjects, subscribeIntelligenceObjects, type IntelligenceObject } from "@/lib/terminalIntelligenceObjects";
import { readIntelligenceObjectDrag } from "@/lib/terminalObjectDnD";
import type { PaneId, PaneState, WorkspaceState } from "@/lib/terminalTypes";
import { getTerminalCapability } from "@/lib/terminalCatalog";

interface Props {
  workspace: WorkspaceState;
  onApplyWorkspace: (workspace: WorkspaceState, label?: string) => void;
  onClose: () => void;
}

interface Slot { objectId: string; pane: PaneState }

const PANE_IDS: PaneId[] = ["primary", "secondary", "tertiary", "quaternary"];

function workspaceFromSlots(slots: readonly Slot[]): WorkspaceState | null {
  if (!slots.length) return null;
  return {
    primary: slots[0].pane,
    secondary: slots[1]?.pane ?? null,
    tertiary: slots[2]?.pane ?? null,
    quaternary: slots[3]?.pane ?? null,
    focusedPane: "primary",
  };
}

export default function WorkspaceComposer({ workspace, onApplyWorkspace, onClose }: Props) {
  const [objects, setObjects] = useState<IntelligenceObject[]>(() => loadIntelligenceObjects());
  const [slots, setSlots] = useState<Slot[]>(() => {
    const panes = [workspace.primary, workspace.secondary, workspace.tertiary ?? null, workspace.quaternary ?? null].filter(Boolean) as PaneState[];
    return panes.map((pane, index) => ({ objectId: `workspace:${index}`, pane }));
  });
  const [query, setQuery] = useState("");
  useEffect(() => subscribeIntelligenceObjects(setObjects), []);

  const candidates = useMemo(() => objects.filter((object) => object.view && `${object.label} ${object.symbol ?? ""} ${object.kind} ${object.tags.join(" ")}`.toLowerCase().includes(query.toLowerCase())).slice(0, 100), [objects, query]);

  const addObject = (object: IntelligenceObject) => {
    if (!object.view) return;
    const candidate: Slot = { objectId: object.id, pane: { view: object.view, symbol: object.symbol ?? "" } };
    setSlots((current) => {
      const deduped = current.filter((slot) => slot.objectId !== object.id);
      return [...deduped, candidate].slice(-4);
    });
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
    <div className="fixed inset-0 z-[93] bg-black/80 p-3 backdrop-blur-[5px]" onMouseDown={onClose}>
      <section className="lios-v4-overlay mx-auto flex h-[min(820px,calc(100vh-24px))] w-full max-w-6xl flex-col overflow-hidden border" onMouseDown={(event) => event.stopPropagation()} aria-label="LiOS Workspace Composer">
        <header className="flex items-center gap-3 border-b border-border/70 px-4 py-3"><div className="grid h-9 w-9 place-items-center border border-[hsl(38,100%,50%)/30%] bg-[hsl(38,100%,50%)/7%]"><LayoutGrid className="h-4 w-4 text-[hsl(38,100%,58%)]" /></div><div className="min-w-0 flex-1"><div className="text-[11px] font-bold tracking-[.13em]">INTELLIGENCE WORKSPACE COMPOSER</div><div className="mt-1 text-[8px] text-muted-foreground">OBJECTS → PANE COMPOSITION → ANALYTICAL DESK</div></div><button onClick={apply} disabled={!slots.length} className="border border-[hsl(38,100%,50%)/30%] bg-[hsl(38,100%,50%)/6%] px-3 py-2 text-[8px] font-bold text-[hsl(38,100%,60%)] disabled:opacity-40">APPLY WORKSPACE</button><button onClick={onClose} className="p-1.5 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button></header>
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_330px]">
          <main className="min-h-0 overflow-y-auto p-4 scrollbar-thin">
            <div className="mb-3 text-[8px] text-muted-foreground">DROP INTELLIGENCE OBJECTS OR SELECT FROM THE LIBRARY. MAXIMUM FOUR LIVE PANES.</div>
            <div className="grid gap-3 md:grid-cols-2" onDragOver={(event) => event.preventDefault()} onDrop={drop}>
              {PANE_IDS.map((paneId, index) => {
                const slot = slots[index];
                return <section key={paneId} className={`min-h-44 border p-3 ${slot ? "border-[hsl(38,100%,50%)/28%] bg-[hsl(38,100%,50%)/3%]" : "border-dashed border-border/70 bg-black/15"}`}>
                  <div className="flex items-center justify-between"><span className="text-[7px] font-bold tracking-widest text-muted-foreground">{paneId.toUpperCase()}</span>{slot && <button onClick={() => setSlots((current) => current.filter((_item, itemIndex) => itemIndex !== index))} className="p-1 text-muted-foreground hover:text-red-300"><Trash2 className="h-3 w-3" /></button>}</div>
                  {slot ? <div className="mt-5"><div className="text-[8px] font-bold text-[hsl(38,100%,58%)]">{getTerminalCapability(slot.pane.view).shortLabel}</div><div className="mt-2 text-[11px] font-bold">{getTerminalCapability(slot.pane.view).label}</div><div className="mt-1 text-[8px] text-muted-foreground">{slot.pane.symbol || "GLOBAL CONTEXT"}</div><div className="mt-4 text-[7px] leading-relaxed text-muted-foreground">{getTerminalCapability(slot.pane.view).description}</div></div> : <div className="grid h-32 place-items-center text-center"><div><Plus className="mx-auto h-5 w-5 text-muted-foreground" /><div className="mt-2 text-[7px] text-muted-foreground">DROP OR ADD AN OBJECT</div></div></div>}
                </section>;
              })}
            </div>
          </main>
          <aside className="min-h-0 overflow-y-auto border-l border-border/60 bg-black/20 p-3 scrollbar-thin">
            <div className="flex items-center gap-2 border border-border/65 bg-black/25 px-2 py-2"><Boxes className="h-3 w-3 text-[hsl(38,100%,58%)]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="FILTER OBJECTS" className="w-full bg-transparent text-[8px] outline-none" /></div>
            <div className="mt-3 space-y-1.5">{candidates.map((object) => <button key={object.id} onClick={() => addObject(object)} className="w-full border border-border/60 bg-white/[.01] p-2.5 text-left hover:border-[hsl(38,100%,50%)/25%] hover:bg-white/[.02]"><div className="flex items-center justify-between"><span className="text-[6.5px] font-bold text-[hsl(38,100%,58%)]">{object.kind.toUpperCase()}</span><Plus className="h-3 w-3 text-muted-foreground" /></div><div className="mt-1 truncate text-[8px] font-bold">{object.label}</div><div className="mt-1 text-[6.5px] text-muted-foreground">{object.symbol ?? "GLOBAL"} · {getTerminalCapability(object.view!).shortLabel}</div></button>)}</div>
          </aside>
        </div>
      </section>
    </div>
  );
}
