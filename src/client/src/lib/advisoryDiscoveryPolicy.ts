import type { WorkspaceAudience } from "./featureRegistry";

/**
 * Phase 4: service discovery is a quiet, explicitly commercial part of the
 * existing product, not a behavioral advertising system. Do not derive its
 * visibility from private prompts, financial positions, evidence, AI output
 * or product telemetry. No timer, conversion pixel or pop-up.
 */
export interface AdvisoryInviteContext {
  audience: WorkspaceAudience;
  surface: "project-home" | "chat" | "workbench";
  dismissedInSession: boolean;
  focusMode?: boolean;
  presentationMode?: boolean;
  projectBusy?: boolean;
}

export function mayShowQuietAdvisoryInvite(context: AdvisoryInviteContext): boolean {
  return context.audience === "client" && context.surface === "project-home"
    && !context.dismissedInSession && !context.focusMode
    && !context.presentationMode && !context.projectBusy;
}

/** These are descriptions of existing request templates, not invented results. */
export const ADVISORY_SERVICE_EXPLANATIONS = Object.freeze({
  investment_decision: "Independent review of a thesis, assumptions, downside risks and decision criteria.",
  market_entry: "Structured market entry questions, competitive landscape and delivery priorities.",
  ma_intelligence: "Acquisition rationale, target diligence questions and decision-readiness.",
} as const);

export const ADVISORY_SERVICE_STEPS = Object.freeze([
  "Share a brief that you choose to submit.",
  "Review the proposed scope, quote and turnaround before accepting.",
  "Track any accepted engagement in the existing Advisory workspace.",
] as const);
