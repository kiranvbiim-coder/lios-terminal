import { useRef, useState } from "react";
import {
  Check,
  Circle,
  Cpu,
  Database,
  FileBarChart,
  Loader2,
  Play,
  ShieldAlert,
  Square,
  Workflow,
  X,
} from "lucide-react";
import ConversationTrustPanel from "./ConversationTrustPanel";
import { presentRuntimeError } from "@/lib/runtimeErrorKit";
import { followUpPrompts, formatDuration, summarizeRuntimeTrace } from "@/lib/runtimeTraceSummary";
import type {
  ApprovalGrant,
  ConversationActionName,
  ConversationRuntimeEvent,
  ConversationArtifactDraft,
  GovernedToolReviewDecision,
} from "@shared/conversationRuntime";

interface Props {
  events: ConversationRuntimeEvent[];
  requestId: string | null;
  busy: boolean;
  onCancel: () => void;
  onApprove: (action: ConversationActionName, scope: ApprovalGrant["scope"]) => void;
  onDeny: (action: ConversationActionName) => void;
  /** SI-02: exact governed-tool review carries only the opaque server review id + user decision. */
  onGovernedToolReview?: (reviewId: string, decision: GovernedToolReviewDecision) => Promise<boolean>;
  allowProjectApproval: boolean;
  onMutationApply: (action: ConversationActionName) => void;
  onMutationCancel: (action: ConversationActionName) => void;
  onKeepArtifact?: (artifact: ConversationArtifactDraft) => void;
  onRecoveryAction?: (action: string) => void;
  /** Prefills the composer with a suggested next request; never sends it. */
  onFollowUp?: (prompt: string) => void;
  /** Re-sends the last request after a failed run. */
  onRetry?: () => void;
  /** Opens the optional read-only Terminal view for this exact execution session. */
  onOpenTerminal?: () => void;
  /** A saved agent run the Home reports as interrupted and resumable (after Stop or restart). Never resumed automatically. */
  resumableRequestId?: string | null;
  /** Explicit person-initiated resume of `resumableRequestId`; it carries no other input. */
  onResume?: () => void;
}

function latestByStep(events: ConversationRuntimeEvent[]) {
  const result = new Map<string, ConversationRuntimeEvent>();
  for (const event of events) {
    if ("stepId" in event && typeof event.stepId === "string" && event.stepId) {
      result.set(event.stepId, event);
    }
  }
  return result;
}

