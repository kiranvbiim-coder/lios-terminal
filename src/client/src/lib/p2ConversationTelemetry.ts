import type {
  ConversationCapabilityId,
  ConversationRuntimeEvent,
} from "@shared/conversationRuntime";

const STORAGE_KEY = "lios.p2.conversation-orchestration-telemetry.v1";

export interface P2ConversationTelemetrySnapshot {
  version: 1;
  counters: {
    plans: number;
    multiCapabilityPlans: number;
    needsInputCapabilities: number;
    approvalsRequired: number;
    dataGaps: number;
    completed: number;
    failed: number;
    cancelled: number;
  };
  capabilities: Partial<Record<ConversationCapabilityId, number>>;
  lastRecordedAt: number;
}

function emptySnapshot(): P2ConversationTelemetrySnapshot {
  return {
    version: 1,
    counters: {
      plans: 0,
      multiCapabilityPlans: 0,
      needsInputCapabilities: 0,
      approvalsRequired: 0,
      dataGaps: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    },
    capabilities: {},
    lastRecordedAt: Date.now(),
  };
}

export function loadP2ConversationTelemetry(): P2ConversationTelemetrySnapshot {
  if (typeof window === "undefined") return emptySnapshot();
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as Partial<P2ConversationTelemetrySnapshot> | null;
    if (!parsed || parsed.version !== 1) return emptySnapshot();
    const fallback = emptySnapshot();
    return {
      version: 1,
      counters: { ...fallback.counters, ...(parsed.counters ?? {}) },
      capabilities: parsed.capabilities ?? {},
      lastRecordedAt: parsed.lastRecordedAt ?? Date.now(),
    };
  } catch {
    return emptySnapshot();
  }
}

function persist(snapshot: P2ConversationTelemetrySnapshot): void {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot)); } catch { /* local diagnostics are non-critical */ }
}

export function recordP2ConversationEvent(event: ConversationRuntimeEvent): void {
  if (typeof window === "undefined") return;
  const snapshot = loadP2ConversationTelemetry();

  if (event.type === "plan") {
    snapshot.counters.plans += 1;
    if (event.plan.capabilities.length > 1) snapshot.counters.multiCapabilityPlans += 1;
    for (const capability of event.plan.capabilities) {
      snapshot.capabilities[capability.id] = (snapshot.capabilities[capability.id] ?? 0) + 1;
      if (capability.availability === "needs_input") snapshot.counters.needsInputCapabilities += 1;
    }
  } else if (event.type === "approval_required") {
    snapshot.counters.approvalsRequired += 1;
  } else if (event.type === "data_gap") {
    snapshot.counters.dataGaps += 1;
  } else if (event.type === "done") {
    if (event.status === "completed") snapshot.counters.completed += 1;
    else if (event.status === "failed") snapshot.counters.failed += 1;
    else if (event.status === "cancelled") snapshot.counters.cancelled += 1;
  }

  snapshot.lastRecordedAt = Date.now();
  persist(snapshot);
}

export const P2_CONVERSATION_TELEMETRY_PRIVACY_CONTRACT = Object.freeze({
  localOnly: true,
  storesPromptText: false,
  storesEntityQueries: false,
  storesSymbols: false,
  storesProjectNames: false,
  storesFileNames: false,
  storesFileContents: false,
  storesProviderNames: false,
  storesProviderCredentials: false,
  storesCapabilityIds: true,
  storesAggregateCounters: true,
});
