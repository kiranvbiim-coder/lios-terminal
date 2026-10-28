import type { P7Insight } from "@shared/p7ResearchContracts";
import type { ConsequenceReview } from "./recordedConsequenceReview";
import { quickMonitorDraft } from "./workflowReviewTruth";

/** Admit a local review into the existing paused P9 monitor surface; never a Chat prompt or execution grant. */
export function reviewedProjectMonitorHandoff(
  projectId: number, insight: P7Insight, review: ConsequenceReview,
): {status:"ready"; projectId:number; graphHash:string; name:string; intervalMinutes:number} |
   {status:"blocked"; reason:string} {
  if(!Number.isSafeInteger(projectId) || projectId<=0 || review.status!=="ready" ||
    !/^[a-f0-9]{64}$/.test(review.graphHash ?? "") || !insight.id ||
    !Array.isArray(insight.sourceRefs) || insight.sourceRefs.length===0) {
    return {status:"blocked",reason:"Project-linked recorded evidence is required before proposing an automation draft."};
  }
  // Canonical P9 contract owns actual template, alert channels and interval
  // range. The UI never writes this definition or starts its scheduler.
  const definition=quickMonitorDraft("changes",false,60);
  if(definition.action.kind!=="project_what_changed" || definition.trigger.type!=="schedule" ||
     definition.trigger.schedule.kind!=="interval" || definition.enabled) {
    return {status:"blocked",reason:"The reviewed P9 Project monitor template is unavailable."};
  }
  return {status:"ready",projectId,graphHash:review.graphHash!,name:definition.name,
    intervalMinutes:definition.trigger.schedule.everyMinutes};
}
