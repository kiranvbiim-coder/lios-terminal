import {
  safeWorkspaceActionSchema,
  workspaceActionNeedsConfirmation,
  type SafeWorkspaceAction,
} from "@shared/projectContracts";

const EVENT = "lios:safe-workspace-action";

export interface SafeWorkspaceActionRequest {
  id: string;
  source: "assistant" | "user" | "system";
  action: SafeWorkspaceAction;
  requiresConfirmation: boolean;
  requestedAt: string;
}

function actionId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `workspace-action-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function requestSafeWorkspaceAction(
  action: SafeWorkspaceAction,
  source: SafeWorkspaceActionRequest["source"] = "assistant",
): SafeWorkspaceActionRequest | null {
  if (typeof window === "undefined") return null;
  const parsed = safeWorkspaceActionSchema.parse(action);
  const request: SafeWorkspaceActionRequest = {
    id: actionId(),
    source,
    action: parsed,
    requiresConfirmation: workspaceActionNeedsConfirmation(parsed),
    requestedAt: new Date().toISOString(),
  };
  window.dispatchEvent(new CustomEvent(EVENT, { detail: request }));
  return request;
}

export function subscribeSafeWorkspaceActions(
  listener: (request: SafeWorkspaceActionRequest) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    if (!(event instanceof CustomEvent) || !event.detail) return;
    const detail = event.detail as SafeWorkspaceActionRequest;
    const parsed = safeWorkspaceActionSchema.safeParse(detail.action);
    if (!parsed.success) return;
    listener({
      ...detail,
      action: parsed.data,
      requiresConfirmation: workspaceActionNeedsConfirmation(parsed.data),
    });
  };
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
