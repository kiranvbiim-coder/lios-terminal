import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ArrowUpRight, Expand, FileText, Grip, Layers3, Minimize, Pin, RotateCcw, X } from "lucide-react";
import type { AnalyticalOpenMode } from "@/lib/terminalActionContracts";
import type { ViewMode } from "@/lib/terminalTypes";
import { loadResearchTray, subscribeResearchTray, type ResearchTrayItem } from "@/lib/terminalResearchTray";
import { loadResearchCanvasPositions, removeResearchCanvasPosition, setResearchCanvasPosition, subscribeResearchCanvas } from "@/lib/terminalResearchCanvas";
import { buildSpatialResearchModel, clampSpatialPoint, moveSpatialPoint, type SpatialLayoutMode, type SpatialPoint } from "@/lib/spatialResearchModel";
import { getTerminalCapability } from "@/lib/terminalCatalog";

interface Props { onOpen: (view: ViewMode, mode: AnalyticalOpenMode, symbol?: string) => void; }
interface DragState { id: string; pointerId: number; kind: "node" | "companion" }
const MOVE_KEYS = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" } as const;

/**
 * A local visualization of user-pinned research, not another Workbench or Artifact store.
 * Edges exist only for an explicit group name. All object opens use the existing callback.
 */
export default function SpatialResearchCanvas({ onOpen }: Props) {
  const [items, setItems] = useState<ResearchTrayItem[]>(() => loadResearchTray());
  const [version, setVersion] = useState(0);
  const [mode, setMode] = useState<SpatialLayoutMode>("map");
  const [expanded, setExpanded] = useState(false);
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [companionPoint, setCompanionPoint] = useState<SpatialPoint>({ x: 70, y: 44 });
  const [announcement, setAnnouncement] = useState("");
  const [dragPreview, setDragPreview] = useState<{ id: string; point: SpatialPoint } | null>(null);
  const dragPreviewRef = useRef<{ id: string; point: SpatialPoint } | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const companionHeading = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const positions = useMemo(() => loadResearchCanvasPositions(), [version]);
  const model = useMemo(() => buildSpatialResearchModel(items, positions, mode), [items, positions, mode]);
  const points = useMemo(() => new Map(model.nodes.map(node => [
    node.item.id, dragPreview?.id === node.item.id ? dragPreview.point : node.point,
  ] as const)), [model, dragPreview]);
  const selected = model.nodes.find(node => node.item.id === inspectedId)?.item ?? null;

  useEffect(() => subscribeResearchTray(setItems), []);
  useEffect(() => subscribeResearchCanvas(() => setVersion(value => value + 1)), []);
  useEffect(() => { if (inspectedId && !selected) setInspectedId(null); }, [inspectedId, selected]);

  const fromPointer = (clientX: number, clientY: number): SpatialPoint | null => {
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return clampSpatialPoint({
      x: (clientX - rect.left) / rect.width * 100,
      y: (clientY - rect.top) / rect.height * 100,
    });
  };
  const move = (kind: DragState["kind"], id: string, point: SpatialPoint, commit = true) => {
    if (kind === "companion") { setCompanionPoint(point); return; }
    if (!commit) {
      const preview = { id, point };
      dragPreviewRef.current = preview;
      setDragPreview(preview);
      return;
    }
    try { setResearchCanvasPosition(id, point.x, point.y); }
    catch { setAnnouncement("Could not save the new position to this device."); }
  };
  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>, kind: DragState["kind"], id: string) => {
    if (mode === "timeline" && kind === "node") return;
    if (event.button !== 0) return;
    event.preventDefault();
    dragPreviewRef.current = null;
    setDragPreview(null);
    dragRef.current = { kind, id, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const continueDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    const point = fromPointer(event.clientX, event.clientY);
    if (point) move(dragRef.current.kind, dragRef.current.id, point, false);
  };
  const stopDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    const drag = dragRef.current;
    dragRef.current = null;
    const preview = dragPreviewRef.current;
    dragPreviewRef.current = null;
    if (drag?.kind === "node" && preview?.id === drag.id) move("node", drag.id, preview.point);
    setDragPreview(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const keyboardMove = (event: ReactKeyboardEvent<HTMLButtonElement>, kind: DragState["kind"], id: string) => {
    if (!(event.key in MOVE_KEYS) || (mode === "timeline" && kind === "node")) return;
    event.preventDefault();
    const direction = MOVE_KEYS[event.key as keyof typeof MOVE_KEYS];
    const point = kind === "companion" ? companionPoint : points.get(id);
    if (!point) return;
    move(kind, id, moveSpatialPoint(point, direction));
    setAnnouncement(`Moved ${kind === "companion" ? "companion" : "research pin"} ${direction}.`);
  };
  const openInspection = (id: string) => {
    setInspectedId(id);
    requestAnimationFrame(() => companionHeading.current?.focus());
  };
  return (
    <section className="lios-spatial-research space-y-3" aria-label="Spatial Research Canvas">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-ui text-base font-semibold text-foreground">Spatial Research Canvas</h3>
          <p className="mt-1 max-w-xl font-ui text-sm leading-5 text-muted-foreground">
            Your pinned research, arranged by you. Links connect only items sharing an explicit group name.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Spatial layout controls">
          <button type="button" className="lios-spatial-control" aria-pressed={mode === "map"} onClick={() => setMode("map")}>Map</button>
          <button type="button" className="lios-spatial-control" aria-pressed={mode === "timeline"} onClick={() => setMode("timeline")}>Timeline</button>
          <button type="button" className="lios-spatial-control" aria-pressed={mode === "list"} onClick={() => setMode("list")}>List</button>
          <button type="button" className="lios-spatial-control" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
            {expanded ? <Minimize size={15} aria-hidden="true" /> : <Expand size={15} aria-hidden="true" />}
            {expanded ? "Compact" : "Expand"}
          </button>
        </div>
      </div>
      <div
        ref={boardRef}
        className="lios-spatial-board"
        data-layout={mode}
        data-expanded={expanded ? "true" : "false"}
        role="group"
        aria-label={mode === "map" ? "Pinned research map" : mode === "timeline" ? "Pinned research timeline" : "Pinned research list"}
      >
        <div className="lios-spatial-field" aria-hidden="true" />
        <div className="lios-spatial-axis" aria-hidden="true">
          <span>{mode === "timeline" ? "Earlier pins" : "Evidence & context"}</span>
          <span>{mode === "timeline" ? "Later pins" : "Outputs & decisions"}</span>
        </div>
        {model.edges.length > 0 && (
          <svg className="lios-spatial-links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {model.edges.map(edge => {
              const from = points.get(edge.fromId);
              const to = points.get(edge.toId);
              return from && to ? <line key={`${edge.fromId}:${edge.toId}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} /> : null;
            })}
          </svg>
        )}
        {!model.nodes.length && <div className="lios-spatial-empty">
          <Pin size={22} aria-hidden="true" />
          <strong>No pinned research yet</strong>
          <p>Pin an evidence item, note, analysis or output from the existing Research Tray or Workbench. Nothing is generated or transmitted by this canvas.</p>
        </div>}
        {model.nodes.map(({ item, point }) => {
          const capability = getTerminalCapability(item.view);
          const effectivePoint = points.get(item.id) ?? point;
          return (
            <article
              key={item.id}
              className="lios-spatial-node"
              data-kind={item.kind}
              data-inspected={inspectedId === item.id ? "true" : "false"}
              style={{ left: `${effectivePoint.x}%`, top: `${effectivePoint.y}%` }}
              aria-label={`${item.title}; ${item.kind}; ${item.group ? `group ${item.group}` : "ungrouped"}`}
            >
              <div className="lios-spatial-node-header">
                <span className="lios-spatial-node-icon" aria-hidden="true">{item.kind === "note" ? <FileText size={14} /> : <Layers3 size={14} />}</span>
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-sm">{item.title}</strong>
                  <small className="block truncate text-xs text-muted-foreground">{capability.label} · {item.kind}</small>
                </span>
                {mode === "map" && <button
                  type="button"
                  className="lios-spatial-drag"
                  title={`Move ${item.title}; use arrow keys or drag`}
                  aria-label={`Move ${item.title}; arrow keys move the pin`}
                  onPointerDown={event => startDrag(event, "node", item.id)}
                  onPointerMove={continueDrag}
                  onPointerUp={stopDrag}
                  onPointerCancel={stopDrag}
                  onKeyDown={event => keyboardMove(event, "node", item.id)}
                ><Grip size={16} aria-hidden="true" /></button>}
              </div>
              {item.group && <span className="lios-spatial-node-group" title={item.group}>Group: {item.group}</span>}
              {item.note && <p className="lios-spatial-note">{item.note}</p>}
              <div className="lios-spatial-node-actions">
                <button type="button" onClick={() => openInspection(item.id)}>Inspect</button>
                <button type="button" onClick={() => onOpen(item.view, "tab", item.symbol || undefined)}>
                  Open <ArrowUpRight size={13} aria-hidden="true" />
                </button>
                {mode === "map" && positions[item.id] && <button type="button" title="Reset pin position" aria-label={`Reset position of ${item.title}`} onClick={() => { try { removeResearchCanvasPosition(item.id); } catch { setAnnouncement("Could not reset this position on this device."); } }}><RotateCcw size={14} /></button>}
              </div>
            </article>
          );
        })}
        {selected && <aside className="lios-spatial-companion" aria-label="Insight companion" style={{ left: `${companionPoint.x}%`, top: `${companionPoint.y}%` }}>
          <div className="lios-spatial-companion-head">
            <button ref={companionHeading} type="button" className="lios-spatial-companion-grip" title="Move companion; use arrow keys or drag" aria-label="Move insight companion with arrow keys or pointer" onPointerDown={event => startDrag(event, "companion", selected.id)} onPointerMove={continueDrag} onPointerUp={stopDrag} onPointerCancel={stopDrag} onKeyDown={event => keyboardMove(event, "companion", selected.id)}>
              <Grip size={16} aria-hidden="true" /> Insight companion
            </button>
            <button type="button" onClick={() => setInspectedId(null)} aria-label="Close insight companion"><X size={16} /></button>
          </div>
          <div className="lios-spatial-companion-body">
            <strong className="block text-sm">{selected.title}</strong>
            <p className="mt-1 text-xs text-muted-foreground">{selected.kind} · {getTerminalCapability(selected.view).label}</p>
            {selected.group && <p className="mt-2 text-xs">User group: {selected.group}</p>}
            <p className="mt-2 whitespace-pre-wrap text-sm leading-5">{selected.note || selected.description || "No note has been added to this pin."}</p>
            {selected.tags.length > 0 && <p className="mt-2 break-words text-xs text-muted-foreground">Tags: {selected.tags.join(", ")}</p>}
            <button type="button" className="lios-spatial-open" onClick={() => onOpen(selected.view, "tab", selected.symbol || undefined)}>Open original analysis <ArrowUpRight size={14} aria-hidden="true" /></button>
          </div>
        </aside>}
      </div>
      <p className="font-ui text-xs leading-5 text-muted-foreground" role="status" aria-live="polite">
        {announcement || (mode === "map" ? "Drag a pin's handle or use its arrow keys to arrange. Inspect opens one movable companion." : "Timeline orders pins by when they were saved locally; positions are read-only here.")}
        {model.hiddenCount > 0 ? ` Showing the first ${model.nodes.length} of ${items.length} saved pins; refine the Research Tray for additional objects.` : ""}
      </p>
    </section>
  );
}
