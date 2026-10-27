import * as React from "react";
import { GitBranch, MessageSquareText, Workflow, Files } from "lucide-react";
import type { ProjectChat, ProjectSession } from "@/lib/useProjects";
import { useP6ProjectContinuity } from "@/lib/useP6Continuity";
import { projectResumeItems, projectResumeSelection } from "@/lib/phase2ProjectPresentation";

export function ProjectResumeDesk({ projectId, chats, sessions, onOpenChat, onOpenSession, onFocusArtifact, onInspectContinuity, onOpenWatchrooms }: {
  projectId: number;
  chats: readonly ProjectChat[];
  sessions: readonly ProjectSession[];
  onOpenChat: (chat: ProjectChat) => void;
  onOpenSession: (session: ProjectSession) => void;
  onFocusArtifact: (id: string, title: string) => void;
  onInspectContinuity: () => void;
  onOpenWatchrooms: () => void;
}) {
  const { chat, session } = projectResumeSelection(projectId, chats, sessions);
  const continuity = useP6ProjectContinuity(projectId);
  const snapshot = continuity.isError ? undefined : continuity.data;
  const items = projectResumeItems(projectId, snapshot);

  if (!chat && !session && !items.length && !continuity.isError) return null;

  return <section data-testid="lios-project-resume-desk" aria-label="Continue Project work"
    className="mt-6 space-y-3 rounded-xl border border-border/60 bg-white/[0.02] p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-ui text-base font-semibold text-foreground">Continue work</h2>
      <button type="button" onClick={onInspectContinuity} className="min-h-10 rounded-lg border border-border/60 px-3 py-2 font-ui text-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-amber-300/70">Project history</button>
    </div>
    <div className="grid min-w-0 gap-2 sm:grid-cols-2">
      {chat && <button type="button" onClick={() => onOpenChat(chat)}
        className="flex min-h-20 min-w-0 items-start gap-3 rounded-lg border border-border/60 bg-background/40 p-3 text-left hover:border-amber-300/35 focus-visible:ring-2 focus-visible:ring-amber-300/70">
        <MessageSquareText aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" />
        <span className="min-w-0"><span className="block font-ui text-xs text-muted-foreground">Recent conversation</span>
        <span className="mt-1 block truncate font-ui text-sm font-semibold text-foreground">{chat.title}</span></span>
      </button>}
      {session && <button type="button" onClick={() => onOpenSession(session)}
        className="flex min-h-20 min-w-0 items-start gap-3 rounded-lg border border-border/60 bg-background/40 p-3 text-left hover:border-amber-300/35 focus-visible:ring-2 focus-visible:ring-amber-300/70">
        <Files aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" />
        <span className="min-w-0"><span className="block font-ui text-xs text-muted-foreground">Saved session</span>
        <span className="mt-1 block truncate font-ui text-sm font-semibold text-foreground">{session.name}</span></span>
      </button>}
    </div>
    {continuity.isError && <p role="alert" className="font-ui text-sm text-amber-200">Project Continuity is unavailable. Saved conversations and sessions remain accessible; review history after reconnecting.</p>}
    {items.length > 0 && <div className="space-y-2 border-t border-border/50 pt-3" aria-label="Recorded Project next steps">
      <h3 className="font-ui text-sm font-semibold text-foreground">Next steps from saved Project history</h3>
      {items.map(item => <article key={item.id} className="flex min-w-0 flex-wrap items-start gap-2 rounded-lg border border-border/50 p-3">
        <GitBranch aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"/>
        <div className="min-w-0 flex-1">
          <div className="font-ui text-sm font-medium text-foreground">{item.title}</div>
          <p className="mt-1 line-clamp-2 font-ui text-xs leading-5 text-muted-foreground">{item.summary}</p>
          <div className="mt-1 font-ui text-xs text-muted-foreground">{item.priority} priority · {item.sourceRefs.length} source reference{item.sourceRefs.length === 1 ? "" : "s"}</div>
        </div>
        {item.decisionArtifactId && <button type="button" onClick={() => onFocusArtifact(item.decisionArtifactId!, item.title)} className="min-h-10 rounded-md border border-border/65 px-3 py-2 font-ui text-sm text-foreground focus-visible:ring-2 focus-visible:ring-amber-300/70">Open decision</button>}
        {item.workflowId && <button type="button" onClick={onOpenWatchrooms} className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-border/65 px-3 py-2 font-ui text-sm text-foreground focus-visible:ring-2 focus-visible:ring-amber-300/70"><Workflow aria-hidden="true" className="h-3.5 w-3.5" />Review watchrooms</button>}
      </article>)}
      {snapshot && snapshot.continuationQueue.length > items.length && <p className="font-ui text-xs text-muted-foreground">{snapshot.continuationQueue.length - items.length} further saved next steps are available under Project history.</p>}
    </div>}
  </section>;
}
