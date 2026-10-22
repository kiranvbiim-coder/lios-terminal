import { useCallback, useEffect, useRef, useState } from "react";
import { ArtifactPane } from "./ArtifactPane";
import { useProjectSessions } from "@/lib/useProjects";
import type { ArtifactWorkbenchContext } from "@/lib/terminalTypes";
import { advanceArtifactWorkbenchRevision } from "@/lib/artifactWorkbenchHandoff";
import type { ArtifactWorkbenchRevisionSelection } from "@/lib/artifactWorkbenchHandoff";

interface Props {
  context: ArtifactWorkbenchContext;
  onVersionChange: (version: number) => void;
  onReturn: (context: ArtifactWorkbenchContext, dirty: boolean, prompt?: string) => void;
  onDirtyChange: (dirty: boolean) => void;
}

/** Registered Dockview content using the same canonical P4 editor as the Chat sidecar. */
export default function WorkbenchArtifactPane({ context, onVersionChange, onDirtyChange, onReturn }: Props) {
  const sessions = useProjectSessions(context.projectId);
  const [revision, setRevision] = useState<ArtifactWorkbenchRevisionSelection>({ requestedVersion: context.version, displayedVersion: context.version, loading: true });
  const [notice, setNotice] = useState<string | null>(null);
  const dirty = useRef(false);
  const revisionRef = useRef(revision);
  revisionRef.current = revision;
  const versionCallback = useRef(onVersionChange);
  versionCallback.current = onVersionChange;
  useEffect(() => {
    const next = advanceArtifactWorkbenchRevision(revisionRef.current, { type: "context", version: context.version, dirty: dirty.current });
    if (next !== revisionRef.current) {
      revisionRef.current = next;
      setRevision(next);
    }
  }, [context.version]);
  const selectVersion = useCallback((version: number | null) => {
    // Update the return guard before React commits the render. A fast Return
    // click must never navigate to a prior revision while the new one loads.
    const next = advanceArtifactWorkbenchRevision(revisionRef.current, { type: "select", version });
    if (next !== revisionRef.current) {
      revisionRef.current = next;
      setRevision(next);
    }
  }, []);
  const reportVersion = useCallback((version: number, artifactId: string, requestedVersion: number | null) => {
    if (artifactId !== context.artifactId) return;
    const current = revisionRef.current;
    const next = advanceArtifactWorkbenchRevision(current, { type: "loaded", version, requestedVersion });
    if (next === current) return;
    revisionRef.current = next;
    setRevision(next);
    versionCallback.current(version);
  }, [context.artifactId]);
  const reportDirty = useCallback((value: boolean) => { dirty.current = value; onDirtyChange(value); }, [onDirtyChange]);
  const returnToChat = (prompt?: string) => {
    if (dirty.current) { setNotice("Save or reset the unsaved Artifact edits before returning to Chat. Your draft remains here."); return; }
    if (revisionRef.current.loading) { setNotice("Wait for the selected saved revision to finish loading before returning to Chat."); return; }
    onReturn({ ...context, version: revisionRef.current.displayedVersion }, false, prompt);
  };
  return <section className="h-full overflow-auto p-3" data-testid="workbench-artifact-pane">
    <div className="mb-3 flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{context.projectId ? `Project ${context.projectId} · ` : ""}Chat {context.chatId}</span>
      <button type="button" data-testid="workbench-return-chat" className="rounded border border-border px-3 py-2 text-sm" onClick={() => returnToChat()}>Return to same Chat</button>
    </div>
    {notice && <p role="alert" className="mb-3 text-sm text-amber-200">{notice}</p>}
    <ArtifactPane artifactId={context.artifactId} projectId={context.projectId} owningChatId={context.chatId} version={revision.requestedVersion}
      onVersionChange={selectVersion} onDisplayedVersionChange={reportVersion} onDirtyChange={reportDirty}
      sessions={sessions.data ?? []} onClose={() => returnToChat()}
      onAsk={(id, title, prompt) => {
        if (id !== context.artifactId) { setNotice("Return to the original Chat before opening another Artifact."); return; }
        returnToChat(prompt ?? `Work on Artifact "${title}". Use ${id} as the active object and propose changes for review.`);
      }} />
  </section>;
}