export default function ConversationRuntimeTrace({
  events,
  requestId,
  busy,
  onCancel,
  onApprove,
  onDeny,
  onGovernedToolReview,
  allowProjectApproval,
  onMutationApply,
  onMutationCancel,
  onKeepArtifact,
  onRecoveryAction,
  onFollowUp,
  onRetry,
  onOpenTerminal,
  resumableRequestId,
  onResume,
}: Props) {
  const [reviewMutationId, setReviewMutationId] = useState<string | null>(null);
  const [showWork, setShowWork] = useState(false);
  const [appliedReviewKey, setAppliedReviewKey] = useState<string | null>(null);
  const [pendingReviewKey, setPendingReviewKey] = useState<string | null>(null);
  const reviewInFlight = useRef(false);
  if (!events.length && !busy && !resumableRequestId) return null;
  const plan = [...events].reverse().find((event) => event.type === "plan");
  const approval = [...events].reverse().find((event) => event.type === "approval_required");
  const latestGovernedApproval = [...events].reverse().find((event) => event.type === "governed_tool_approval_required");
  const artifact = [...events].reverse().find((event) => event.type === "artifact");
  const mutation = [...events].reverse().find((event) => event.type === "mutation_review");
  const runtimeError = [...events].reverse().find((event) => event.type === "error");
  const dataGap = [...events].reverse().find((event) => event.type === "data_gap");
  const trust = [...events].reverse().find((event) => event.type === "trust");
  const summary = summarizeRuntimeTrace(events, busy);
  // Technical execution detail is progressive disclosure. Normal chat stays compact even while work is running.
  const workVisible = showWork;
  const followUps = onFollowUp ? followUpPrompts(summary) : [];
  const stepEvents = latestByStep(events);
  const steps = plan?.type === "plan" ? plan.plan.steps : [];
  const capabilities = plan?.type === "plan" ? plan.plan.capabilities : [];
  const done = [...events].reverse().find((event) => event.type === "done");
  const reviewKey = latestGovernedApproval?.type === "governed_tool_approval_required" ? `${latestGovernedApproval.requestId}:${latestGovernedApproval.reviewId}` : null;
  const terminal = done?.type === "done" && done.status !== "waiting_approval";
  const reviewIndex = latestGovernedApproval ? events.lastIndexOf(latestGovernedApproval) : -1;
  const continued = reviewIndex >= 0 && events.some((event, index) => index > reviewIndex && (event.type === "plan" || event.type === "tool_start"));
  const governedApproval = !terminal && !continued && reviewKey !== appliedReviewKey ? latestGovernedApproval : undefined;
  const reviewing = pendingReviewKey === reviewKey;
  const reviewTool = async (decision: GovernedToolReviewDecision) => {
    if (!onGovernedToolReview || governedApproval?.type !== "governed_tool_approval_required" || reviewInFlight.current || !reviewKey) return;
    reviewInFlight.current = true;
    setPendingReviewKey(reviewKey);
    try {
      if (await onGovernedToolReview(governedApproval.reviewId, decision)) setAppliedReviewKey(reviewKey);
    } finally {
      reviewInFlight.current = false;
      setPendingReviewKey(null);
    }
  };
  // A governed data gap ends the run with status "failed", but nothing broke: LiOS is
  // waiting for an input or source. Only a real runtime error is presented as a failure.
  const endedOnGovernedGap = done?.type === "done" && done.status === "failed" && !!dataGap && !runtimeError;
  const statusLabel = endedOnGovernedGap
    ? "Needs input"
    : runtimeError
      ? "Couldn’t complete"
      : approval || governedApproval
        ? "Needs approval"
        : busy && !terminal ? "Working"
          : done?.type === "done"
            ? done.status === "completed" ? "Done" : done.status.replaceAll("_", " ")
            : resumableRequestId ? "Stopped — can resume" : "Ready";
  const heading = runtimeError
    ? "LiOS couldn’t complete that"
    : approval || governedApproval
      ? "LiOS needs your approval"
      : endedOnGovernedGap
        ? "LiOS needs a little more information"
        : busy
          ? "LiOS is working"
          : "LiOS";

  return (
    <div className="mx-auto mb-3 max-w-3xl overflow-hidden rounded-xl border border-border/60 bg-[#080808]">
      <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-300" /> : <Cpu className="h-3.5 w-3.5 text-muted-foreground" />}
        <span className="font-ui text-[13px] font-medium text-foreground">{heading}</span>
        <span className="ml-auto font-ui text-[11px] text-muted-foreground">{statusLabel}</span>
        {summary.status !== "completed" && !!plan && (
          <button
            type="button"
            onClick={() => setShowWork((open) => !open)}
            aria-expanded={workVisible}
            className="ml-1 rounded-md px-2 py-1 font-ui text-[11px] text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
          >
            {workVisible ? "Hide details" : "Details"}
          </button>
        )}
        {onOpenTerminal && (
          <button
            type="button"
            onClick={onOpenTerminal}
            data-testid="trace-open-terminal"
            className="ml-1 rounded-md px-2 py-1 font-ui text-[11px] text-muted-foreground hover:bg-white/[0.04] hover:text-cyan-200"
          >
            Terminal
          </button>
        )}
        {busy && (
          <button
            type="button"
            onClick={onCancel}
            data-testid="agent-run-cancel"
            data-request-id={requestId ?? undefined}
            className="ml-1 flex items-center gap-1 rounded-md px-2 py-1 font-ui text-[11px] text-muted-foreground hover:bg-white/[0.04] hover:text-red-200"
          >
            <Square className="h-2.5 w-2.5 fill-current" />
            Stop
          </button>
        )}
        {!busy && resumableRequestId && onResume && (
          <button
            type="button"
            onClick={onResume}
            data-testid="agent-run-resume"
            data-request-id={resumableRequestId}
            className="ml-1 flex items-center gap-1 rounded-md border border-cyan-300/30 px-2 py-1 font-ui text-[11px] text-cyan-100 hover:bg-cyan-300/10"
          >
            <Play className="h-2.5 w-2.5 fill-current" />
            Resume
          </button>
        )}
      </div>

      {summary.status === "completed" && (
        <div className="border-b border-border/45 px-3 py-2" data-testid="trace-receipt" data-request-id={requestId ?? undefined}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-ui text-[12px] text-muted-foreground">
            <span>{summary.stepCount || summary.settledSteps} step{(summary.stepCount || summary.settledSteps) === 1 ? "" : "s"}</span>
            {summary.sources.length > 0 && <span>{summary.sources.length} source{summary.sources.length === 1 ? "" : "s"}</span>}
            {formatDuration(summary.durationMs) && <span>{formatDuration(summary.durationMs)}</span>}
            <button
              type="button"
              onClick={() => setShowWork((open) => !open)}
              aria-expanded={workVisible}
              data-testid="trace-show-work"
              className="ml-auto rounded border border-border/55 px-2 py-1 text-muted-foreground hover:text-foreground"
            >
              {workVisible ? "Hide details" : "Details"}
            </button>
          </div>
          {summary.sources.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5" data-testid="trace-sources" aria-label="Sources used">
              {summary.sources.slice(0, 6).map((source) => (
                <span key={source} className="rounded-full border border-border/55 bg-white/[0.02] px-2.5 py-1 font-ui text-[12px] text-foreground/85">{source}</span>
              ))}
              {summary.sources.length > 6 && <span className="px-1 py-1 font-ui text-[12px] text-muted-foreground">+{summary.sources.length - 6} more</span>}
            </div>
          )}
        </div>
      )}

      {workVisible && !!capabilities.length && (
        <div className="border-b border-border/45 px-3 py-2.5" data-p2-capability-resolution="true">
          <div className="flex items-center gap-2">
            <Workflow className="h-3 w-3 text-amber-300" />
            <span className="font-terminal text-[12px] uppercase tracking-[0.18em] text-muted-foreground">Resolved capabilities</span>
            <span className="ml-auto font-terminal text-[12px] text-muted-foreground">{capabilities.length} selected</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5" role="list" aria-label="LiOS resolved capabilities">
            {capabilities.map((capability) => (
              <div
                key={capability.id}
                role="listitem"
                title={capability.reason}
                className="rounded-full border border-border/55 bg-white/[0.018] px-2.5 py-1.5"
              >
                <span className="font-ui text-[12px] text-foreground">{capability.label}</span>
                <span className="ml-1.5 font-terminal text-[12px] uppercase tracking-wider text-muted-foreground">
                  {!capability.sourceScopeCompatible
                    ? "SOURCE SCOPE"
                    : capability.availability === "needs_input"
                      ? "NEEDS INPUT"
                      : capability.availability === "needs_approval"
                      ? "APPROVAL"
                      : capability.availability === "requires_ai"
                        ? "AI"
                        : capability.permissionClass === "safe_auto"
                          ? "AUTO"
                          : capability.permissionClass.replace("_", " ")}
                </span>
                {!!capability.missingInputs.length && (
                  <span className="ml-1.5 font-ui text-[12px] text-amber-200/80">
                    Needs {capability.missingInputs.map((input) => input.replaceAll("_", " ")).join(", ")}
                  </span>
                )}
                {!capability.sourceScopeCompatible && capability.sourceScopeReason && (
                  <span className="ml-1.5 font-ui text-[12px] text-amber-200/80">
                    {capability.sourceScopeReason}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {workVisible && !!steps.length && (
        <div className="grid gap-1.5 p-3 md:grid-cols-2">
          {steps.map((step) => {
            const observed = stepEvents.get(step.id);
            const complete = observed?.type === "tool_result" || (observed?.type === "status" && observed.state === "completed");
            const running = observed?.type === "tool_start" || (observed?.type === "status" && observed.state === "running");
            return (
              <div key={step.id} className="flex items-start gap-2 rounded-lg border border-border/40 bg-white/[0.012] px-2.5 py-2">
                {complete
                  ? <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-300" />
                  : running
                    ? <Loader2 className="mt-0.5 h-3 w-3 shrink-0 animate-spin text-cyan-300" />
                    : <Circle className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/50" />}
                <div className="min-w-0">
                  <div className="truncate font-ui text-[13px] text-foreground">{step.label}</div>
                  <div className="mt-0.5 font-terminal text-[12px] uppercase tracking-wider text-muted-foreground">
                    {step.kind} · {step.permissionClass.replace("_", " ")}
                  </div>
                  {observed?.type === "tool_result" && (
                    <div className="mt-1 line-clamp-2 font-ui text-[12px] leading-5 text-muted-foreground">{observed.summary}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {dataGap?.type === "data_gap" && (
        <div className="mx-3 mb-3 rounded-lg border border-amber-300/20 bg-amber-300/[0.025] px-3 py-3">
          <div className="flex items-start gap-2">
            <Database className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
            <div className="min-w-0 flex-1">
              <div className="font-ui text-[13px] font-semibold text-foreground">Data unavailable — no value invented</div>
              <div className="mt-1 font-ui text-[13px] leading-5 text-muted-foreground">{dataGap.gap.message}</div>
              {showWork && (
                <>
                  <div className="mt-2 font-ui text-[11px] text-muted-foreground/75">
                    {dataGap.gap.field.replaceAll("_", " ")} · {dataGap.gap.reason.replaceAll("_", " ")}
                  </div>
                  {!!dataGap.gap.providersChecked.length && (
                    <div className="mt-1 font-ui text-[11px] text-muted-foreground/75">Checked: {dataGap.gap.providersChecked.join(" · ")}</div>
                  )}
                </>
              )}
              {!!dataGap.gap.nextActions.length && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {dataGap.gap.nextActions.map((action) => (
                    <button
                      key={action}
                      type="button"
                      onClick={() => onRecoveryAction?.(action)}
                      className="rounded-full border border-border/55 px-2.5 py-1 font-ui text-[12px] text-muted-foreground hover:border-amber-300/25 hover:text-foreground"
                    >
                      {action}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {trust?.type === "trust" && (
        <ConversationTrustPanel manifest={trust.manifest} onRecoveryAction={onRecoveryAction} />
      )}

      {runtimeError?.type === "error" && (() => {
        const view = presentRuntimeError(runtimeError.code, runtimeError.message);
        return (
          <div className="mx-3 mb-3 rounded-lg border border-red-300/20 bg-red-300/[0.035] px-3 py-2.5" data-testid="trace-error" data-error-kind={view.kind}>
            <div className="font-ui text-[13px] font-semibold text-red-200">{view.title}</div>
            <div className="mt-1 font-ui text-[13px] leading-5 text-muted-foreground">{runtimeError.message}</div>
            <div className="mt-1 font-ui text-[12px] leading-5 text-muted-foreground/80">{view.hint}</div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {view.recoveries.includes("connect") && onRecoveryAction && (
                <button type="button" data-testid="trace-error-connect" onClick={() => onRecoveryAction("Open Connection Center")} className="rounded-full border border-border/55 px-2.5 py-1 font-ui text-[12px] text-foreground hover:border-red-300/30">Open Connect</button>
              )}
              {view.recoveries.includes("retry") && onRetry && !busy && (
                <button type="button" data-testid="trace-error-retry" onClick={onRetry} className="rounded-full border border-border/55 px-2.5 py-1 font-ui text-[12px] text-foreground hover:border-red-300/30">Try again</button>
              )}
              <span className="ml-auto font-terminal text-[12px] uppercase tracking-wider text-red-200/50">{runtimeError.code}</span>
            </div>
          </div>
        );
      })()}

      {artifact?.type === "artifact" && (
        <div className="mx-3 mb-3 flex items-center gap-2 rounded-lg border border-fuchsia-300/15 bg-fuchsia-300/[0.025] px-3 py-2">
          <FileBarChart className="h-3.5 w-3.5 text-fuchsia-300" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-ui text-[13px] text-foreground">{artifact.artifact.title}</div>
            <div className="mt-0.5 font-terminal text-[12px] uppercase tracking-wider text-muted-foreground">
              {artifact.artifact.artifactType} · {artifact.persistedArtifact ? `saved in Project · v${artifact.persistedArtifact.version}` : artifact.artifact.persistence.replace("_", " ")}
            </div>
          </div>
          {!artifact.persistedArtifact && onKeepArtifact && (
            <button onClick={() => onKeepArtifact(artifact.artifact)} className="rounded border border-fuchsia-300/20 px-2 py-1 font-ui text-[12px] text-fuchsia-200 hover:bg-fuchsia-300/[0.05]">Keep in Project</button>
          )}
        </div>
      )}


      {mutation?.type === "mutation_review" && (
        <div className="m-3 rounded-lg border border-cyan-300/20 bg-cyan-300/[0.025] p-3">
          <div className="font-ui text-[13px] font-semibold text-foreground">Review proposed change</div>
          <div className="mt-1 font-ui text-[13px] leading-5 text-muted-foreground">{mutation.proposal.summary}</div>
          {reviewMutationId === mutation.proposal.mutationId && (
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <pre className="max-h-32 overflow-auto rounded border border-border/40 bg-black/25 p-2 font-terminal text-[12px] text-muted-foreground">{JSON.stringify(mutation.proposal.before, null, 2)}</pre>
              <pre className="max-h-32 overflow-auto rounded border border-border/40 bg-black/25 p-2 font-terminal text-[12px] text-muted-foreground">{JSON.stringify(mutation.proposal.after, null, 2)}</pre>
            </div>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <button onClick={() => setReviewMutationId((current) => current === mutation.proposal.mutationId ? null : mutation.proposal.mutationId)} className="rounded border border-border/50 px-2 py-1.5 font-ui text-[12px] text-muted-foreground hover:text-foreground">
              Review
            </button>
            <button onClick={() => onMutationCancel(mutation.proposal.action)} className="rounded px-2 py-1.5 font-ui text-[12px] text-muted-foreground hover:bg-white/5 hover:text-foreground">
              Cancel
            </button>
            <button onClick={() => onMutationApply(mutation.proposal.action)} className="rounded bg-cyan-300 px-2 py-1.5 font-ui text-[12px] font-semibold text-black hover:bg-cyan-200">
              Apply
            </button>
          </div>
        </div>
      )}

      {followUps.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border/45 px-3 py-2.5" data-testid="trace-follow-ups" aria-label="Suggested next steps">
          <span className="font-terminal text-[12px] uppercase tracking-wider text-muted-foreground">Next</span>
          {followUps.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => onFollowUp?.(prompt)}
              className="rounded-full border border-border/55 px-2.5 py-1 font-ui text-[12px] text-muted-foreground hover:border-amber-300/30 hover:text-foreground"
            >
              {prompt}
            </button>
          ))}
        </div>
      )}

      {governedApproval?.type === "governed_tool_approval_required" && (
        <div className="m-3 rounded-lg border border-amber-300/20 bg-amber-300/[0.035] p-3" data-testid="governed-tool-approval" data-request-id={governedApproval.requestId} data-review-id={governedApproval.reviewId}>
          <div className="flex items-start gap-2">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
            <div className="min-w-0 flex-1">
              <div className="font-ui text-[13px] font-semibold text-foreground">Approval required · {governedApproval.label}</div>
              <div className="mt-1 font-ui text-[13px] leading-5 text-muted-foreground">{governedApproval.message}</div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            {governedApproval.choices.includes("deny") && (
              <button
                onClick={() => void reviewTool("deny")}
                disabled={!onGovernedToolReview || reviewing}
                className="flex items-center gap-1 rounded px-2 py-1.5 font-ui text-[12px] text-muted-foreground hover:bg-white/5 hover:text-foreground disabled:opacity-50"
              >
                <X className="h-2.5 w-2.5" /> Deny
              </button>
            )}
            {governedApproval.choices.includes("allow_once") && (
              <button
                onClick={() => void reviewTool("allow_once")}
                data-testid="governed-tool-allow-once"
                data-request-id={governedApproval.requestId}
                data-review-id={governedApproval.reviewId}
                disabled={!onGovernedToolReview || reviewing}
                className="rounded border border-amber-300/20 px-2 py-1.5 font-ui text-[12px] text-amber-200 hover:bg-amber-300/[0.06] disabled:opacity-50"
              >
                Allow once
              </button>
            )}
            {allowProjectApproval && governedApproval.choices.includes("allow_project") && (
              <button
                onClick={() => void reviewTool("allow_project")}
                disabled={!onGovernedToolReview || reviewing}
                className="rounded bg-amber-300 px-2 py-1.5 font-ui text-[12px] font-semibold text-black hover:bg-amber-200 disabled:opacity-50"
              >
                Allow for Project
              </button>
            )}
            {reviewing && <span role="status" className="font-ui text-xs text-muted-foreground">Applying your review to this run…</span>}
          </div>
        </div>
      )}

      {approval?.type === "approval_required" && (
        <div className="m-3 rounded-lg border border-amber-300/20 bg-amber-300/[0.035] p-3">
          <div className="flex items-start gap-2">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
            <div className="min-w-0 flex-1">
              <div className="font-ui text-[13px] font-semibold text-foreground">Approval required</div>
              <div className="mt-1 font-ui text-[13px] leading-5 text-muted-foreground">{approval.message}</div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button onClick={() => onDeny(approval.action)} className="flex items-center gap-1 rounded px-2 py-1.5 font-ui text-[12px] text-muted-foreground hover:bg-white/5 hover:text-foreground">
              <X className="h-2.5 w-2.5" /> Deny
            </button>
            <button onClick={() => onApprove(approval.action, "once")} className="rounded border border-amber-300/20 px-2 py-1.5 font-ui text-[12px] text-amber-200 hover:bg-amber-300/[0.06]">
              Allow once
            </button>
            {allowProjectApproval && (
              <button onClick={() => onApprove(approval.action, "project")} className="rounded bg-amber-300 px-2 py-1.5 font-ui text-[12px] font-semibold text-black hover:bg-amber-200">
                Allow for Project
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

