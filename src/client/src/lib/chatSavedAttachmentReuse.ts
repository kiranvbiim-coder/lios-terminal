import { conversationAttachmentRefSchema, type ConversationAttachmentRef } from "@shared/conversationRuntime";

export const MAX_CHAT_FILES_PER_TURN = 5;

/** PR #102: saved metadata is not custody; the server reauthorizes every reused reference. */
export function savedChatAttachmentRefs(metadata: unknown): ConversationAttachmentRef[] {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  const attachments = (metadata as Record<string, unknown>).attachments;
  if (!Array.isArray(attachments)) return [];
  const seen = new Set<string>();
  return attachments.flatMap((value): ConversationAttachmentRef[] => {
    const parsed = conversationAttachmentRefSchema.safeParse(value && typeof value === "object" && !Array.isArray(value) ? { textPreview: null, ...value } : value);
    if (!parsed.success) return [];
    const reference = parsed.data;
    if (reference.sourceRef !== `quick-attachment:${reference.id}` && reference.sourceRef !== `project-attachment:${reference.id}`) return [];
    if (seen.has(reference.id)) return [];
    seen.add(reference.id);
    return [reference];
  });
}

export type SavedAttachmentStageResult =
  | { status: "added"; refs: ConversationAttachmentRef[] }
  | { status: "already_staged" | "limit_reached" | "invalid"; refs: ConversationAttachmentRef[] };

/** Stages only; never sends or grants data rights. */
export function stageSavedAttachmentForFollowUp(existing: readonly ConversationAttachmentRef[], candidate: unknown, pendingFiles: number): SavedAttachmentStageResult {
  const refs = [...existing];
  const parsed = conversationAttachmentRefSchema.safeParse(candidate);
  if (!parsed.success || (parsed.data.sourceRef !== `quick-attachment:${parsed.data.id}` && parsed.data.sourceRef !== `project-attachment:${parsed.data.id}`)) return { status: "invalid", refs };
  if (refs.some(item => item.id === parsed.data.id)) return { status: "already_staged", refs };
  if (!Number.isInteger(pendingFiles) || pendingFiles < 0 || refs.length + pendingFiles >= MAX_CHAT_FILES_PER_TURN) return { status: "limit_reached", refs };
  return { status: "added", refs: [...refs, parsed.data] };
}
