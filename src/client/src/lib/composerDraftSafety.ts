/**
 * The original editor is authoritative for unsent text. An async send may
 * clear only the exact draft it observed, never newer typing or an unrelated
 * draft present while a retried message is submitted.
 */
export function clearSubmittedComposerDraft(current: string, original: string, submitted: string): string {
  return current === original && original.trim() === submitted.trim() ? "" : current;
}

/** Restore a failed request only when doing so cannot overwrite newer work. */
export function restoreFailedComposerDraft(current: string, original: string, submitted: string): string {
  if (current.trim()) return current;
  if (original.trim() && original.trim() !== submitted.trim()) return original;
  return submitted;
}

/** A keyboard/voice retry is not a fresh send of the text currently in the editor. */
export function mayClearComposerDraft(original: string, submitted: string, isContinuation: boolean): boolean {
  return !isContinuation && original.trim() === submitted.trim();
}
