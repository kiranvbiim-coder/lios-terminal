import type { ConversationRuntimeEvent, WorkflowStep } from "@shared/conversationRuntime";

export type RecordedAgentStepState =
  | "queued" | "running" | "awaiting_approval" | "reported_complete"
  | "reported_failed" | "skipped" | "denied" | "cancel_requested"
  | "cancelled" | "unconfirmed";

export interface RecordedAgentStep {
  id: string;
  label: string;
  kind: WorkflowStep["kind"];
  permissionClass: WorkflowStep["permissionClass"];
  state: RecordedAgentStepState;
  /** One event report is not an execution receipt and never grants approval. */
  source: "plan" | "status" | "tool_result" | "governed_review" | "run_terminal";
}

export const RECORDED_AGENT_STEP_LABELS: Record<RecordedAgentStepState,string> = {
  queued:"Queued — no execution report",
  running:"Running — not finished",
  awaiting_approval:"Awaiting your decision",
  reported_complete:"Reported complete — check receipt",
  reported_failed:"Tool reported failure",
  skipped:"Skipped",
  denied:"Denied",
  cancel_requested:"Stop requested — not confirmed",
  cancelled:"Cancelled",
  unconfirmed:"No confirmed result",
};

/**
 * C04 display-only projection of a single run's *recorded* plan and events.
 * A plan, tool-start, missing outcome or overall 'done' never proves an
 * individual action finished. P2 execution receipts and SI-02 server approval
 * remain the only execution/permission authorities.
 */
export function projectRecordedAgentSteps(
  events: readonly ConversationRuntimeEvent[],
  requestId: string | null,
  options: {busy:boolean;stopRequested?:boolean} = {busy:false},
): RecordedAgentStep[] {
  if (!requestId) return [];
  let lastPlanIndex=-1;
  for(let i=0;i<events.length;i++) {
    if(events[i].requestId===requestId && events[i].type==="plan") lastPlanIndex=i;
  }
  if(lastPlanIndex<0) return [];
  const plan=events[lastPlanIndex];
  if(plan.type!=="plan") return [];
  const steps=plan.plan.steps.slice(0,50);
  const byId=new Map(steps.map(step=>[step.id,step]));
  const latest=new Map<string,{kind:"status"|"tool_start"|"tool_result";event:ConversationRuntimeEvent;index:number}>();
  let pendingReview: {index:number;stepId:string}|null=null;
  let done:Extract<ConversationRuntimeEvent,{type:"done"}>|null=null;
  for(let i=lastPlanIndex+1;i<events.length;i++) {
    const event=events[i];
    if(event.requestId!==requestId) continue;
    if(event.type==="done") {done=event;continue;}
    if(event.type==="governed_tool_approval_required") {
      const stepId=event.reviewBinding?.stepId;
      if(stepId && byId.has(stepId)) pendingReview={index:i,stepId};
      continue;
    }
    if(event.type==="status" || event.type==="tool_start" || event.type==="tool_result") {
      const stepId=event.stepId;
      if(stepId && byId.has(stepId)) latest.set(stepId,{kind:event.type,event,index:i});
    }
  }
  const terminal=done?.status==="cancelled" || done?.status==="failed" || done?.status==="completed";
  return steps.map(step=>{
    const recorded=latest.get(step.id);
    let state:RecordedAgentStepState="queued";
    let source:RecordedAgentStep["source"]="plan";
    if(recorded) {
      source=recorded.kind==="tool_result"?"tool_result":"status";
      const event=recorded.event;
      if(event.type==="tool_result") {
        state=event.outcome==="completed" ? "reported_complete"
          : event.outcome==="failed" ? "reported_failed"
          : event.outcome==="skipped" ? "skipped"
          : event.outcome==="denied" ? "denied"
          : event.outcome==="approval_required" ? "awaiting_approval"
          : "unconfirmed";
      } else if(event.type==="status") {
        state=event.state==="completed" ? "reported_complete"
          : event.state==="cancelled" ? "cancelled"
          : event.state==="running" ? "running" : "queued";
      } else {
        state="running";
      }
    }
    // An exact-binding review is not evidence of permission. It is active
    // only until that same step receives a subsequent event/terminal result.
    if(pendingReview?.stepId===step.id &&
      (!recorded || recorded.index<pendingReview.index) &&
      (!done || done.status==="waiting_approval")) {
      state="awaiting_approval";
      source="governed_review";
    }
    if(state==="running" || state==="queued" || state==="awaiting_approval") {
      if(done?.status==="cancelled") {state="cancelled";source="run_terminal";}
      else if(terminal || (!options.busy && done?.status!=="waiting_approval")) {
        state="unconfirmed";source="run_terminal";
      } else if(options.stopRequested && state==="running") {
        state="cancel_requested";
      }
    }
    // Do not upgrade existing explicit failures/denials to a green state when
    // the overall run's done status happens to be completed.
    return {id:step.id,label:step.label,kind:step.kind,
      permissionClass:step.permissionClass,state,source};
  });
}
