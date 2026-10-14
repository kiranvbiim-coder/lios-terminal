import type { ViewMode } from "./terminalTypes";

export type TerminalLaunchPath = "sidebar" | "omnibox" | "ribbon" | "tool-graph" | "recent" | "favorite" | "macro" | "mission" | "context-menu" | "shortcut" | "other";

export interface TerminalTelemetryCounters {
  launches: Partial<Record<TerminalLaunchPath, number>>;
  capabilityLaunches: Partial<Record<ViewMode, number>>;
  noResultSearches: number;
  restoredTabs: number;
  restoreFailures: number;
  linkedContextChanges: number;
  completedMissions: number;
}

export interface TerminalTimingSummary {
  count: number;
  totalMs: number;
  maxMs: number;
}

export interface TerminalTelemetrySnapshot {
  counters: TerminalTelemetryCounters;
  timings: Record<string, TerminalTimingSummary>;
  firstRecordedAt: number;
  lastRecordedAt: number;
}

const STORAGE_KEY = "limuria-terminal-ux-metrics-v1";
const MAX_TIMING_KEYS = 40;

function emptySnapshot(): TerminalTelemetrySnapshot {
  const now = Date.now();
  return {
    counters: {
      launches: {},
      capabilityLaunches: {},
      noResultSearches: 0,
      restoredTabs: 0,
      restoreFailures: 0,
      linkedContextChanges: 0,
      completedMissions: 0,
    },
    timings: {},
    firstRecordedAt: now,
    lastRecordedAt: now,
  };
}

export function loadTerminalTelemetry(): TerminalTelemetrySnapshot {
  if (typeof window === "undefined") return emptySnapshot();
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as Partial<TerminalTelemetrySnapshot> | null;
    if (!parsed?.counters || !parsed.timings) return emptySnapshot();
    return {
      counters: {
        launches: parsed.counters.launches ?? {},
        capabilityLaunches: parsed.counters.capabilityLaunches ?? {},
        noResultSearches: parsed.counters.noResultSearches ?? 0,
        restoredTabs: parsed.counters.restoredTabs ?? 0,
        restoreFailures: parsed.counters.restoreFailures ?? 0,
        linkedContextChanges: parsed.counters.linkedContextChanges ?? 0,
        completedMissions: parsed.counters.completedMissions ?? 0,
      },
      timings: parsed.timings ?? {},
      firstRecordedAt: parsed.firstRecordedAt ?? Date.now(),
      lastRecordedAt: parsed.lastRecordedAt ?? Date.now(),
    };
  } catch {
    return emptySnapshot();
  }
}

function persist(snapshot: TerminalTelemetrySnapshot): void {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot)); } catch { /* local-only metrics are non-critical */ }
}

export function recordCapabilityLaunch(view: ViewMode, path: TerminalLaunchPath): void {
  const snapshot = loadTerminalTelemetry();
  snapshot.counters.launches[path] = (snapshot.counters.launches[path] ?? 0) + 1;
  snapshot.counters.capabilityLaunches[view] = (snapshot.counters.capabilityLaunches[view] ?? 0) + 1;
  snapshot.lastRecordedAt = Date.now();
  persist(snapshot);
}

export function incrementTerminalMetric(metric: "noResultSearches" | "restoredTabs" | "restoreFailures" | "linkedContextChanges" | "completedMissions", amount = 1): void {
  const snapshot = loadTerminalTelemetry();
  snapshot.counters[metric] += amount;
  snapshot.lastRecordedAt = Date.now();
  persist(snapshot);
}

export function recordTerminalTiming(key: string, durationMs: number): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  const safeKey = key.trim().slice(0, 80);
  if (!safeKey) return;
  const snapshot = loadTerminalTelemetry();
  const current = snapshot.timings[safeKey] ?? { count: 0, totalMs: 0, maxMs: 0 };
  snapshot.timings[safeKey] = {
    count: current.count + 1,
    totalMs: current.totalMs + durationMs,
    maxMs: Math.max(current.maxMs, durationMs),
  };
  const entries = Object.entries(snapshot.timings);
  if (entries.length > MAX_TIMING_KEYS) {
    const trimmed = entries.slice(entries.length - MAX_TIMING_KEYS);
    snapshot.timings = Object.fromEntries(trimmed);
  }
  snapshot.lastRecordedAt = Date.now();
  persist(snapshot);
}

