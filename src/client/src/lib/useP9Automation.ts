import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "./queryClient";
import {
  createBrowserP9DesktopNotificationPort,
  deliverP9DesktopNotifications,
} from "./p9DesktopNotifications";
import type {
  P9NotificationPolicy,
  P9WorkflowAction,
  P9WorkflowDefinitionInput,
  P9WorkflowTemplate,
  P9WorkflowTrigger,
  P9AcceptedArtifact,
} from "@shared/p9AutomationContracts";
import type { ConversationRequest } from "@shared/conversationRuntime";

export interface P9WorkflowRecord {
  id: string;
  projectId: number;
  ownerUserId: number;
  organizationId: number | null;
  name: string;
  description: string;
  template: P9WorkflowTemplate;
  enabled: boolean;
  trigger: P9WorkflowTrigger;
  action: P9WorkflowAction;
  notificationPolicy: P9NotificationPolicy;
  sourceRefs: string[];
  engineRefs: string[];
  artifactRefs: string[];
  eventCursor: Record<string, unknown>;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  consecutiveFailures: number;
  createdAt: string;
  updatedAt: string;
}

export interface P9RunRecord {
  id: string;
  workflowId: string;
  projectId: number;
  triggerType: "manual" | "schedule" | "event";
  status: "running" | "succeeded" | "failed" | "skipped";
  startedAt: string;
  completedAt: string | null;
  summary: string | null;
  changed: boolean;
  conditionMet: boolean;
  relevanceScore: number;
  sourceRefs: string[];
  engineRefs: string[];
  artifactRefs: string[];
  executionReceiptIds: string[];
  output: Record<string, unknown>;
  error: string | null;
}

export interface P9NotificationRecord {
  id: string;
  workflowId: string;
  runId: string;
  projectId: number;
  channel: "in_app";
  status: "delivered" | "suppressed";
  reason: "success" | "failure" | "condition_met" | "change_detected";
  title: string;
  body: string;
  relevanceScore: number;
  readAt: string | null;
  createdAt: string;
}

async function json<T>(res: Response): Promise<T> {
  return res.json() as Promise<T>;
}

async function projectDeliveredNotificationsToDesktop(notifications: readonly P9NotificationRecord[]): Promise<void> {
  try {
    await deliverP9DesktopNotifications(notifications, createBrowserP9DesktopNotificationPort());
  } catch {
    // Desktop notification delivery is an optional local projection. It must
    // never fail the canonical P9 workflow, in-app history, or query refresh.
  }
}

export function useP9Workflows(projectId: number | null) {
  return useQuery<P9WorkflowRecord[]>({
    queryKey: ["/api/projects", projectId, "automation", "workflows"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/automation/workflows`);
      if (!res.ok) throw new Error("Failed to load Project workflows.");
      return res.json();
    },
    enabled: Boolean(projectId),
    refetchInterval: 30_000,
    refetchOnMount: "always",
  });
}

export function useP9Runs(projectId: number | null) {
  return useQuery<P9RunRecord[]>({
    queryKey: ["/api/projects", projectId, "automation", "runs"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/automation/runs?limit=100`);
      if (!res.ok) throw new Error("Failed to load workflow runs.");
      return res.json();
    },
    enabled: Boolean(projectId),
    refetchInterval: 30_000,
    refetchOnMount: "always",
  });
}

export function useP9Notifications(projectId: number | null) {
  return useQuery<P9NotificationRecord[]>({
    queryKey: ["/api/projects", projectId, "automation", "notifications"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/automation/notifications?limit=100`);
      if (!res.ok) throw new Error("Failed to load workflow notifications.");
      const notifications = await res.json() as P9NotificationRecord[];
      await projectDeliveredNotificationsToDesktop(notifications);
      return notifications;
    },
    enabled: Boolean(projectId),
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
    refetchOnMount: "always",
  });
}

export function useInvalidateP9Automation() {
  const qc = useQueryClient();
  return useCallback((projectId: number | null) => {
    if (!projectId) return;
    qc.invalidateQueries({ queryKey: ["/api/projects", projectId, "automation"] });
    qc.invalidateQueries({ queryKey: ["/api/projects", projectId, "continuity"] });
  }, [qc]);
}

export async function createP9Workflow(projectId: number, input: P9WorkflowDefinitionInput): Promise<P9WorkflowRecord> {
  return json(await apiRequest("POST", `/api/projects/${projectId}/automation/workflows`, input));
}

export async function replaceP9Workflow(projectId: number, workflowId: string, input: P9WorkflowDefinitionInput, expectedUpdatedAt?: string): Promise<P9WorkflowRecord> {
  return json(await apiRequest("PUT", `/api/projects/${projectId}/automation/workflows/${encodeURIComponent(workflowId)}`, { ...input, ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}) }));
}

export async function setP9WorkflowEnabled(projectId: number, workflowId: string, enabled: boolean, expectedUpdatedAt?: string): Promise<P9WorkflowRecord> {
  return json(await apiRequest("POST", `/api/projects/${projectId}/automation/workflows/${encodeURIComponent(workflowId)}/enabled`, { enabled, ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}) }));
}

export async function deleteP9Workflow(projectId: number, workflowId: string, expectedUpdatedAt?: string): Promise<void> {
  await apiRequest("DELETE", `/api/projects/${projectId}/automation/workflows/${encodeURIComponent(workflowId)}`, expectedUpdatedAt ? { expectedUpdatedAt } : undefined);
}

export interface P9ManualRunIdempotency {
  idempotencyKey: string;
  expectedUpdatedAt: string;
}

export async function runP9WorkflowNow(
  projectId: number,
  workflowId: string,
  idempotency?: P9ManualRunIdempotency,
) {
  const outcome = await json<{
    run: P9RunRecord | null;
    notification: P9NotificationRecord | null;
    result: Record<string, unknown> | null;
    error: string | null;
    replayed?: boolean;
    receiptStatus?: "in_progress" | "completed" | null;
  }>(await apiRequest("POST", `/api/projects/${projectId}/automation/workflows/${encodeURIComponent(workflowId)}/run`, idempotency ?? {}));
  if (outcome.notification && !outcome.replayed) {
    await projectDeliveredNotificationsToDesktop([outcome.notification]);
  }
  return outcome;
}

export async function markP9NotificationRead(projectId: number, notificationId: string): Promise<P9NotificationRecord> {
  return json(await apiRequest("POST", `/api/projects/${projectId}/automation/notifications/${encodeURIComponent(notificationId)}/read`, {}));
}

export async function saveConversationAsP9Workflow(projectId: number, input: {
  name: string;
  description?: string;
  template?: P9WorkflowTemplate;
  chatId: number;
  sourceRequestId: string;
  request: Omit<ConversationRequest, "requestId" | "continuationOf">;
  acceptedArtifact?: P9AcceptedArtifact;
  currentPersonalFinanceResourceId?: string;
  trigger: P9WorkflowTrigger;
  notificationPolicy?: P9NotificationPolicy;
  sourceRefs?: string[];
  engineRefs?: string[];
  artifactRefs?: string[];
  enabled?: boolean;
}): Promise<P9WorkflowRecord> {
  return json(await apiRequest("POST", `/api/projects/${projectId}/automation/save-conversation`, input));
}
