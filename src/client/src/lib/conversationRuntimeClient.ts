import type {
  AITransmissionPolicy,
  ApprovalGrant,
  ConversationActionName,
  GovernedToolReviewDecision,
} from "@shared/conversationRuntime";
import { DEFAULT_AI_TRANSMISSION_POLICY, aiTransmissionPolicySchema } from "@shared/conversationRuntime";


const POLICY_PREFIX = "lios.project.ai-transmission-policy.";
const APPROVAL_PREFIX = "lios.project.runtime-approvals.";

function safeReadJson(key: string): unknown {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function loadProjectAITransmissionPolicy(projectId: number | null): AITransmissionPolicy {
  if (!projectId) return DEFAULT_AI_TRANSMISSION_POLICY;
  const parsed = aiTransmissionPolicySchema.safeParse(safeReadJson(`${POLICY_PREFIX}${projectId}`));
  return parsed.success ? parsed.data : DEFAULT_AI_TRANSMISSION_POLICY;
}

export function saveProjectAITransmissionPolicy(projectId: number, policy: AITransmissionPolicy): AITransmissionPolicy {
  const parsed = aiTransmissionPolicySchema.parse(policy);
  try {
    window.localStorage.setItem(`${POLICY_PREFIX}${projectId}`, JSON.stringify(parsed));
  } catch {}
  return parsed;
}

export function loadProjectApprovalGrants(projectId: number | null): ApprovalGrant[] {
  if (!projectId) return [];
  const raw = safeReadJson(`${APPROVAL_PREFIX}${projectId}`);
  if (!Array.isArray(raw)) return [];
  const actions: ConversationActionName[] = [
    "OpenArtifact", "OpenPanel", "ChangeAssumption", "RunValuation", "RunBacktest",
    "CreateScenario", "ForkSession", "InspectSource", "SaveWorkflow", "AIDirectEstimate",
  ];
  const allowed = new Set(actions);
  const result: ApprovalGrant[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const action = (item as { action?: unknown }).action;
    if (typeof action === "string" && allowed.has(action as ConversationActionName)) {
      result.push({ action: action as ConversationActionName, scope: "project" });
    }
  }
  return result;
}

export function saveProjectApproval(projectId: number, action: ConversationActionName): ApprovalGrant[] {
  const current = loadProjectApprovalGrants(projectId);
  if (!current.some((grant) => grant.action === action)) current.push({ action, scope: "project" });
  try {
    window.localStorage.setItem(`${APPROVAL_PREFIX}${projectId}`, JSON.stringify(current));
  } catch {}
  return current;
}

export function revokeProjectApproval(projectId: number, action: ConversationActionName): ApprovalGrant[] {
  const next = loadProjectApprovalGrants(projectId).filter((grant) => grant.action !== action);
  try {
    window.localStorage.setItem(`${APPROVAL_PREFIX}${projectId}`, JSON.stringify(next));
  } catch {}
  return next;
}

/**
 * GM-11a: the server is the authority for approvals. These calls record and read them; the localStorage list above is
 * only a view of what the server holds (and the source of a one-time migration), and a request never carries grants.
 */
const APPROVAL_MIGRATED_PREFIX = "lios.project.runtime-approvals.migrated.";

export async function recordApprovalOnServer(input: {
  action: ConversationActionName;
  scope: ApprovalGrant["scope"];
  requestId: string;
  projectId: number | null;
}): Promise<void> {
  const res = await fetch("/api/conversation/approvals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: input.action,
      scope: input.scope,
      ...(input.scope === "once" ? { requestId: input.requestId } : { projectId: input.projectId }),
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? "The approval could not be saved. Try again.");
  }
}

/**
 * SI-02 L4 exact governed-tool review.
 * The renderer sends only the opaque server review id + human decision. Tool,
 * step, plan, input, policy and authorization identities never cross back from
 * the client.
 */
export async function reviewGovernedToolOnServer(input: {
  requestId: string;
  reviewId: string;
  decision: GovernedToolReviewDecision;
}): Promise<void> {
  const res = await fetch(`/api/conversation-executions/${encodeURIComponent(input.requestId)}/governed-tool-review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reviewId: input.reviewId, decision: input.decision }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? "The governed tool review could not be applied. Try again.");
  }
}

export async function revokeApprovalOnServer(projectId: number, action: ConversationActionName): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}/conversation-approvals/${action}`, { method: "DELETE" });
  if (!res.ok) throw new Error("The approval could not be revoked. Try again.");
}

async function fetchServerGrants(projectId: number): Promise<ApprovalGrant[] | null> {
  try {
    const res = await fetch(`/api/projects/${projectId}/conversation-approvals`);
    if (!res.ok) return null;
    const body = await res.json() as { grants?: ApprovalGrant[] };
    return Array.isArray(body.grants) ? body.grants : null;
  } catch {
    return null;
  }
}

function writeApprovalCache(projectId: number, grants: ApprovalGrant[]): void {
  try {
    window.localStorage.setItem(`${APPROVAL_PREFIX}${projectId}`, JSON.stringify(grants));
  } catch {}
}

/** Moves any pre-GM-11 browser-held Project grants to the server once, then makes the browser list mirror the server. */
export async function syncProjectApprovalGrants(projectId: number): Promise<ApprovalGrant[]> {
  const migratedKey = `${APPROVAL_MIGRATED_PREFIX}${projectId}`;
  let migrated = false;
  try { migrated = window.localStorage.getItem(migratedKey) === "1"; } catch {}
  if (!migrated) {
    const legacy = loadProjectApprovalGrants(projectId);
    try {
      for (const grant of legacy) await recordApprovalOnServer({ action: grant.action, scope: "project", requestId: "", projectId });
      try { window.localStorage.setItem(migratedKey, "1"); } catch {}
    } catch {
      // Leave the legacy list in place and try again next time; nothing is trusted from it in the meantime.
    }
  }
  const server = await fetchServerGrants(projectId);
  if (server) writeApprovalCache(projectId, server);
  return server ?? loadProjectApprovalGrants(projectId);
}

export function createConversationRequestId(): string {
  return crypto.randomUUID();
}

