import { useRef, useState, useEffect } from "react";
import type { ComponentProps } from "react";
import { ArtifactPane } from "./ArtifactPane";
import { clampConversationSidecarWidth } from "@/lib/conversationSidecarSizing";

interface Props extends ComponentProps<typeof ArtifactPane> {
  focus: boolean;
  onExitFocus: () => void;
  onExpand: (version: number) => void;
}

export default function ConversationArtifactSidecar({ focus, onExitFocus, onExpand, ...props }: Props) {
  const [displayed, setDisplayed] = useState<{ artifactId: string; requestedVersion: number | null; version: number } | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);
  const requestedVersion = props.version ?? null;
  return <aside style={focus ? undefined : { position: "relative", width: width ?? "48%", minWidth: 320, maxWidth: "min(80%, max(320px, calc(100% - 360px)))" }} className={focus
    ? "flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-[#060606]/95 p-3"
    : "lios-artifact-sidecar block min-h-0 shrink-0 overflow-y-auto border-l border-border/70 bg-[#060606]/95 p-3"}>
    <div role="separator" aria-label="Resize analytical Artifact" aria-orientation="vertical" tabIndex={focus ? -1 : 0}
      className={focus ? "hidden" : "absolute bottom-0 left-0 top-0 z-10 w-2 cursor-col-resize"}
      onKeyDown={event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); const aside = event.currentTarget.parentElement; const available = aside?.parentElement?.getBoundingClientRect().width ?? 0; const currentWidth = aside?.getBoundingClientRect().width ?? 600; const change = event.key === "ArrowLeft" ? 40 : -40; setWidth(value => clampConversationSidecarWidth((value ?? currentWidth) + change, available)); } }}
      onPointerDown={event => {
        event.preventDefault(); cleanup.current?.();
        const aside = event.currentTarget.parentElement, container = aside?.parentElement, initial = aside?.getBoundingClientRect().width ?? 600, start = event.clientX;
        const move = (next: PointerEvent) => setWidth(clampConversationSidecarWidth(initial + start - next.clientX, container?.getBoundingClientRect().width ?? 0));
        const end = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); cleanup.current = null; };
        cleanup.current = end; window.addEventListener("pointermove", move); window.addEventListener("pointerup", end, { once: true });
      }}/>
    <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-amber-300/15 p-2" data-p4-artifact-focus={focus || undefined}>
      <span className="text-xs text-muted-foreground">{focus ? "Artifact Focus" : "Saved Artifact"}</span>
      <div className="flex gap-2">
        {focus && <button type="button" onClick={onExitFocus} className="rounded border border-border/60 px-2 py-1 text-xs">Exit Focus</button>}
        <button type="button" data-testid="artifact-expand-workspace" disabled={displayed?.artifactId !== props.artifactId || displayed.requestedVersion !== requestedVersion} className="rounded border border-border/60 px-2 py-1 text-xs disabled:opacity-40" onClick={() => {
          if (displayed?.artifactId === props.artifactId && displayed.requestedVersion === requestedVersion) onExpand(displayed.version);
        }}>Expand workspace</button>
      </div>
    </div>
    <ArtifactPane {...props} onDisplayedVersionChange={(version, artifactId) => {
        if (artifactId === props.artifactId) setDisplayed(current => current?.artifactId === artifactId && current.requestedVersion === requestedVersion && current.version === version ? current : { artifactId, requestedVersion, version });
        props.onDisplayedVersionChange?.(version, artifactId);
    }} />
  </aside>;
}
