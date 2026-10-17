const EVENT = "lios:open-decision-review";
let pendingDecisionId: number | null = null;

export function parseDecisionReviewId(value: unknown): number | null {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

/** Navigation only: no review, approval, receipt mutation or execution. */
export function openDecisionReview(decisionId: number): void {
  const id = parseDecisionReviewId(String(decisionId));
  if (id === null || typeof window === "undefined") return;
  pendingDecisionId = id;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { decisionId: String(id) } }));
}

export function takePendingDecisionReview(): number | null {
  const id = pendingDecisionId;
  pendingDecisionId = null;
  return id;
}

export function subscribeDecisionReview(listener: (id: number) => void): () => void {
  const handler = (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    const id = parseDecisionReviewId(event.detail?.decisionId);
    if (id === null) return;
    pendingDecisionId = null;
    listener(id);
  };
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
