import type { ViewMode } from "./terminalTypes";

export type ChangeSeverity = "info" | "material" | "critical";
export type ChangeDirection = "up" | "down" | "changed" | "added" | "removed";
export type ComparableValue = string | number | boolean | null;

export interface AnalyticalSnapshot {
  id: string;
  view: ViewMode;
  symbol: string;
  label: string;
  capturedAt: number;
  values: Record<string, ComparableValue>;
  metadata: Record<string, string>;
}

export interface AnalyticalChange {
  key: string;
  before: ComparableValue | undefined;
  after: ComparableValue | undefined;
  direction: ChangeDirection;
  severity: ChangeSeverity;
  absoluteDelta?: number;
  percentDelta?: number;
}

export interface AnalyticalContextChange {
  contextKey: string;
  view: ViewMode;
  symbol: string;
  label: string;
  capturedAt: number;
  previousCapturedAt: number;
  changes: AnalyticalChange[];
  criticalCount: number;
  materialCount: number;
}

const STORAGE_KEY = "limuria-terminal-change-snapshots-v1";
const EVENT_NAME = "lios:change-intelligence";
const MAX_SNAPSHOTS = 160;

function contextKey(view: ViewMode, symbol?: string): string {
  return `${view}:${(symbol ?? "").trim().toUpperCase()}`;
}

function loadAll(): Record<string, AnalyticalSnapshot[]> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as Record<string, AnalyticalSnapshot[]>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch { return {}; }
}

function saveAll(all: Record<string, AnalyticalSnapshot[]>): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
}

function id(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `snapshot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function stableObject(value: Record<string, ComparableValue> | Record<string, string>): string {
  return JSON.stringify(Object.keys(value).sort().map((key) => [key, value[key]]));
}

export function analyticalSnapshotFingerprint(snapshot: Pick<AnalyticalSnapshot, "view" | "symbol" | "values" | "metadata">): string {
  return `${snapshot.view}|${snapshot.symbol.trim().toUpperCase()}|${stableObject(snapshot.values)}|${stableObject(snapshot.metadata)}`;
}

export function captureAnalyticalSnapshot(input: Omit<AnalyticalSnapshot, "id" | "capturedAt" | "symbol"> & { symbol?: string }): AnalyticalSnapshot {
  const snapshot: AnalyticalSnapshot = {
    ...input,
    id: id(),
    symbol: (input.symbol ?? "").trim().toUpperCase(),
    capturedAt: Date.now(),
    values: { ...input.values },
    metadata: { ...input.metadata },
  };
  if (typeof window === "undefined") return snapshot;
  const all = loadAll();
  const key = contextKey(snapshot.view, snapshot.symbol);
  const existing = all[key]?.[0];
  if (existing && analyticalSnapshotFingerprint(existing) === analyticalSnapshotFingerprint(snapshot)) return existing;
  all[key] = [snapshot, ...(all[key] ?? [])].slice(0, 12);
  const flattened = Object.entries(all)
    .flatMap(([keyName, snapshots]) => snapshots.map((item) => ({ keyName, item })))
    .sort((a, b) => b.item.capturedAt - a.item.capturedAt)
    .slice(0, MAX_SNAPSHOTS);
  const trimmed: Record<string, AnalyticalSnapshot[]> = {};
  for (const entry of flattened) (trimmed[entry.keyName] ??= []).push(entry.item);
  saveAll(trimmed);
  return snapshot;
}

export function getAnalyticalSnapshots(view: ViewMode, symbol?: string): AnalyticalSnapshot[] {
  return (loadAll()[contextKey(view, symbol)] ?? []).map((item) => ({ ...item, values: { ...item.values }, metadata: { ...item.metadata } }));
}

export function getLatestAnalyticalSnapshot(view: ViewMode, symbol?: string): AnalyticalSnapshot | null {
  return getAnalyticalSnapshots(view, symbol)[0] ?? null;
}

export function getAllAnalyticalSnapshots(): AnalyticalSnapshot[] {
  return Object.values(loadAll())
    .flat()
    .map((item) => ({ ...item, values: { ...item.values }, metadata: { ...item.metadata } }))
    .sort((a, b) => b.capturedAt - a.capturedAt);
}

function severityFor(before: ComparableValue | undefined, after: ComparableValue | undefined, percentDelta?: number): ChangeSeverity {
  if (before === undefined || after === undefined) return "material";
  if (typeof percentDelta === "number") {
    const size = Math.abs(percentDelta);
    if (size >= 20) return "critical";
    if (size >= 5) return "material";
  }
  return before === after ? "info" : "material";
}

export function diffAnalyticalSnapshots(before: AnalyticalSnapshot, after: AnalyticalSnapshot): AnalyticalChange[] {
  const keys = Array.from(new Set([...Object.keys(before.values), ...Object.keys(after.values)])).sort();
  return keys.flatMap((key) => {
    const left = before.values[key];
    const right = after.values[key];
    if (left === right) return [];
    let direction: ChangeDirection = left === undefined ? "added" : right === undefined ? "removed" : "changed";
    let absoluteDelta: number | undefined;
    let percentDelta: number | undefined;
    if (typeof left === "number" && typeof right === "number") {
      absoluteDelta = right - left;
      if (left !== 0) percentDelta = (absoluteDelta / Math.abs(left)) * 100;
      direction = absoluteDelta > 0 ? "up" : absoluteDelta < 0 ? "down" : "changed";
    }
    return [{ key, before: left, after: right, direction, absoluteDelta, percentDelta, severity: severityFor(left, right, percentDelta) }];
  });
}

export function getChangesSincePrevious(view: ViewMode, symbol?: string): AnalyticalChange[] {
  const snapshots = getAnalyticalSnapshots(view, symbol);
  return snapshots.length >= 2 ? diffAnalyticalSnapshots(snapshots[1], snapshots[0]) : [];
}

export function getRecentAnalyticalContextChanges(limit = 40): AnalyticalContextChange[] {
  return Object.entries(loadAll())
    .flatMap(([key, snapshots]) => {
      if (snapshots.length < 2) return [];
      const changes = diffAnalyticalSnapshots(snapshots[1], snapshots[0]);
      if (!changes.length) return [];
      const latest = snapshots[0];
      return [{
        contextKey: key,
        view: latest.view,
        symbol: latest.symbol,
        label: latest.label,
        capturedAt: latest.capturedAt,
        previousCapturedAt: snapshots[1].capturedAt,
        changes,
        criticalCount: changes.filter((change) => change.severity === "critical").length,
        materialCount: changes.filter((change) => change.severity === "material").length,
      }];
    })
    .sort((a, b) => (b.criticalCount - a.criticalCount) || (b.materialCount - a.materialCount) || (b.capturedAt - a.capturedAt))
    .slice(0, Math.max(1, limit));
}

export function subscribeChangeIntelligence(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => listener();
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
