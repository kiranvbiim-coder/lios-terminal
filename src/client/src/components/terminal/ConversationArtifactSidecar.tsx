import { useState } from "react";
import type { ComponentProps } from "react";
import { ArtifactPane } from "./ArtifactPane";

interface Props extends ComponentProps<typeof ArtifactPane> {
  focus: boolean;
  onExitFocus: () => void;
  onExpand: (version: number) => void;
}

export default function ConversationArtifactSidecar({ focus, onExitFocus, onExpand, ...props }: Props) {
  const [displayed, setDisplayed] = useState<{ artifactId: string; requestedVersion: number | null; version: number } | null>(null);
  const requestedVersion = props.version ?? null;
  return <aside className={focus
    ? "flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-[#060606]/95 p-3"
    : "lios-artifact-sidecar block min-h-0 w-[42%] shrink-0 overflow-y-auto border-l border-border/70 bg-[#060606]/95 p-3"}>
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
