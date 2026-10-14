import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Move, Pin, RefreshCw } from "lucide-react";
import type { AnalyticalOpenMode } from "@/lib/terminalActionContracts";
import type { ViewMode } from "@/lib/terminalTypes";
import { loadResearchTray, subscribeResearchTray, type ResearchTrayItem } from "@/lib/terminalResearchTray";
import { loadResearchCanvasPositions, setResearchCanvasPosition, subscribeResearchCanvas } from "@/lib/terminalResearchCanvas";
import { getTerminalCapability } from "@/lib/terminalCatalog";

interface Props { onOpen: (view: ViewMode, mode: AnalyticalOpenMode, symbol?: string) => void; }

function seededPosition(item: ResearchTrayItem, index: number): { x: number; y: number } {
  const hash = [...item.id].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7);
  const kindBand = item.kind === "evidence" ? 12 : item.kind === "note" ? 48 : item.kind === "output" ? 64 : 30;
  return { x: 7 + ((hash + index * 13) % 72), y: Math.min(82, kindBand + ((hash >>> 5) % 22) - 8) };
}

export default function SpatialResearchCanvas({ onOpen }: Props) {
  const [items, setItems] = useState<ResearchTrayItem[]>(() => loadResearchTray());
  const [version, setVersion] = useState(0);
  const boardRef = useRef<HTMLDivElement>(null);
  const positions = useMemo(() => loadResearchCanvasPositions(), [version]);

  useEffect(() => subscribeResearchTray(setItems), []);
  useEffect(() => subscribeResearchCanvas(() => setVersion((value) => value + 1)), []);

  const moveItem = (item: ResearchTrayItem, clientX: number, clientY: number) => {
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = ((clientX - rect.left) / rect.width) * 100;
    const y = ((clientY - rect.top) / rect.height) * 100;
    setResearchCanvasPosition(item.id, x, y);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3"><div><div className="font-ui text-[11px] font-semibold text-foreground">Spatial Research Canvas</div><p className="font-ui mt-1 text-[8px] text-muted-foreground">Arrange pinned research into a spatial memory. Drag cards; positions stay local to this device.</p></div><div className="font-ui text-[7px] text-muted-foreground">{items.length} OBJECTS</div></div>
      <div ref={boardRef} className="relative h-[470px] overflow-hidden rounded-2xl border border-border/60 bg-[radial-gradient(circle_at_center,rgba(255,255,255,.025),transparent_55%),linear-gradient(rgba(255,255,255,.018)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.014)_1px,transparent_1px)] bg-[size:auto,36px_36px,36px_36px]">
        <div className="pointer-events-none absolute left-3 top-3 font-ui text-[7px] uppercase tracking-[0.14em] text-cyan-300/45">Evidence / context</div>
        <div className="pointer-events-none absolute bottom-3 left-3 font-ui text-[7px] uppercase tracking-[0.14em] text-amber-300/45">Outputs / decisions</div>
        {items.length === 0 && <div className="absolute inset-0 flex items-center justify-center"><div className="max-w-sm text-center"><Pin className="mx-auto h-5 w-5 text-muted-foreground/40" /><div className="font-ui mt-3 text-[10px] font-medium text-foreground">Pin research to populate the canvas</div><div className="font-ui mt-1 text-[8px] leading-relaxed text-muted-foreground">Use the Immersive Dock or Research Tray to pin DCFs, financials, evidence, notes and outputs.</div></div></div>}
        {items.slice(0, 36).map((item, index) => {
          const position = positions[item.id] ?? seededPosition(item, index);
          const capability = getTerminalCapability(item.view);
          return (
            <article
              key={item.id}
              draggable
              onDragEnd={(event) => moveItem(item, event.clientX, event.clientY)}
              style={{ left: `${position.x}%`, top: `${position.y}%` }}
              className="absolute w-44 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-xl border border-border/70 bg-[#0c0d0f]/94 p-2.5 shadow-[0_12px_32px_rgba(0,0,0,.28)] backdrop-blur-sm transition hover:z-10 hover:border-amber-400/25 hover:bg-[#101114] active:cursor-grabbing"
            >
              <div className="flex items-start gap-2"><div className="mt-0.5 text-muted-foreground/50">{item.kind === "note" ? <FileText className="h-3 w-3" /> : <Move className="h-3 w-3" />}</div><div className="min-w-0 flex-1"><div className="flex items-center gap-1.5">{item.symbol && <span className="lios-symbol text-[7px] font-semibold text-amber-300">{item.symbol}</span>}<span className="font-ui truncate text-[8px] font-semibold text-foreground">{item.title}</span></div><div className="font-ui mt-1 text-[6px] text-muted-foreground">{capability.label} · {item.kind.toUpperCase()}</div>{item.note && <p className="font-ui mt-1.5 line-clamp-2 text-[7px] leading-relaxed text-muted-foreground/85">{item.note}</p>}<button onClick={() => onOpen(item.view, "tab", item.symbol || undefined)} className="font-ui mt-2 text-[7px] font-medium text-cyan-300/80 hover:text-cyan-200">Open →</button></div></div>
            </article>
          );
        })}
      </div>
      <div className="flex items-center gap-2 rounded-lg border border-border/45 px-2.5 py-2 font-ui text-[7px] text-muted-foreground"><RefreshCw className="h-3 w-3" /> Canvas is deliberately local and deterministic; it does not transmit notes or research objects.</div>
    </div>
  );
}
