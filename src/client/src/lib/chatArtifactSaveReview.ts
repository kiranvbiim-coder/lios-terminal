import { conversationArtifactDraftSchema, type ConversationArtifactDraft } from "@shared/conversationRuntime";

/**
 * C06 display-side pre-save review. The server-owned P4 keeper alone can
 * authorize or persist this draft. This helper does not grant source rights,
 * assert execution, or turn missing lineage into implied verification.
 */
export type ChatArtifactSaveReview =
  | {status:"blocked";reason:string}
  | {status:"review";artifactId:string;title:string;kind:string;destination:string;
    sourceCount:number;receiptCount:number;hasSources:boolean;hasReceipts:boolean;
    disclosure:string};

export function reviewChatArtifactSave(
  artifact: ConversationArtifactDraft, requestId: string | null,
): ChatArtifactSaveReview {
  if(!requestId || !/^[0-9a-f-]{36}$/i.test(requestId))
    return {status:"blocked",reason:"A recorded Chat run is required before requesting Artifact persistence."};
  const result=conversationArtifactDraftSchema.safeParse(artifact);
  if(!result.success)return {status:"blocked",reason:"This Artifact draft failed the canonical runtime schema."};
  const item=result.data;
  if(item.persistence==="ephemeral")
    return {status:"blocked",reason:"This Artifact was only recorded as temporary, not approved as a save candidate."};
  if(item.persistence==="project_candidate" && item.projectId===null)
    return {status:"blocked",reason:"A Project-save candidate must name the exact Project."};
  const sourceCount=new Set(item.sourceRefs).size;
  const receiptCount=new Set(item.executionReceiptIds).size;
  return {
    status:"review",artifactId:item.artifactId,title:item.title,kind:item.artifactType,
    destination:item.persistence==="chat_candidate"?"The current saved Chat":`Project ${item.projectId}`,
    sourceCount,receiptCount,hasSources:sourceCount>0,hasReceipts:receiptCount>0,
    disclosure: sourceCount===0
      ? "No supporting source references were recorded. Saving does not establish source validity."
      : "Recorded source references are not proof of current entitlement, correctness or redistribution rights.",
  };
}

/** Snapshot key is for UI acknowledgement reset only; no cryptographic or
 * authorization semantics. A draft content change requires fresh review.
 */
export function chatArtifactSaveAcknowledgmentKey(artifact:ConversationArtifactDraft,requestId:string|null):string {
  return JSON.stringify([requestId,artifact]);
}
