import { stableSerialize } from "./analyticalCore";

/** JSONB may reorder keys; an acknowledged own save must not erase edits made after submission. */
export function reconcileTerminalDraft(incoming: unknown, draft: unknown, baseline: string, submitted: string | null) {
  const incomingKey = stableSerialize(incoming);
  const draftKey = stableSerialize(draft);
  if (submitted !== null && incomingKey === submitted) {
    return { baseline: incomingKey, replaceDraft: draftKey === submitted, acknowledged: true, conflict: false };
  }
  if (draftKey === baseline) return { baseline: incomingKey, replaceDraft: true, acknowledged: false, conflict: false };
  return { baseline, replaceDraft: false, acknowledged: false, conflict: incomingKey !== baseline };
}
