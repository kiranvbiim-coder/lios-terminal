/**
 * Read-only LIOS Project Intelligence history.
 * Renders the existing P7 timeline without moving events, rerunning agents,
 * synthesizing changes, or creating another Project memory store.
 * Uses installed Framer Motion + Lucide and LIOS design tokens.
 */
import * as React from "react";
import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  BookOpen, ChevronDown, ChevronRight, FileText, FolderOpen, GitBranch,
  Landmark, MessageSquareText, Network, ScrollText, type LucideIcon,
} from "lucide-react";
import type { P7TimelineEvent } from "@shared/p7ResearchContracts";

const EVENT_STYLE: Record<P7TimelineEvent["type"], { label: string; icon: LucideIcon; tint: string; dot: string }> = {
  chat: { label: "Conversation", icon: MessageSquareText, tint: "text-blue-200", dot: "bg-blue-400" },
  resource: { label: "Source added", icon: FolderOpen, tint: "text-cyan-200", dot: "bg-cyan-400" },
  artifact: { label: "Saved Artifact", icon: FileText, tint: "text-fuchsia-200", dot: "bg-fuchsia-400" },
  ledger: { label: "Recorded activity", icon: ScrollText, tint: "text-slate-200", dot: "bg-slate-400" },
  filing: { label: "Filing", icon: Landmark, tint: "text-amber-200", dot: "bg-amber-400" },
  research: { label: "Research", icon: BookOpen, tint: "text-teal-200", dot: "bg-teal-400" },
  decision: { label: "Decision", icon: GitBranch, tint: "text-orange-200", dot: "bg-orange-400" },
  thesis: { label: "Thesis", icon: Network, tint: "text-violet-200", dot: "bg-violet-400" },
  document: { label: "Document", icon: FileText, tint: "text-emerald-200", dot: "bg-emerald-400" },
};

type EventRefs = Pick<P7TimelineEvent, "sourceRefs" | "entityRefs" | "artifactRefs" | "modelRefs" | "decisionRef">;

export function projectTimelineEvidenceCount(event: EventRefs): number {
  return event.sourceRefs.length + event.entityRefs.length + event.artifactRefs.length
    + event.modelRefs.length + (event.decisionRef ? 1 : 0);
}

export interface ProjectTimelineGroup {
  key: string;
  label: string;
  events: P7TimelineEvent[];
}

/** Sort latest-first without modifying the server-owned response; group by the displayed local day. */
export function groupProjectTimeline(events: readonly P7TimelineEvent[]): ProjectTimelineGroup[] {
  const sorted = [...events].sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id));
  const groups: ProjectTimelineGroup[] = [];
  for (const event of sorted) {
    const date = new Date(event.at);
    const key = Number.isFinite(date.getTime())
      ? [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-")
      : "unknown";
    const label = key === "unknown" ? "Date unavailable"
      : new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(date);
    const current = groups[groups.length - 1];
    if (current?.key === key) current.events.push(event);
    else groups.push({ key, label, events: [event] });
  }
  return groups;
}

function ReferencePreview({ label, values }: { label: string; values: readonly string[] }) {
  if (!values.length) return null;
  return (
    <div className="space-y-1">
      <dt className="font-ui text-[11px] font-semibold text-muted-foreground">{label} · {values.length}</dt>
      <dd className="break-words font-mono text-[11px] leading-5 text-foreground/85">
        {values.slice(0, 4).join(" · ")}
        {values.length > 4 ? ` · +${values.length - 4} more` : ""}
      </dd>
    </div>
  );
}

