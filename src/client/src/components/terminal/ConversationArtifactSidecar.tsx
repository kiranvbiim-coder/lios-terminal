import { useRef, useState, useEffect, useId } from "react";
import type { ComponentProps, CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { ArtifactPane } from "./ArtifactPane";
import {
  artifactSidecarBounds,
  canExpandArtifactRevision,
  clampArtifactSidecarWidth,
  keyboardArtifactSidecarWidth,
} from "@/lib/artifactSidecarSizing";

interface Props extends ComponentProps<typeof ArtifactPane> {
  focus: boolean;
  onEnterFocus?: () => void;
  onExitFocus: () => void;
  onExpand: (version: number) => void;
}

type Drag = { pointerId: number; startX: number; startWidth: number };

/** P4 remains the only editor. This component owns *layout*, not a duplicate draft or Artifact store. */
export default function ConversationArtifactSidecar({ focus, onEnterFocus, onExitFocus, onExpand, ...props }: Props) {
  const [displayed, setDisplayed] = useState<{ artifactId: string; requestedVersion: number | null; version: number } | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const asideRef = useRef<HTMLElement>(null);
  const separatorRef = useRef<HTMLDivElement>(null);
  const exitFocusRef = useRef<HTMLButtonElement>(null);
  const wasFocused = useRef(false);
  const drag = useRef<Drag | null>(null);
  const instructionsId = useId();
  const requestedVersion = props.version ?? null;

  useEffect(() => {
    const parent = asideRef.current?.parentElement;
    if (!parent) return;
    const measure = () => {
      const next = Math.round(parent.getBoundingClientRect().width);
      if (Number.isFinite(next) && next > 0) setContainerWidth(old => old === next ? old : next);
    };
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(parent);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, []);

  useEffect(() => {
    if (focus && !wasFocused.current) exitFocusRef.current?.focus();
    wasFocused.current = focus;
    if (focus && drag.current) {
      const pointerId = drag.current.pointerId;
      drag.current = null;
      if (separatorRef.current?.hasPointerCapture(pointerId)) separatorRef.current.releasePointerCapture(pointerId);
    }
  }, [focus]);

  useEffect(() => {
    const cancelWithEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !drag.current) return;
      event.preventDefault();
      const current = drag.current;
      drag.current = null;
      setWidth(current.startWidth);
      if (separatorRef.current?.hasPointerCapture(current.pointerId)) separatorRef.current.releasePointerCapture(current.pointerId);
    };
    window.addEventListener("keydown", cancelWithEscape);
    return () => {
      window.removeEventListener("keydown", cancelWithEscape);
      if (drag.current && separatorRef.current?.hasPointerCapture(drag.current.pointerId)) {
        separatorRef.current.releasePointerCapture(drag.current.pointerId);
      }
      drag.current = null;
    };
  }, []);

  // Reset stale load/dirty indications if a different object is selected. The
  // exact-revision check below also applies synchronously before the effect.
  useEffect(() => { setDisplayed(null); setDirty(false); }, [props.artifactId]);

  const measured = containerWidth ?? 1200;
  const bounds = artifactSidecarBounds(measured);
  const resized = clampArtifactSidecarWidth(width ?? measured * 0.48, measured);
  const actualContainerWidth = () => asideRef.current?.parentElement?.getBoundingClientRect().width ?? measured;
  const canExpand = canExpandArtifactRevision(displayed, props.artifactId, requestedVersion, dirty);
  const style = focus ? undefined : {
    position: "relative",
    width: containerWidth === null ? "48%" : `${resized}px`,
    minWidth: 0,
    maxWidth: "80%",
    "--lios-sidecar-width": containerWidth === null ? "48%" : `${resized}px`,
  } as CSSProperties;

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointerId) return;
    drag.current = null;
    if (cancelled) setWidth(current.startWidth);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return <aside
    ref={asideRef}
    style={style}
    data-artifact-sidecar-focus={focus ? "true" : "false"}
    className={focus
      ? "relative flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-[#060606]/95 p-3"
      : "lios-artifact-sidecar block min-h-0 shrink-0 overflow-y-auto border-l border-border/70 bg-[#060606]/95 p-3"}
  >
    <div
      ref={separatorRef}
      role="separator"
      aria-label="Resize analytical Artifact"
      aria-orientation="vertical"
      aria-valuemin={containerWidth === null ? undefined : bounds.min}
      aria-valuemax={containerWidth === null ? undefined : bounds.max}
      aria-valuenow={containerWidth === null ? undefined : resized}
      aria-valuetext={containerWidth === null ? "Artifact width not yet measured" : `${resized} pixels, ${Math.max(0, measured - resized)} pixels remain for Chat`}
      aria-describedby={instructionsId}
      tabIndex={focus ? -1 : 0}
      className={focus ? "hidden" : "absolute bottom-0 left-0 top-0 z-10 w-2 cursor-col-resize touch-none focus-visible:ring-2 focus-visible:ring-cyan-300"}
      onKeyDown={event => {
        if (focus) return;
        const next = keyboardArtifactSidecarWidth(event.key, resized, actualContainerWidth(), event.shiftKey);
        if (next === null) return;
        event.preventDefault();
        setWidth(next);
      }}
      onPointerDown={event => {
        if (focus || event.button !== 0 || !event.isPrimary) return;
        event.preventDefault();
        const startWidth = asideRef.current?.getBoundingClientRect().width ?? resized;
        drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return;
        setWidth(clampArtifactSidecarWidth(current.startWidth + current.startX - event.clientX, actualContainerWidth()));
      }}
      onPointerUp={event => endDrag(event, false)}
      onPointerCancel={event => endDrag(event, true)}
      onLostPointerCapture={event => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return;
        drag.current = null;
        setWidth(current.startWidth);
      }}
    />
    <p id={instructionsId} className="sr-only">
      Use Left or Right Arrow to widen or narrow the Artifact panel, Shift with an arrow for a larger step, Home for minimum, End for maximum. In Focus mode resizing is unavailable.
    </p>
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300/15 p-2" data-p4-artifact-focus={focus || undefined}>
      <span className="text-xs text-muted-foreground">{focus ? "Artifact Focus" : "Saved Artifact"}</span>
      <div className="flex flex-wrap gap-2">
        {focus
          ? <button ref={exitFocusRef} type="button" onClick={onExitFocus} className="min-h-9 rounded border border-border/60 px-2 py-1 text-xs focus-visible:ring-2 focus-visible:ring-cyan-300">Exit Focus — back to Chat</button>
          : onEnterFocus && <button type="button" onClick={onEnterFocus} className="min-h-9 rounded border border-border/60 px-2 py-1 text-xs focus-visible:ring-2 focus-visible:ring-cyan-300">Focus Artifact</button>}
        <button
          type="button"
          data-testid="artifact-expand-workspace"
          disabled={!canExpand}
          title={dirty ? "Save or reset unsaved Artifact edits before expanding" : !canExpand ? "Wait for the exact saved Artifact version to load" : "Open this exact saved Artifact version in Workbench"}
          className="min-h-9 rounded border border-border/60 px-2 py-1 text-xs focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:opacity-40"
          onClick={() => { if (canExpand && displayed) onExpand(displayed.version); }}
        >Expand workspace</button>
      </div>
    </div>
    {dirty && <p role="status" className="mb-2 font-ui text-xs text-amber-200">Unsaved Artifact edits — save or reset them before expanding into Workbench.</p>}
    <ArtifactPane {...props}
      onDirtyChange={value => { setDirty(value); props.onDirtyChange?.(value); }}
      onDisplayedVersionChange={(version, artifactId, loadedRequest) => {
        if (artifactId === props.artifactId) {
          setDisplayed(current => current?.artifactId === artifactId && current.requestedVersion === loadedRequest && current.version === version
            ? current : { artifactId, requestedVersion: loadedRequest, version });
        }
        props.onDisplayedVersionChange?.(version, artifactId, loadedRequest);
      }}
    />
  </aside>;
}
