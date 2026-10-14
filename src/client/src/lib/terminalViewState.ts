import type { ViewMode } from "./terminalTypes";

export type TerminalViewState = Record<string, unknown>;

const STORAGE_KEY = "lios-terminal-view-state-v1";
const EVENT_NAME = "lios:terminal-view-state";
const MAX_ENTRY_BYTES = 12_000;
const MAX_ENTRIES = 180;

interface StoredEntry {
  state: TerminalViewState;
  updatedAt: number;
}

type StoredMap = Record<string, StoredEntry>;

function keyFor(view: ViewMode | string, symbol?: string): string {
  return `${view}:${(symbol ?? "").trim().toUpperCase()}`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isSafeJsonValue(value: unknown, depth = 0): boolean {
  if (depth > 6) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 120 && value.every((item) => isSafeJsonValue(item, depth + 1));
  if (!isPlainRecord(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= 80 && entries.every(([key, item]) => key.length <= 100 && isSafeJsonValue(item, depth + 1));
}

function sanitizeState(value: unknown): TerminalViewState {
  if (!isPlainRecord(value) || !isSafeJsonValue(value)) return {};
  try {
    if (JSON.stringify(value).length > MAX_ENTRY_BYTES) return {};
  } catch {
    return {};
  }
  return value;
}

function loadAll(): StoredMap {
  if (typeof window === "undefined") return {};
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}");
    if (!isPlainRecord(parsed)) return {};
    const entries = Object.entries(parsed).flatMap(([key, value]) => {
      if (!isPlainRecord(value) || typeof value.updatedAt !== "number") return [];
      const state = sanitizeState(value.state);
      return Object.keys(state).length ? [[key, { state, updatedAt: value.updatedAt }] as const] : [];
    });
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

function saveAll(all: StoredMap): void {
  if (typeof window === "undefined") return;
  const trimmed = Object.entries(all)
    .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
    .slice(0, MAX_ENTRIES);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(trimmed)));
    window.dispatchEvent(new CustomEvent(EVENT_NAME));
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}

export function loadTerminalViewState(view: ViewMode | string, symbol?: string): TerminalViewState {
  return loadAll()[keyFor(view, symbol)]?.state ?? {};
}

export function saveTerminalViewState(view: ViewMode | string, symbol: string | undefined, state: TerminalViewState): TerminalViewState {
  const safe = sanitizeState(state);
  if (!Object.keys(safe).length) return {};
  const all = loadAll();
  all[keyFor(view, symbol)] = { state: safe, updatedAt: Date.now() };
  saveAll(all);
  return safe;
}

export function patchTerminalViewState(view: ViewMode | string, symbol: string | undefined, patch: TerminalViewState): TerminalViewState {
  return saveTerminalViewState(view, symbol, { ...loadTerminalViewState(view, symbol), ...patch });
}

export function restoreTerminalViewStates(entries: Array<{ view: string; symbol: string; state: TerminalViewState }>): void {
  if (typeof window === "undefined") return;
  const all = loadAll();
  const timestamp = Date.now();
  for (const entry of entries) {
    const state = sanitizeState(entry.state);
    if (!Object.keys(state).length) continue;
    all[keyFor(entry.view, entry.symbol)] = { state, updatedAt: timestamp };
  }
  saveAll(all);
}

export function clearTerminalViewState(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}
