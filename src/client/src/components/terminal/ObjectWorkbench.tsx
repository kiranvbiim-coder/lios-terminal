import { useEffect, useMemo, useState } from "react";
import { Boxes, Grip, Search, X } from "lucide-react";
import {
  loadIntelligenceObjects,
  queryIntelligenceObjects,
  subscribeIntelligenceObjects,
  type IntelligenceObject,
} from "@/lib/terminalIntelligenceObjects";
import { actionsForIntelligenceObject, requestIntelligenceObjectAction } from "@/lib/terminalObjectActions";
import { writeIntelligenceObjectDrag } from "@/lib/terminalObjectDnD";

interface Props { onClose: () => void }

function valueLabel(object: IntelligenceObject): string {
  if (!object.value) return "";
  return object.value.display ?? String(object.value.raw ?? "—");
}

export default function ObjectWorkbench({ onClose }: Props) {
  const [objects, setObjects] = useState<IntelligenceObject[]>(() => loadIntelligenceObjects());
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<IntelligenceObject["kind"] | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => subscribeIntelligenceObjects(setObjects), []);

  const filtered = useMemo(() => queryIntelligenceObjects(objects, {
    kind: kind === "all" ? undefined : kind,
    text: query || undefined,
  }).slice(0, 240), [kind, objects, query]);
  const selected = objects.find((object) => object.id === selectedId) ?? null;
  const kinds = useMemo(() => Array.from(new Set(objects.map((object) => object.kind))).sort(), [objects]);

  return (
    <div className="fixed inset-0 z-[91] bg-black/78 p-3 backdrop-blur-[5px]" onMouseDown={onClose}>
      <section className="lios-v4-overlay mx-auto flex h-[min(840px,calc(100vh-24px))] w-full max-w-7xl flex-col overflow-hidden border" onMouseDown={(event) => event.stopPropagation()} aria-label="LiOS Object Workbench">
        <header className="flex items-center gap-3 border-b border-border/70 px-4 py-3">
          <div className="grid h-9 w-9 place-items-center border border-[hsl(38,100%,50%)/30%] bg-[hsl(38,100%,50%)/7%]"><Boxes className="h-4 w-4 text-[hsl(38,100%,58%)]" /></div>
          <div className="min-w-0 flex-1"><div className="text-[11px] font-bold tracking-[.13em]">OBJECT WORKBENCH</div><div className="mt-1 text-[8px] text-muted-foreground">INSPECT · DRAG · SEND TO · COMPARE · SCENARIO · DECISION · MONITOR</div></div>
          <span className="border border-border px-2 py-1 text-[8px] text-muted-foreground">{objects.length} OBJECTS</span>
          <button onClick={onClose} className="p-1.5 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </header>

        <div className="flex items-center gap-2 border-b border-border/60 bg-black/20 p-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 border border-border/70 bg-black/25 px-2.5 py-2"><Search className="h-3.5 w-3.5 text-[hsl(38,100%,58%)]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="SEARCH OBJECT, SYMBOL, TAG OR DESCRIPTION" className="w-full bg-transparent text-[8px] outline-none placeholder:text-muted-foreground/55" /></div>
          <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)} className="border border-border bg-black px-2 py-2 text-[8px]"><option value="all">ALL KINDS</option>{kinds.map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}</select>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_360px]">
          <main className="min-h-0 overflow-y-auto p-3 scrollbar-thin">
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{filtered.map((object) => (
              <article
                key={object.id}
                draggable
                onDragStart={(event) => writeIntelligenceObjectDrag(event.dataTransfer, object)}
                onClick={() => setSelectedId(object.id)}
                data-terminal-object
                data-intelligence-object-id={object.id}
                className={`group cursor-grab border p-3 active:cursor-grabbing ${selectedId === object.id ? "border-[hsl(38,100%,50%)/38%] bg-[hsl(38,100%,50%)/5%]" : "border-border/65 bg-white/[.012] hover:border-[hsl(38,100%,50%)/24%] hover:bg-white/[.024]"}`}
              >
                <div className="flex items-center justify-between gap-2"><span className="text-[6.5px] font-bold tracking-widest text-[hsl(38,100%,58%)]">{object.kind.toUpperCase()}</span><Grip className="h-3 w-3 text-muted-foreground opacity-40 group-hover:opacity-80" /></div>
                <div className="mt-2 truncate text-[9px] font-bold text-foreground">{object.label}</div>
                <div className="mt-1 flex items-center justify-between gap-2 text-[7px] text-muted-foreground"><span>{object.symbol ?? object.view ?? "GLOBAL"}</span>{object.value && <span className="text-[hsl(38,100%,60%)]">{valueLabel(object)}</span>}</div>
                <p className="mt-2 line-clamp-2 text-[7px] leading-relaxed text-muted-foreground">{object.description || "Durable LiOS intelligence object"}</p>
                <div className="mt-2 flex flex-wrap gap-1">{object.tags.slice(0, 4).map((tag) => <span key={tag} className="border border-border/55 px-1 py-0.5 text-[6px] text-muted-foreground">{tag.toUpperCase()}</span>)}</div>
              </article>
            ))}</div>
            {!filtered.length && <div className="grid min-h-64 place-items-center border border-dashed border-border/60 text-[8px] text-muted-foreground">NO MATCHING OBJECTS</div>}
          </main>

          <aside className="min-h-0 overflow-y-auto border-l border-border/60 bg-black/18 p-3 scrollbar-thin">
            {!selected ? <div className="grid h-full place-items-center text-center text-[8px] text-muted-foreground"><div><Boxes className="mx-auto h-6 w-6" /><div className="mt-3">SELECT AN OBJECT TO INSPECT ITS ACTION SURFACE</div></div></div> : <div className="space-y-4">
              <section className="border border-border/70 bg-white/[.012] p-3">
                <div className="text-[7px] font-bold tracking-widest text-[hsl(38,100%,58%)]">{selected.kind.toUpperCase()}</div><div className="mt-2 text-[11px] font-bold">{selected.label}</div><div className="mt-1 text-[7px] text-muted-foreground">{selected.symbol ?? "GLOBAL"} · {selected.status.toUpperCase()} · {selected.relations.length} LINKS</div>{selected.value && <div className="mt-3 text-lg font-bold text-[hsl(38,100%,60%)]">{valueLabel(selected)}</div>}<p className="mt-3 text-[8px] leading-relaxed text-muted-foreground">{selected.description || "No description published."}</p>
              </section>
              <section><div className="mb-2 text-[7px] font-bold tracking-widest text-muted-foreground">UNIVERSAL ACTIONS</div><div className="grid gap-1.5">{actionsForIntelligenceObject(selected).map((action) => <button key={action.id} onClick={() => requestIntelligenceObjectAction(action)} className="flex items-center justify-between border border-border/65 bg-white/[.01] px-2.5 py-2 text-left text-[8px] text-muted-foreground hover:border-[hsl(38,100%,50%)/25%] hover:text-foreground"><span>{action.label.toUpperCase()}</span>{action.view && <span className="text-[6.5px] text-[hsl(38,100%,58%)]">{action.view.toUpperCase()}</span>}</button>)}</div></section>
              <section className="border border-border/65 bg-black/20 p-2.5"><div className="text-[7px] font-bold text-muted-foreground">PROVENANCE</div><div className="mt-2 space-y-1 text-[7px] text-muted-foreground"><div>SOURCE · {selected.source?.label ?? "NOT PUBLISHED"}</div><div>PROVIDER · {selected.source?.provider ?? "NOT PUBLISHED"}</div><div>EFFECTIVE · {selected.source?.effectiveAt ?? "NOT PUBLISHED"}</div><div>FRESHNESS · {selected.source?.freshness ?? "NOT PUBLISHED"}</div></div></section>
            </div>}
          </aside>
        </div>
      </section>
    </div>
  );
}