export function terminalTimingAverage(summary: TerminalTimingSummary | undefined): number | null {
  return summary?.count ? summary.totalMs / summary.count : null;
}

export function clearTerminalTelemetry(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Deliberately absent from this API: raw command text, note content, uploaded
 * data, model inputs, client names, API keys, and provider credentials.
 */
export const TERMINAL_TELEMETRY_PRIVACY_CONTRACT = Object.freeze({
  localOnlyByDefault: true,
  storesRawQueries: false,
  storesUserData: false,
  storesModelInputs: false,
  storesNotes: false,
  remoteAggregateOnlyWhenEnabled: true,
  remoteStoresCapabilityNames: false,
  remoteStoresRawStacks: false,
});


interface RemoteDiagnosticsConfig {
  enabled: boolean;
  retentionDays: number;
  acceptsRawContent: boolean;
}

let diagnosticsConfigCache: { value: RemoteDiagnosticsConfig; expiresAt: number } | null = null;

async function remoteDiagnosticsConfig(): Promise<RemoteDiagnosticsConfig> {
  if (typeof window === "undefined") return { enabled: false, retentionDays: 0, acceptsRawContent: false };
  if (diagnosticsConfigCache && diagnosticsConfigCache.expiresAt > Date.now()) return diagnosticsConfigCache.value;
  try {
    const response = await fetch("/api/client/diagnostics/config", { cache: "no-store" });
    if (!response.ok) throw new Error("diagnostics config unavailable");
    const value = await response.json() as RemoteDiagnosticsConfig;
    const safe = {
      enabled: value.enabled === true,
      retentionDays: Number.isFinite(value.retentionDays) ? value.retentionDays : 0,
      acceptsRawContent: false,
    };
    diagnosticsConfigCache = { value: safe, expiresAt: Date.now() + 10 * 60_000 };
    return safe;
  } catch {
    return { enabled: false, retentionDays: 0, acceptsRawContent: false };
  }
}

async function postRemoteDiagnostic(payload: Record<string, unknown>): Promise<boolean> {
  const config = await remoteDiagnosticsConfig();
  if (!config.enabled || config.acceptsRawContent) return false;
  try {
    const response = await fetch("/api/client/diagnostics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function buildRemoteTelemetryAggregate(snapshot: TerminalTelemetrySnapshot): Record<string, unknown> {
  const launchCount = Object.values(snapshot.counters.launches).reduce((sum, value) => sum + (value ?? 0), 0);
  const timingSummaries = Object.values(snapshot.timings);
  const timingCount = timingSummaries.reduce((sum, item) => sum + item.count, 0);
  const maxTimingMs = timingSummaries.reduce((max, item) => Math.max(max, item.maxMs), 0);
  return {
    category: "performance",
    eventName: "terminal.aggregate",
    severity: snapshot.counters.restoreFailures > 0 ? "warning" : "info",
    details: {
      screen: "terminal",
      operation: "aggregate",
      launchCount,
      failureCount: snapshot.counters.restoreFailures,
      noResultCount: snapshot.counters.noResultSearches,
      linkedContextChanges: snapshot.counters.linkedContextChanges,
      completedMissions: snapshot.counters.completedMissions,
      timingCount,
      maxTimingMs,
    },
  };
}

export async function flushTerminalTelemetryAggregate(): Promise<boolean> {
  return postRemoteDiagnostic(buildRemoteTelemetryAggregate(loadTerminalTelemetry()));
}

async function sha256Hex(value: string): Promise<string | null> {
  if (typeof crypto === "undefined" || !crypto.subtle) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function reportTerminalCrash(error: unknown, code = "terminal_unhandled_error"): Promise<boolean> {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : typeof error;
  const stack = error instanceof Error ? error.stack ?? "" : "";
  const fingerprint = await sha256Hex(`${name}|${message}|${stack}`);
  return postRemoteDiagnostic({
    category: "crash",
    eventName: code,
    severity: "error",
    ...(fingerprint ? { fingerprint } : {}),
    details: {
      screen: "terminal",
      code,
      recoverable: true,
    },
  });
}
