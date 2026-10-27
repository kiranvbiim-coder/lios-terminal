/**
 * Watermelon ActivitiesCard adaptation for LIOS's *existing* P6 continuation
 * queue. Pinned donor:
 * WatermelonCorp/watermellon-registry@86052b8fd12bc19bf3bac07625a7f93736c42b17
 * src/components/watermelon-ui/activities-card-base.tsx
 * blob fac632b2675dff9d1199b038285ef4e58a520601 (MIT © Watermelon Contributors).
 * Full license: third_party/licenses/watermellon-registry-MIT.txt.
 *
 * Donor: collapsible motion header + activity icon rail. LIOS adaptation:
 * controlled canonical data, source-aware actions and honest empty/error
 * states; no mock cards, artificial time, local persistence or mobile sniffing.
 */
import * as React from "react";
import { useId, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertCircle, BellRing, CheckCircle2, ChevronDown, CircleHelp, GitBranch, RefreshCw, ShieldAlert } from "lucide-react";
import type { P6ContinuationItem } from "@shared/p6ContinuityContracts";

const ICONS: Record<P6ContinuationItem["kind"], typeof AlertCircle> = {
  review_change: GitBranch,
  complete_decision: CheckCircle2,
  configure_monitor: BellRing,
  automation_failed: AlertCircle,
  open_question: CircleHelp,
  risk_review: ShieldAlert,
  refresh_stale_evidence: RefreshCw,
};
const PRIORITY = {
  high: "border-rose-300/30 bg-rose-300/[0.055] text-rose-200",
  medium: "border-amber-300/30 bg-amber-300/[0.055] text-amber-200",
  low: "border-border/70 bg-white/[0.025] text-muted-foreground",
} as const;

export const MAX_VISIBLE_CONTINUATION_ITEMS = 8;

export function ProjectContinuationActivitiesCard({
  items,
  loading = false,
  unavailable = false,
  onOpenDecision,
  onReviewWorkflow,
}: {
  items: readonly P6ContinuationItem[];
  loading?: boolean;
  unavailable?: boolean;
  onOpenDecision?: (artifactId: string, title: string) => void;
  onReviewWorkflow?: (workflowId: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const id = useId();
  const reduce = useReducedMotion();
  const visible = showAll ? items.slice(0, 60) : items.slice(0, MAX_VISIBLE_CONTINUATION_ITEMS);
  return (
    <section aria-label="Project continuation activities" data-testid="project-continuation-activities"
      className="min-w-0 overflow-hidden rounded-xl border border-border/60 bg-card/65">
      <button type="button" aria-expanded={expanded} aria-controls={id}
        onClick={() => setExpanded(value => !value)}
        className="flex min-h-16 w-full items-center gap-3 p-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-amber-300">
        <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-amber-300/25 bg-amber-300/[0.065] text-amber-200">
          <GitBranch className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-ui text-base font-semibold text-foreground">Continue work</span>
          <span className="mt-1 block font-ui text-xs leading-5 text-muted-foreground">
            {unavailable ? "Project continuation unavailable" : loading ? "Loading recorded follow-ups…" : `${items.length} recorded follow-up${items.length === 1 ? "" : "s"} · no automatic actions`}
          </span>
        </span>
        <motion.span animate={{ rotate: expanded ? 180 : 0 }} transition={reduce ? { duration: 0 } : { duration: 0.2 }}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border/60 text-muted-foreground" aria-hidden="true">
          <ChevronDown className="h-4 w-4" />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {expanded && <motion.div id={id} initial={reduce ? false : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
          exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, height: 0 }}
          transition={reduce ? { duration: 0 } : { duration: 0.22 }}
          className="border-t border-border/55">
          {unavailable ? <p role="alert" className="p-4 font-ui text-sm text-rose-200">Cannot read this Project's follow-up state. No work items or actions are inferred.</p>
            : loading ? <p role="status" className="p-4 font-ui text-sm text-muted-foreground">Loading Project continuation state…</p>
            : !items.length ? <p role="status" className="p-4 font-ui text-sm text-muted-foreground">No deterministic follow-up is currently outstanding.</p>
            : <ol aria-label="Recorded follow-up items" className="divide-y divide-border/45">
              {visible.map(item => {
                const Icon = ICONS[item.kind];
                return <li key={item.id} className="group flex min-w-0 items-start gap-3 p-3 transition-colors hover:bg-white/[0.025] sm:p-4">
                  <span aria-hidden="true" className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border/65 bg-background/65 text-cyan-200">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h3 className="min-w-0 break-words font-ui text-sm font-semibold leading-5 text-foreground">{item.title}</h3>
                      <span className={`rounded-full border px-2 py-0.5 font-ui text-xs capitalize ${PRIORITY[item.priority]}`}>{item.priority} priority</span>
                    </div>
                    <p className="break-words font-ui text-[13px] leading-5 text-muted-foreground">{item.summary || "No summary recorded."}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-ui text-xs text-muted-foreground">{item.kind.replaceAll("_", " ")}</span>
                      {(item.sourceRefs.length > 0 || item.artifactRefs.length > 0)
                        && <span className="font-ui text-xs text-muted-foreground">
                          {item.sourceRefs.length} source refs · {item.artifactRefs.length} artifact refs
                        </span>}
                      {item.decisionArtifactId && onOpenDecision && <button type="button"
                        onClick={() => onOpenDecision(item.decisionArtifactId!, item.title)}
                        className="min-h-10 rounded-lg border border-cyan-300/25 px-3 font-ui text-[13px] text-cyan-200 hover:bg-cyan-300/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">
                          Open decision
                        </button>}
                      {!item.decisionArtifactId && item.workflowId && onReviewWorkflow && <button type="button"
                        onClick={() => onReviewWorkflow(item.workflowId!)}
                        className="min-h-10 rounded-lg border border-cyan-300/25 px-3 font-ui text-[13px] text-cyan-200 hover:bg-cyan-300/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">
                          Review workflow
                        </button>}
                    </div>
                  </div>
                </li>;
              })}
            </ol>}
          {items.length > MAX_VISIBLE_CONTINUATION_ITEMS && !unavailable && !loading &&
            <div className="border-t border-border/40 p-3">
              <button type="button" onClick={() => setShowAll(value => !value)}
                className="min-h-10 rounded-lg border border-border/65 px-3 font-ui text-[13px] text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">
                {showAll ? "Show fewer follow-ups" : `Show more (${Math.min(items.length, 60) - MAX_VISIBLE_CONTINUATION_ITEMS} additional)`}
              </button>
              {items.length > 60 && <p className="mt-1 text-xs text-muted-foreground">Showing at most 60 of {items.length} recorded items to keep this view responsive.</p>}
            </div>}
        </motion.div>}
      </AnimatePresence>
    </section>
  );
}
