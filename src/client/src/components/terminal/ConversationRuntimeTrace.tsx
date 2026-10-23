import * as React from "react";
import { useId, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Circle,
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
import ProfessionalAssumptionsForm from "./ProfessionalAssumptionsForm";
import { P5_GUIDED_INPUTS_ACTION } from "@shared/p5GuidedInputs";
import { presentRuntimeError } from "@/lib/runtimeErrorKit";
import { followUpPrompts, formatDuration, summarizeRuntimeTrace } from "@/lib/runtimeTraceSummary";
import type {
  ApprovalGrant,
  ConversationActionName,
  ConversationRuntimeEvent,
  ConversationArtifactDraft,
  GovernedToolReviewDecision,
} from "@shared/conversationRuntime";
import type { TrustManifest } from "@shared/trustContracts";

interface Props {
  events: ConversationRuntimeEvent[];
  requestId: string | null;
  busy: boolean;
  cancelPending?: boolean;
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
  /** Opens the optional read-only Terminal view for this exact execution session. Offered only inside Show Work. */
  onOpenTerminal?: () => void;
  /** A saved agent run the Home reports as interrupted and resumable (after Stop or restart). Never resumed automatically. */
  resumableRequestId?: string | null;
  /** Explicit person-initiated resume of `resumableRequestId`; it carries no other input. */
  onResume?: () => void;
  /** Start with the Show work disclosure open. Defaults to closed so ordinary chats stay quiet. */
  defaultShowWork?: boolean;
  /** Sends the plain-language assumptions confirmed in the guided inputs form through the normal chat path. */
  onSubmitAssumptions?: (message: string) => void;
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

/** Source limitations the person must always see: missing evidence, conflicts, warnings, low quality. */
export function trustCaveats(manifest: TrustManifest, shownGap?: { field: string; message: string }): { lines: string[]; recoveryActions: string[] } | null {
  const lines: string[] = [];
  const recoveryActions: string[] = [];
  for (const missing of manifest.missing) {
    if (shownGap && (missing.field === shownGap.field || missing.reason.includes(shownGap.message))) continue;
    lines.push(`${missing.field.replaceAll("_", " ")} is unavailable: ${missing.reason}`);
    for (const action of missing.recoveryActions) if (!recoveryActions.includes(action)) recoveryActions.push(action);
  }
  for (const conflict of manifest.conflicts) lines.push(`${conflict.field.replaceAll("_", " ")}: ${conflict.summary}`);
  for (const warning of manifest.warnings) {
    if (!shownGap || !warning.includes(shownGap.message)) lines.push(warning);
  }
  if (manifest.summary.quality === "low") lines.push("The supporting data is low quality. Treat the figures with caution.");
  return lines.length ? { lines, recoveryActions } : null;
}

function readableValue(value: unknown): string {
  if (value === null || value === undefined) return "none";
  if (typeof value === "string") return value.length > 160 ? `${value.slice(0, 157)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (value.length <= 5 && value.every((item) => item === null || ["string", "number", "boolean"].includes(typeof item))) return value.map((item) => readableValue(item)).join(", ") || "empty";
    return `${value.length} item${value.length === 1 ? "" : "s"}`;
  }
  const fields = Object.keys(value as Record<string, unknown>).length;
  return `${fields} field${fields === 1 ? "" : "s"}`;
}

const isPlainRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const humanizeKey = (key: string) => key.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ");
const MAX_CHANGE_ROWS = 12;

/**
 * Human-readable "field: before → after" rows for a proposed change; never raw JSON. Compares the union of keys so
 * additions, removals and edits all show, and looks one level into nested objects so a nested edit names the field
 * that changed. Rows beyond the cap are counted in `hidden` so the list is never silently truncated.
 */
export function describeProposedChanges(before: Record<string, unknown> | null, after: Record<string, unknown>): { rows: Array<{ label: string; before: string; after: string }>; hidden: number } {
  const all: Array<{ label: string; before: string; after: string }> = [];
  const push = (label: string, previous: unknown, next: unknown) => {
    if (JSON.stringify(previous) === JSON.stringify(next)) return;
    all.push({ label, before: previous === undefined ? "none" : readableValue(previous), after: next === undefined ? "removed" : readableValue(next) });
  };
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after)])];
  for (const key of keys) {
    const previous = before?.[key];
    const next = after[key];
    if (isPlainRecord(previous) && isPlainRecord(next)) {
      for (const child of new Set([...Object.keys(previous), ...Object.keys(next)])) push(`${humanizeKey(key)} › ${humanizeKey(child)}`, previous[child], next[child]);
    } else {
      push(humanizeKey(key), previous, next);
    }
  }
  return { rows: all.slice(0, MAX_CHANGE_ROWS), hidden: Math.max(0, all.length - MAX_CHANGE_ROWS) };
}

export default function ConversationRuntimeTrace({
  events,
  requestId,
  busy,
  cancelPending = false,
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
  defaultShowWork = false,
  onSubmitAssumptions,
}: Props) {
  const [showWork, setShowWork] = useState(defaultShowWork);
  const [appliedReviewKey, setAppliedReviewKey] = useState<string | null>(null);
  const [pendingReviewKey, setPendingReviewKey] = useState<string | null>(null);
  const reviewInFlight = useRef(false);
  const [guidedDismissedKey, setGuidedDismissedKey] = useState<string | null>(null);
  const workPanelId = useId();
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
  const observedReceipt = [...events].reverse().find(event => event.type === "receipt");
  // Quiet by default: ordinary runs show only Working + Stop. Technical execution detail is progressive
  // disclosure; approvals, errors, data gaps, source caveats and review-required items are never hidden.
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
  const caveats = trust?.type === "trust" ? trustCaveats(trust.manifest, dataGap?.type === "data_gap" ? dataGap.gap : undefined) : null;
  const guided = dataGap?.type === "data_gap" ? dataGap.gap.guidedInputs : undefined;
  const guidedKey = guided && dataGap ? `${dataGap.requestId}:${guided.modelPath}` : null;
  const guidedOpen = guidedKey !== null && guidedDismissedKey !== guidedKey;
  // The guided form behind the "tell LiOS the assumptions" action opens in place instead of leaving the chat.
  const recover = (action: string) => {
    if (action === P5_GUIDED_INPUTS_ACTION && guided) { setGuidedDismissedKey(null); return; }
    onRecoveryAction?.(action);
  };
  const unsavedArtifact = artifact?.type === "artifact" && !artifact.persistedArtifact ? artifact : null;
  const working = busy && !terminal;
  const waitingForApproval = Boolean(approval || governedApproval);
  const canShowWork = !!plan || !!observedReceipt || trust?.type === "trust" || summary.sources.length > 0;
  const canResume = !busy && !!resumableRequestId && !!onResume;
  const stepCount = summary.stepCount || summary.settledSteps;
  const duration = formatDuration(summary.durationMs);
  const quietControlClass = "inline-flex min-h-7 items-center gap-1 rounded-md px-2 py-1 font-ui text-[12px] text-muted-foreground hover:bg-white/[0.04] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/50";

  return (
    <div className="mx-auto mb-2 max-w-3xl" data-testid="conversation-trace">
      {(working || canResume || canShowWork) && (
        <div
          className="flex flex-wrap items-center gap-1.5 px-1 py-0.5 font-ui text-[12px] text-muted-foreground"
          data-testid={summary.status === "completed" && observedReceipt?.type === "receipt" ? "trace-receipt" : undefined}
          data-request-id={requestId ?? undefined}
        >
          {working && (
            <span role="status" className="inline-flex items-center gap-1.5 px-1">
              <Loader2 className="h-3 w-3 animate-spin text-cyan-300" aria-hidden="true" />
              {waitingForApproval ? "Waiting for your approval" : "Working"}
            </span>
          )}
          {working && (
            <button
              type="button"
              onClick={onCancel}
              disabled={cancelPending}
              aria-label={cancelPending ? "Stop request pending Home acknowledgement" : "Stop this exact run"}
              data-testid="agent-run-cancel"
              data-request-id={requestId ?? undefined}
              className={`${quietControlClass} hover:text-red-200`}
            >
              <Square className="h-2.5 w-2.5 fill-current" aria-hidden="true" />
              {cancelPending ? "Requesting Stop…" : "Stop"}
            </button>
          )}
          {canResume && (
            <>
              <span className="px-1">Stopped</span>
              <button
                type="button"
                onClick={onResume}
                data-testid="agent-run-resume"
                data-request-id={resumableRequestId}
                className="inline-flex min-h-7 items-center gap-1 rounded-md border border-cyan-300/30 px-2 py-1 font-ui text-[12px] text-cyan-100 hover:bg-cyan-300/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/50"
              >
                <Play className="h-2.5 w-2.5 fill-current" aria-hidden="true" />
                Resume
              </button>
            </>
          )}
          {canShowWork && (
            <button
              type="button"
              onClick={() => setShowWork((open) => !open)}
              aria-expanded={workVisible}
              aria-controls={workPanelId}
              data-testid="trace-show-work"
              className={quietControlClass}
            >
              Show work
              {workVisible ? <ChevronUp className="h-3 w-3" aria-hidden="true" /> : <ChevronDown className="h-3 w-3" aria-hidden="true" />}
            </button>
          )}
        </div>
      )}

      <div id={workPanelId} className={workVisible ? "mb-2 space-y-2 rounded-xl border border-border/50 bg-[#080808] p-3" : undefined}>
        {workVisible && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-ui text-[12px] text-muted-foreground" data-testid="trace-work-summary">
            {stepCount > 0 && <span>{stepCount} step{stepCount === 1 ? "" : "s"}</span>}
            {summary.sources.length > 0 && <span>{summary.sources.length} source{summary.sources.length === 1 ? "" : "s"}</span>}
            {duration && <span>{duration}</span>}
            {requestId && <span className="font-terminal">Run {requestId}</span>}
            {onOpenTerminal && (
              <button
                type="button"
                onClick={onOpenTerminal}
                data-testid="trace-open-terminal"
                className={`${quietControlClass} ml-auto hover:text-cyan-200`}
              >
                Open sandbox Terminal
              </button>
            )}
          </div>
        )}

        {workVisible && summary.sources.length > 0 && (
          <div className="flex flex-wrap gap-1.5" data-testid="trace-sources" aria-label="Sources used">
            {summary.sources.slice(0, 6).map((source) => (
              <span key={source} className="rounded-full border border-border/55 bg-white/[0.02] px-2.5 py-1 font-ui text-[12px] text-foreground/85">{source}</span>
            ))}
            {summary.sources.length > 6 && <span className="px-1 py-1 font-ui text-[12px] text-muted-foreground">+{summary.sources.length - 6} more</span>}
          </div>
        )}

        {workVisible && !!capabilities.length && (
          <div className="border-t border-border/45 pt-2.5" data-p2-capability-resolution="true">
            <div className="flex items-center gap-2">
              <Workflow className="h-3 w-3 text-amber-300" aria-hidden="true" />
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
          <div className="grid gap-1.5 md:grid-cols-2">
            {steps.map((step) => {
              const observed = stepEvents.get(step.id);
              const complete = observed?.type === "tool_result" || (observed?.type === "status" && observed.state === "completed");
              const running = observed?.type === "tool_start" || (observed?.type === "status" && observed.state === "running");
              return (
                <div key={step.id} className="flex items-start gap-2 rounded-lg border border-border/40 bg-white/[0.012] px-2.5 py-2">
                  {complete
                    ? <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-300" aria-hidden="true" />
                    : running
                      ? <Loader2 className="mt-0.5 h-3 w-3 shrink-0 animate-spin text-cyan-300" aria-hidden="true" />
                      : <Circle className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/50" aria-hidden="true" />}
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

        {workVisible && trust?.type === "trust" && (
          <ConversationTrustPanel manifest={trust.manifest} onRecoveryAction={recover} />
        )}

        {workVisible && artifact?.type === "artifact" && artifact.persistedArtifact && (
          <div className="flex items-center gap-2 font-ui text-[12px] text-muted-foreground" data-testid="trace-saved-artifact">
            <FileBarChart className="h-3 w-3 text-fuchsia-300" aria-hidden="true" />
            <span className="min-w-0 truncate">{artifact.artifact.title} · saved in {artifact.artifact.projectId === null ? "Chat" : "Project"} · v{artifact.persistedArtifact.version}</span>
          </div>
        )}

        {workVisible && followUps.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border/45 pt-2.5" data-testid="trace-follow-ups" aria-label="Suggested next steps">
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
      </div>

      {caveats && (
        <div className="mb-2 rounded-lg border border-amber-300/20 bg-amber-300/[0.025] px-3 py-2.5" role="note" data-testid="trace-source-caveats">
          <div className="font-ui text-[13px] font-semibold text-foreground">Source limitations</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 font-ui text-[13px] leading-5 text-muted-foreground">
            {caveats.lines.slice(0, 4).map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}
            {caveats.lines.length > 4 && <li>{caveats.lines.length - 4} more — open Show work for the full list.</li>}
          </ul>
          {!!caveats.recoveryActions.length && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {caveats.recoveryActions.map((action) => (
                <button
                  key={action}
                  type="button"
                  onClick={() => recover(action)}
                  className="rounded-full border border-border/55 px-2.5 py-1 font-ui text-[12px] text-muted-foreground hover:border-amber-300/25 hover:text-foreground"
                >
                  {action}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {dataGap?.type === "data_gap" && (
        <div className="mb-2 rounded-lg border border-amber-300/20 bg-amber-300/[0.025] px-3 py-3" data-testid="trace-data-gap">
          <div className="flex items-start gap-2">
            <Database className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="font-ui text-[13px] font-semibold text-foreground">{guided ? "A few more model inputs are needed" : "Data unavailable — no value invented"}</div>
              {dataGap.gap.message.length > 260 ? (
                <details className="mt-1 text-[13px] leading-5 text-muted-foreground"><summary className="cursor-pointer">{guided ? "Review the missing or unclear inputs below" : "Read the source limitation"}</summary><p className="mt-2">{dataGap.gap.message}</p></details>
              ) : <p className="mt-1 font-ui text-[13px] leading-5 text-muted-foreground">{dataGap.gap.message}</p>}
              {showWork && (
                <>
                  <div className="mt-2 font-ui text-[12px] text-muted-foreground/75">
                    {dataGap.gap.field.replaceAll("_", " ")} · {dataGap.gap.reason.replaceAll("_", " ")}
                  </div>
                  {!!dataGap.gap.providersChecked.length && (
                    <div className="mt-1 font-ui text-[12px] text-muted-foreground/75">Checked: {dataGap.gap.providersChecked.join(" · ")}</div>
                  )}
                </>
              )}
              {!!dataGap.gap.nextActions.length && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {dataGap.gap.nextActions.map((action) => (
                    <button
                      key={action}
                      type="button"
                      onClick={() => recover(action)}
                      className="rounded-full border border-border/55 px-2.5 py-1 font-ui text-[12px] text-muted-foreground hover:border-amber-300/25 hover:text-foreground"
                    >
                      {action}
                    </button>
                  ))}
                </div>
              )}
              {guided && guidedOpen && (
                <ProfessionalAssumptionsForm guided={guided} busy={busy} onSubmit={(message) => onSubmitAssumptions?.(message)} onCancel={() => setGuidedDismissedKey(guidedKey)} />
              )}
            </div>
          </div>
        </div>
      )}

      {runtimeError?.type === "error" && !(dataGap?.type === "data_gap" && (presentRuntimeError(runtimeError.code, runtimeError.message).kind === "input_required" || runtimeError.message === dataGap.gap.message)) && (() => {
        const view = presentRuntimeError(runtimeError.code, runtimeError.message);
        return (
          <div className="mb-2 rounded-lg border border-red-300/20 bg-red-300/[0.035] px-3 py-2.5" role="alert" data-testid="trace-error" data-error-kind={view.kind}>
            <div className="font-ui text-[13px] font-semibold text-red-200">{view.title}</div>
            <div className="mt-1 font-ui text-[13px] leading-5 text-muted-foreground">{runtimeError.message}</div>
            <div className="mt-1 font-ui text-[12px] leading-5 text-muted-foreground/80">{view.hint}</div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {view.recoveries.includes("connect") && onRecoveryAction && (
                <button type="button" data-testid="trace-error-connect" onClick={() => onRecoveryAction("Open Connection Center")} className="rounded-full border border-border/55 px-2.5 py-1 font-ui text-[12px] text-foreground hover:border-red-300/30">Open Connect</button>
              )}
              {view.recoveries.includes("retry") && onRetry && !busy && (
                <button type="button" data-testid="trace-error-retry" onClick={onRetry} className="min-h-10 rounded-full border border-border/55 px-3 py-2 font-ui text-[12px] text-foreground hover:border-red-300/30 focus-visible:outline focus-visible:outline-2">Review request</button>
              )}
              {showWork && <span className="ml-auto font-terminal text-[12px] uppercase tracking-wider text-red-200/50">{runtimeError.code}</span>}
            </div>
          </div>
        );
      })()}

      {summary.status === "interrupted" && (
        <div role="alert" data-testid="trace-interrupted" className="mb-2 rounded-lg border border-amber-300/25 bg-amber-300/[0.035] px-3 py-2.5 font-ui text-[13px]">
          <p className="font-semibold text-amber-100">This run has no confirmed final status.</p>
          <p className="mt-1 text-muted-foreground">The connection or observer ended before a final Home event. Partial text is not a completed answer or an execution receipt. Check the Home run before considering any retry.</p>
          {onRetry && <button type="button" onClick={onRetry} className="mt-2 min-h-10 rounded border border-amber-300/40 px-3 py-2 text-amber-100 focus-visible:outline focus-visible:outline-2">Review previous request</button>}
        </div>
      )}
      {summary.status === "completed" && !observedReceipt && (
        <p role="status" data-testid="trace-receipt-missing" className="mb-2 px-2 font-ui text-xs text-muted-foreground">Home reported completion; a separate execution receipt was not received in this view.</p>
      )}

      {!runtimeError && !dataGap && !approval && !governedApproval && done?.type === "done" && (done.status === "failed" || (done.status === "cancelled" && !canResume)) && (
        <div className="mb-2 rounded-lg border border-border/60 bg-white/[0.02] px-3 py-2 font-ui text-[13px] text-muted-foreground" role="status" data-testid="trace-run-status" data-run-status={done.status}>
          {done.status === "failed"
            ? "This run didn’t complete and produced no result. Nothing was changed. You can try again."
            : "This run was stopped before it finished. Any partial answer above may be incomplete."}
        </div>
      )}

      {unsavedArtifact && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-fuchsia-300/15 bg-fuchsia-300/[0.025] px-3 py-2" data-testid="trace-keep-artifact">
          <FileBarChart className="h-3.5 w-3.5 text-fuchsia-300" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-ui text-[13px] text-foreground">{unsavedArtifact.artifact.title}</div>
            <div className="mt-0.5 font-ui text-[12px] text-muted-foreground">{onKeepArtifact ? "Not saved yet" : "Not saved — saving isn’t available in this chat"}</div>
          </div>
          {onKeepArtifact && (
            <button type="button" onClick={() => onKeepArtifact(unsavedArtifact.artifact)} className="rounded border border-fuchsia-300/20 px-2 py-1 font-ui text-[12px] text-fuchsia-200 hover:bg-fuchsia-300/[0.05]">{unsavedArtifact.artifact.persistence === "chat_candidate" ? "Keep in Chat" : "Keep in Project"}</button>
          )}
        </div>
      )}

      {mutation?.type === "mutation_review" && (() => {
        const changes = describeProposedChanges(mutation.proposal.before, mutation.proposal.after);
        return (
          <div className="mb-2 rounded-lg border border-cyan-300/20 bg-cyan-300/[0.025] p-3" data-testid="trace-mutation-review">
            <div className="font-ui text-[13px] font-semibold text-foreground">Review proposed change</div>
            <div className="mt-1 font-ui text-[13px] leading-5 text-muted-foreground">{mutation.proposal.summary}</div>
            {changes.rows.length > 0 ? (
              <ul className="mt-2 space-y-1 rounded border border-border/40 bg-black/25 p-2 font-ui text-[13px] text-muted-foreground" aria-label="Proposed changes">
                {changes.rows.map((row, index) => (
                  <li key={`${index}-${row.label}`}><span className="capitalize text-foreground">{row.label}</span>: {row.before} → {row.after}</li>
                ))}
                {changes.hidden > 0 && <li>+{changes.hidden} more change{changes.hidden === 1 ? "" : "s"}</li>}
              </ul>
            ) : (
              <p className="mt-2 font-ui text-[13px] text-muted-foreground">No field-level differences were reported. Apply only if the summary above is what you intend.</p>
            )}
            <details className="mt-2 rounded border border-border/40 bg-black/25 p-2 font-ui text-[13px] text-muted-foreground" data-testid="trace-mutation-exact">
              <summary className="cursor-pointer text-foreground">Exact before and after values</summary>
              <div className="mt-2 text-[12px] uppercase tracking-wide">Before</div>
              <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-all font-mono text-[12px]" data-testid="trace-mutation-exact-before">{JSON.stringify(mutation.proposal.before, null, 2)}</pre>
              <div className="mt-2 text-[12px] uppercase tracking-wide">After</div>
              <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-all font-mono text-[12px]" data-testid="trace-mutation-exact-after">{JSON.stringify(mutation.proposal.after, null, 2)}</pre>
            </details>
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => onMutationCancel(mutation.proposal.action)} className="rounded px-2 py-1.5 font-ui text-[12px] text-muted-foreground hover:bg-white/5 hover:text-foreground">
                Cancel
              </button>
              <button type="button" onClick={() => onMutationApply(mutation.proposal.action)} className="rounded bg-cyan-300 px-2 py-1.5 font-ui text-[12px] font-semibold text-black hover:bg-cyan-200">
                Apply
              </button>
            </div>
          </div>
        );
      })()}

      {governedApproval?.type === "governed_tool_approval_required" && (
        <div className="mb-2 rounded-lg border border-amber-300/20 bg-amber-300/[0.035] p-3" data-testid="governed-tool-approval" data-request-id={governedApproval.requestId} data-review-id={governedApproval.reviewId}>
          <div className="flex items-start gap-2">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="font-ui text-[13px] font-semibold text-foreground">Approval required · {governedApproval.label}</div>
              <div className="mt-1 font-ui text-[13px] leading-5 text-muted-foreground">{governedApproval.message}</div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            {governedApproval.choices.includes("deny") && (
              <button
                type="button"
                onClick={() => void reviewTool("deny")}
                disabled={!onGovernedToolReview || reviewing}
                className="flex items-center gap-1 rounded px-2 py-1.5 font-ui text-[12px] text-muted-foreground hover:bg-white/5 hover:text-foreground disabled:opacity-50"
              >
                <X className="h-2.5 w-2.5" aria-hidden="true" /> Deny
              </button>
            )}
            {governedApproval.choices.includes("allow_once") && (
              <button
                type="button"
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
                type="button"
                onClick={() => void reviewTool("allow_project")}
                disabled={!onGovernedToolReview || reviewing}
                className="rounded bg-amber-300 px-2 py-1.5 font-ui text-[12px] font-semibold text-black hover:bg-amber-200 disabled:opacity-50"
              >
                Allow for Project
              </button>
            )}
            {reviewing && <span role="status" className="font-ui text-[12px] text-muted-foreground">Applying your review to this run…</span>}
          </div>
        </div>
      )}

      {approval?.type === "approval_required" && (
        <div className="mb-2 rounded-lg border border-amber-300/20 bg-amber-300/[0.035] p-3" data-testid="trace-approval">
          <div className="flex items-start gap-2">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="font-ui text-[13px] font-semibold text-foreground">Approval required</div>
              <div className="mt-1 font-ui text-[13px] leading-5 text-muted-foreground">{approval.message}</div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => onDeny(approval.action)} className="flex items-center gap-1 rounded px-2 py-1.5 font-ui text-[12px] text-muted-foreground hover:bg-white/5 hover:text-foreground">
              <X className="h-2.5 w-2.5" aria-hidden="true" /> Deny
            </button>
            <button type="button" onClick={() => onApprove(approval.action, "once")} className="rounded border border-amber-300/20 px-2 py-1.5 font-ui text-[12px] text-amber-200 hover:bg-amber-300/[0.06]">
              Allow once
            </button>
            {allowProjectApproval && (
              <button type="button" onClick={() => onApprove(approval.action, "project")} className="rounded bg-amber-300 px-2 py-1.5 font-ui text-[12px] font-semibold text-black hover:bg-amber-200">
                Allow for Project
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
