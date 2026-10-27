import * as React from "react";
import { GitBranch, MessageSquareText, Workflow, Files } from "lucide-react";
import type { ProjectChat, ProjectSession } from "@/lib/useProjects";
import { useP6ProjectContinuity } from "@/lib/useP6Continuity";
import { projectResumeItems, projectResumeRecentWork, projectResumeSelection } from "@/lib/phase2ProjectPresentation";

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
  const recent = projectResumeRecentWork(projectId, chats, sessions, 4);
  const moreChats = recent.chats.filter(row => row.id !== chat?.id);
  const moreSessions = recent.sessions.filter(row => row.id !== session?.id);
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
    {(moreChats.length > 0 || moreSessions.length > 0) && <section aria-label="More saved Project work"
      className="space-y-2 border-t border-border/50 pt-3">
      <h3 className="font-ui text-sm font-semibold text-foreground">More saved work</h3>
      <div className="grid min-w-0 gap-2 sm:grid-cols-2">
        {moreChats.map(row => <button type="button" key={"chat:" + row.id}
          onClick={() => onOpenChat(row)}
          className="flex min-h-11 min-w-0 items-center gap-2 rounded-lg border border-border/60 bg-background/35 px-3 py-2 text-left hover:border-amber-300/35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">
          <MessageSquareText aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-ui text-sm text-foreground">{row.title}</span>
          <span className="shrink-0 font-ui text-xs text-muted-foreground">Chat</span>
        </button>)}
        {moreSessions.map(row => <button type="button" key={"session:" + row.id}
          onClick={() => onOpenSession(row)}
          className="flex min-h-11 min-w-0 items-center gap-2 rounded-lg border border-border/60 bg-background/35 px-3 py-2 text-left hover:border-amber-300/35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">
          <Files aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-ui text-sm text-foreground">{row.name}</span>
          <span className="shrink-0 font-ui text-xs text-muted-foreground">Session</span>
        </button>)}
      </div>
      <p className="font-ui text-xs leading-5 text-muted-foreground">
        Showing up to four current Chats and four saved Sessions from this Project.
        Other saved work remains available in the Project collections.
      </p>
    </section>}
    {continuity.isPending && <p role="status" className="font-ui text-sm text-muted-foreground">Checking recorded Project next steps…</p>}
    {continuity.isError && <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300/30 p-3 font-ui text-sm text-amber-100">
      <p className="min-w-0 flex-1">Project Continuity is unavailable. Your saved Chats and Sessions remain accessible; next steps are not verified.</p>
      <button type="button" disabled={continuity.isFetching} onClick={() => void continuity.refetch()}
        className="min-h-11 rounded-lg border border-border/65 px-3 py-2 font-ui text-sm text-foreground disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">
        {continuity.isFetching ? "Retrying…" : "Retry read-only history"}
      </button>
    </div>}
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
