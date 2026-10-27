import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ArrowUpRight, Expand, FileText, Grip, Layers3, Minimize, Pin, RotateCcw, X } from "lucide-react";
import type { AnalyticalOpenMode } from "@/lib/terminalActionContracts";
import type { ViewMode } from "@/lib/terminalTypes";
import { loadResearchTray, subscribeResearchTray, type ResearchTrayItem } from "@/lib/terminalResearchTray";
import { loadResearchCanvasPositions, removeResearchCanvasPosition, setResearchCanvasPosition, subscribeResearchCanvas } from "@/lib/terminalResearchCanvas";
import { buildSpatialResearchModel, buildExplicitResearchTrails, stepExplicitResearchTrail, listExplicitResearchConnections, inspectExplicitResearchConnection, clampSpatialPoint, moveSpatialPoint, type SpatialLayoutMode, type SpatialPoint } from "@/lib/spatialResearchModel";
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
  const [kindFilter, setKindFilter] = useState<"all" | ResearchTrayItem["kind"]>("all");
  const [trailGroup, setTrailGroup] = useState("");
  const [selectedConnectionKey, setSelectedConnectionKey] = useState<string | null>(null);
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
  const visibleItems = useMemo(() => kindFilter === "all" ? items : items.filter(item => item.kind === kindFilter), [items, kindFilter]);
  const model = useMemo(() => buildSpatialResearchModel(visibleItems, positions, mode), [visibleItems, positions, mode]);
  const trails = useMemo(() => buildExplicitResearchTrails(model.nodes), [model]);
  const connections = useMemo(() => listExplicitResearchConnections(model), [model]);
  const inspectedConnection = useMemo(() => inspectExplicitResearchConnection(model, selectedConnectionKey), [model, selectedConnectionKey]);
  const selectedTrail = trails.find(trail => trail.group === trailGroup) ?? null;
  const trailIndex = selectedTrail?.itemIds.indexOf(inspectedId ?? "") ?? -1;
  const points = useMemo(() => new Map(model.nodes.map(node => [
    node.item.id, dragPreview?.id === node.item.id ? dragPreview.point : node.point,
  ] as const)), [model, dragPreview]);
  const selected = model.nodes.find(node => node.item.id === inspectedId)?.item ?? null;

  useEffect(() => subscribeResearchTray(setItems), []);
  useEffect(() => subscribeResearchCanvas(() => setVersion(value => value + 1)), []);
  useEffect(() => { if (inspectedId && !selected) setInspectedId(null); }, [inspectedId, selected]);
  useEffect(() => { if (trailGroup && !selectedTrail) setTrailGroup(""); }, [trailGroup, selectedTrail]);
  useEffect(() => { if (selectedConnectionKey && !inspectedConnection) setSelectedConnectionKey(null); }, [selectedConnectionKey, inspectedConnection]);

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
  // A canceled pointer gesture (system gesture, lost touch capture) never saves.
  const cancelDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    dragPreviewRef.current = null;
    setDragPreview(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setAnnouncement("Move canceled. The prior saved pin position is unchanged.");
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
  const navigateTrail = (direction: "previous" | "next") => {
    if (!selectedTrail) return;
    const id = stepExplicitResearchTrail(selectedTrail.itemIds, inspectedId, direction);
    if (id) openInspection(id);
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
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter research pins by kind">
        {(["all", "context", "evidence", "note", "output"] as const).map(kind => (
          <button key={kind} type="button" className="lios-spatial-control"
            aria-pressed={kindFilter === kind} onClick={() => setKindFilter(kind)}>
            {kind === "all" ? "All" : kind === "note" ? "Notes" : kind === "evidence" ? "Evidence" : kind === "output" ? "Outputs" : "Context"}
            <span aria-hidden="true">({kind === "all" ? items.length : items.filter(item => item.kind === kind).length})</span>
          </button>
        ))}
      </div>
      <div className="lios-spatial-trail" role="group" aria-label="Guided evidence trail">
        <label htmlFor="lios-spatial-trail-choice" className="font-ui text-sm font-medium">Guided evidence trail</label>
        <select id="lios-spatial-trail-choice" value={trailGroup} onChange={event => setTrailGroup(event.target.value)}
          className="lios-spatial-trail-select" aria-label="Choose your saved research group">
          <option value="">Choose a grouped set</option>
          {trails.map(trail => <option key={trail.group} value={trail.group}>
            {trail.group} ({trail.itemIds.length} pins)
          </option>)}
        </select>
        <button type="button" className="lios-spatial-control" disabled={!selectedTrail}
          onClick={() => { if (selectedTrail) openInspection(selectedTrail.itemIds[0]); }}>Start</button>
        <button type="button" className="lios-spatial-control" disabled={!selectedTrail}
          onClick={() => navigateTrail("previous")} aria-label="Previous pinned research item">Previous</button>
        <button type="button" className="lios-spatial-control" disabled={!selectedTrail}
          onClick={() => navigateTrail("next")} aria-label="Next pinned research item">Next</button>
        <span className="font-ui text-xs text-muted-foreground" role="status" aria-live="polite">
          {selectedTrail ? trailIndex >= 0 ? `${trailIndex + 1} of ${selectedTrail.itemIds.length} pinned items`
            : `${selectedTrail.itemIds.length} saved pins ready`
            : "Choose a named group with at least two visible pins."}
        </span>
      </div>
      <details className="lios-spatial-connections">
        <summary className="lios-spatial-connections-summary">
          Inspect group connections <span aria-hidden="true">({connections.length})</span>
        </summary>
        <p className="lios-spatial-connections-explanation">
          Each line joins two neighboring pins in the same group you named. This shows organization, not verified evidence, causation, correlation, or permission to use underlying data.
        </p>
        {connections.length === 0 ? <p className="lios-spatial-connections-explanation">No visible pins share a named group. Filter or group saved research in the existing Research Tray.</p> : (
          <ul className="lios-spatial-connections-list" aria-label="Visible user-grouped connections">
            {connections.map(connection => (
              <li key={connection.key}>
                <button type="button"
                  className="lios-spatial-connection-choice"
                  aria-pressed={inspectedConnection?.key === connection.key}
                  onClick={() => setSelectedConnectionKey(connection.key)}>
                  <span className="truncate">{connection.from.title}</span>
                  <span aria-hidden="true">·</span>
                  <span className="truncate">{connection.to.title}</span>
                  <small className="block basis-full text-xs text-muted-foreground">Group: {connection.group} · User-assigned</small>
                </button>
              </li>
            ))}
          </ul>
        )}
        {inspectedConnection && (
          <div className="lios-spatial-connection-details" role="region" aria-label="Selected connection provenance">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong className="text-sm">Shared user-assigned group: {inspectedConnection.group}</strong>
              <button type="button" className="lios-spatial-control" onClick={() => setSelectedConnectionKey(null)}>Clear selection</button>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              This line represents group membership only. LiOS has not verified any link between these items or the evidence behind them.
            </p>
            <div className="lios-spatial-connection-endpoints">
              <div>
                <strong>{inspectedConnection.from.title}</strong>
                <span>{inspectedConnection.from.kind} · {getTerminalCapability(inspectedConnection.from.view).label}</span>
                <button type="button" onClick={() => openInspection(inspectedConnection.from.id)}>Inspect first pin</button>
              </div>
              <div>
                <strong>{inspectedConnection.to.title}</strong>
                <span>{inspectedConnection.to.kind} · {getTerminalCapability(inspectedConnection.to.view).label}</span>
                <button type="button" onClick={() => openInspection(inspectedConnection.to.id)}>Inspect second pin</button>
              </div>
            </div>
          </div>
        )}
      </details>
      <div
        ref={boardRef}
        className="lios-spatial-board"
        data-layout={mode}
        data-expanded={expanded ? "true" : "false"}
        data-trail-active={selectedTrail ? "true" : "false"}
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
              return from && to ? <line key={`${edge.fromId}:${edge.toId}`} data-connection-current={inspectedConnection?.group === edge.group && inspectedConnection.from.id === edge.fromId && inspectedConnection.to.id === edge.toId ? "true" : "false"} x1={from.x} y1={from.y} x2={to.x} y2={to.y} /> : null;
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
              data-trail-member={selectedTrail?.itemIds.includes(item.id) ? "true" : "false"}
              data-connection-member={inspectedConnection && (inspectedConnection.from.id === item.id || inspectedConnection.to.id === item.id) ? "true" : "false"}
              data-trail-current={selectedTrail && inspectedId === item.id ? "true" : "false"}
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
                  onPointerCancel={cancelDrag}
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
            <button ref={companionHeading} type="button" className="lios-spatial-companion-grip" title="Move companion; use arrow keys or drag" aria-label="Move insight companion with arrow keys or pointer" onPointerDown={event => startDrag(event, "companion", selected.id)} onPointerMove={continueDrag} onPointerUp={stopDrag} onPointerCancel={cancelDrag} onKeyDown={event => keyboardMove(event, "companion", selected.id)}>
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
        {model.hiddenCount > 0 ? ` Showing the first ${model.nodes.length} of ${visibleItems.length} matching pins; filter by kind to narrow this view.` : ""}
        {kindFilter !== "all" ? ` Filtered to ${visibleItems.length} of ${items.length} saved pins.` : ""}
      </p>
    </section>
  );
}
