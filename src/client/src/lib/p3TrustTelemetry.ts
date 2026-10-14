import type { TrustManifest } from "@shared/trustContracts";

const STORAGE_KEY = "lios.p3.trust-telemetry.v1";

export interface P3TrustTelemetrySnapshot {
  version: 1;
  counters: {
    manifests: number;
    lowConfidence: number;
    lowQuality: number;
    conflicts: number;
    missingEvidence: number;
    showWorkOpened: number;
    recoveryActions: number;
  };
  lastRecordedAt: number;
}

function emptySnapshot(): P3TrustTelemetrySnapshot {
  return {
    version: 1,
    counters: {
      manifests: 0,
      lowConfidence: 0,
      lowQuality: 0,
      conflicts: 0,
      missingEvidence: 0,
      showWorkOpened: 0,
      recoveryActions: 0,
    },
    lastRecordedAt: Date.now(),
  };
}

export function loadP3TrustTelemetry(): P3TrustTelemetrySnapshot {
  if (typeof window === "undefined") return emptySnapshot();
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as Partial<P3TrustTelemetrySnapshot> | null;
    if (!parsed || parsed.version !== 1) return emptySnapshot();
    const fallback = emptySnapshot();
    return {
      version: 1,
      counters: { ...fallback.counters, ...(parsed.counters ?? {}) },
      lastRecordedAt: parsed.lastRecordedAt ?? Date.now(),
    };
  } catch {
    return emptySnapshot();
  }
}

function persist(snapshot: P3TrustTelemetrySnapshot): void {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot)); } catch { /* local aggregate diagnostics only */ }
}

export function recordP3TrustManifest(manifest: TrustManifest): void {
  if (typeof window === "undefined") return;
  const snapshot = loadP3TrustTelemetry();
  snapshot.counters.manifests += 1;
  if (manifest.summary.confidence === "low" || manifest.summary.confidence === "unknown") snapshot.counters.lowConfidence += 1;
  if (manifest.summary.quality === "low" || manifest.summary.quality === "unknown") snapshot.counters.lowQuality += 1;
  if (manifest.summary.conflictState === "minor" || manifest.summary.conflictState === "material") snapshot.counters.conflicts += 1;
  if (manifest.summary.missingCount > 0) snapshot.counters.missingEvidence += 1;
  snapshot.lastRecordedAt = Date.now();
  persist(snapshot);
}

export function recordP3TrustInteraction(kind: "show_work_opened" | "recovery_action"): void {
  if (typeof window === "undefined") return;
  const snapshot = loadP3TrustTelemetry();
  if (kind === "show_work_opened") snapshot.counters.showWorkOpened += 1;
  else snapshot.counters.recoveryActions += 1;
  snapshot.lastRecordedAt = Date.now();
  persist(snapshot);
}

export const P3_TRUST_TELEMETRY_PRIVACY_CONTRACT = Object.freeze({
  localOnly: true,
  storesPromptText: false,
  storesSourceRefs: false,
  storesProviderNames: false,
  storesSymbols: false,
  storesProjectNames: false,
  storesFileNames: false,
  storesFileContents: false,
  storesAssumptionValues: false,
  storesCredentials: false,
  storesOnlyAggregateCounters: true,
});