export function ProjectIntelligenceTimeline({ events, loading = false, error = false }: {
  events: readonly P7TimelineEvent[];
  loading?: boolean;
  error?: boolean;
}) {
  const [visibleCount, setVisibleCount] = useState(8);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const reducedMotion = useReducedMotion();
  const visible = [...events].sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id)).slice(0, visibleCount);
  const groups = groupProjectTimeline(visible);

  if (error) return <p role="alert" className="mt-3 rounded-lg border border-red-400/25 p-3 font-ui text-sm text-red-200">Project history could not be loaded. Refresh the index or retry the Project.</p>;
  if (loading) return <p role="status" className="mt-3 font-ui text-sm text-muted-foreground">Loading recorded Project history…</p>;
  if (!events.length) return <p role="status" className="mt-3 rounded-lg border border-border/50 p-4 font-ui text-sm text-muted-foreground">No recorded Project events match the current filters.</p>;

  return (
    <div className="mt-4" data-testid="project-intelligence-visual-timeline">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <span className="font-ui text-sm font-medium text-foreground">Recorded Project history</span>
        <span className="font-ui text-xs text-muted-foreground">Showing {visible.length} of {events.length} events</span>
      </div>
      <div className="space-y-5">
        {groups.map(group => (
          <section key={group.key} aria-label={group.label}>
            <div className="mb-3 flex items-center gap-3 pl-3">
              <div className="h-2 w-2 rounded-full bg-amber-300/75" aria-hidden="true" />
              <h4 className="font-ui text-xs font-semibold uppercase tracking-wider text-amber-200/90">{group.label}</h4>
              <span className="font-ui text-[11px] text-muted-foreground">{group.events.length} shown</span>
            </div>
            <ol className="ml-[15px] space-y-3 border-l border-border/60 pl-5">
              {group.events.map(event => {
                const style = EVENT_STYLE[event.type];
                const Icon = style.icon;
                const isOpen = expanded.has(event.id);
                const evidenceCount = projectTimelineEvidenceCount(event);
                return (
                  <li key={event.id} className="relative">
                    <span className={`absolute -left-[26px] top-5 h-2.5 w-2.5 rounded-full border-2 border-background ${style.dot}`} aria-hidden="true" />
                    <motion.article
                      initial={false}
                      whileHover={reducedMotion ? undefined : { x: 2 }}
                      transition={{ type: "spring", damping: 28, stiffness: 300 }}
                      className="rounded-xl border border-border/55 bg-background/60 p-3.5 transition-colors hover:border-border"
                      data-timeline-kind={event.type}
                    >
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        aria-label={`${isOpen ? "Hide details" : "Show details"}: ${event.title}`}
                        onClick={() => setExpanded(previous => {
                          const next = new Set(previous);
                          if (next.has(event.id)) next.delete(event.id);
                          else next.add(event.id);
                          return next;
                        })}
                        className="flex w-full min-w-0 items-start gap-3 text-left focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
                      >
                        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/45 bg-white/[0.035] ${style.tint}`} aria-hidden="true"><Icon className="h-4 w-4" /></span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className={`font-ui text-[11px] font-semibold ${style.tint}`}>{style.label}</span>
                            <time dateTime={event.at} className="font-ui text-[11px] text-muted-foreground">{new Date(event.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</time>
                          </span>
                          <span className="mt-1 block font-ui text-sm font-semibold leading-5 text-foreground">{event.title}</span>
                          <span className="mt-1.5 block font-ui text-[11px] text-muted-foreground">
                            {evidenceCount ? `${evidenceCount} recorded link${evidenceCount === 1 ? "" : "s"}` : "No linked references recorded"}
                            {" · "}{isOpen ? "Hide details" : "View details"}
                          </span>
                        </span>
                        {isOpen ? <ChevronDown className="mt-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                      </button>
                      {isOpen && (
                        <div className="mt-3 space-y-3 border-t border-border/40 pt-3 pl-1" data-testid="timeline-expanded-evidence">
                          {event.summary ? <p className="whitespace-pre-line font-ui text-sm leading-6 text-foreground/85">{event.summary}</p> : <p className="font-ui text-xs text-muted-foreground">No recorded event summary.</p>}
                          {evidenceCount > 0 && (
                            <dl className="grid gap-3 rounded-lg bg-white/[0.025] p-3 sm:grid-cols-2" aria-label="Recorded event references">
                              <ReferencePreview label="Sources" values={event.sourceRefs} />
                              <ReferencePreview label="Entities" values={event.entityRefs} />
                              <ReferencePreview label="Artifacts" values={event.artifactRefs} />
                              <ReferencePreview label="Models" values={event.modelRefs} />
                              {event.decisionRef && <ReferencePreview label="Decision" values={[event.decisionRef]} />}
                            </dl>
                          )}
                        </div>
                      )}
                    </motion.article>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>
      {events.length > visibleCount && (
        <button type="button" onClick={() => setVisibleCount(n => n + 12)}
          className="mt-5 min-h-10 w-full rounded-lg border border-border/70 bg-white/[0.025] px-4 font-ui text-sm font-medium text-foreground hover:border-amber-300/30 hover:bg-white/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">
          Show more history · {events.length - visible.length} remaining
        </button>
      )}
      {visibleCount > 8 && (
        <button type="button" onClick={() => setVisibleCount(8)}
          className="mt-2 min-h-10 w-full font-ui text-xs text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">
          Show fewer events
        </button>
      )}
    </div>
  );
}
