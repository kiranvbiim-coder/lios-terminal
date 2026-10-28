import type { P7Insight } from "@shared/p7ResearchContracts";
import type { ConsequenceReview } from "./recordedConsequenceReview";
import { quickMonitorDraft } from "./workflowReviewTruth";

/** C07 creates a *review prompt*, not a scheduled/created P9 workflow.
 * The existing Project Automation UI and server own any eventual write.
 */
export function reviewedProjectMonitorHandoff(
  projectId: number, insight: P7Insight, review: ConsequenceReview,
): {status:"ready"; prompt:string; name:string; intervalMinutes:number} |
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
  const prompt=[
    "Help me REVIEW a possible Project what-changed automation. This is a draft request, not authorization to create or run an automation.",
    `Project ID: ${projectId}. Exact recorded P7 graph SHA-256: ${review.graphHash}.`,
    "Monitor scope: Project Intelligence changes, not a claim-specific alert or individual economic exposure.",
    `Proposed P9 template: ${definition.template}. Action: ${definition.action.kind}. Suggested interval: ${definition.trigger.schedule.everyMinutes} minutes. Enabled: false.`,
    "Recheck current Project ownership, source rights, recorded evidence, notification policy, available Home scheduler and actual requested frequency.",
    "Show exact trigger, destination, expected notifications, limits and permissions for my approval.",
    "Do not create or enable an automation, run the workflow, send a notification, change Project data or grant access until I explicitly confirm the reviewed P9 definition.",
    "If P9 cannot represent this desired monitor or source access fails, explain the limitation instead of inventing an alert.",
  ].join("\n");
  return {status:"ready",prompt,name:definition.name,
    intervalMinutes:definition.trigger.schedule.everyMinutes};
}
