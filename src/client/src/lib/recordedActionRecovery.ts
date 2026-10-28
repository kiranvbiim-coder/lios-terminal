import type {ConversationRuntimeEvent} from "@shared/conversationRuntime";

export interface RecordedActionRecovery {
  failedToolReports: number;
  deniedToolReports: number;
  unfinishedToolStarts: number;
  failedReceipts: number;
  cancelledReceipts: number;
  ignoredForeignReceipts: number;
  /** We can only report, never prove, what happened outside LiOS. */
  needsReconciliation: boolean;
}

/**
 * C08: explicit per-run evidence of partial tool execution.
 * A "done:completed" run cannot override a failed/denied last tool report.
 * Duplicate receipt IDs do not inflate a failure count; cross-run receipts
 * cannot establish success or failure for the current Chat. No execution here.
 */
export function inspectRecordedActionRecovery(
  events: readonly ConversationRuntimeEvent[], requestId: string | null,
): RecordedActionRecovery {
  const empty:RecordedActionRecovery={failedToolReports:0,deniedToolReports:0,
    unfinishedToolStarts:0,failedReceipts:0,cancelledReceipts:0,
    ignoredForeignReceipts:0,needsReconciliation:false};
  if(!requestId) return empty;
  const latest=new Map<string,{type:"start"|"result";outcome?:string}>();
  const receipts=new Set<string>();
  let failedReceipts=0,cancelledReceipts=0,ignoredForeignReceipts=0;
  for(const event of events) {
    if(event.requestId!==requestId) continue;
    if(event.type==="tool_start" && event.stepId)
      latest.set(event.stepId,{type:"start"});
    if(event.type==="tool_result" && event.stepId)
      latest.set(event.stepId,{type:"result",outcome:event.outcome});
    if(event.type==="receipt") {
      const receipt=event.receipt;
      if(receipt.requestId!==requestId) {ignoredForeignReceipts++;continue;}
      if(receipts.has(receipt.id)) continue;
      receipts.add(receipt.id);
      if(receipt.status==="failed") failedReceipts++;
      if(receipt.status==="cancelled") cancelledReceipts++;
    }
  }
  const last=[...latest.values()];
  const failedToolReports=last.filter(x=>x.type==="result"&&x.outcome==="failed").length;
  const deniedToolReports=last.filter(x=>x.type==="result"&&x.outcome==="denied").length;
  const unfinishedToolStarts=last.filter(x=>x.type==="start").length;
  return {
    failedToolReports,deniedToolReports,unfinishedToolStarts,
    failedReceipts,cancelledReceipts,ignoredForeignReceipts,
    needsReconciliation:failedToolReports+deniedToolReports+unfinishedToolStarts+
      failedReceipts+cancelledReceipts+ignoredForeignReceipts>0,
  };
}
