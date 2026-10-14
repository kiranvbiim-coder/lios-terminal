import type { ViewMode } from "./terminalTypes";
import { getExperienceViewLabel } from "./terminalExperience";
import { getTerminalCapability } from "./terminalCatalog";

export interface RecentAnalyticalContext {
  key: string;
  view: ViewMode;
  symbol: string;
  label: string;
  lastOpenedAt: number;
}

const FAVORITES_KEY = "limuria-terminal-favorites-v1";
const RECENTS_KEY = "limuria-terminal-analytical-recents-v1";
const MAX_RECENTS = 24;

function normalizeSymbol(symbol: string | null | undefined): string {
  return (symbol ?? "").trim().toUpperCase().slice(0, 32);
}

function contextualSymbol(view: ViewMode, symbol: string | null | undefined): string {
  return getTerminalCapability(view).symbolAware ? normalizeSymbol(symbol) : "";
}

export function analyticalContextKey(view: ViewMode, symbol?: string | null): string {
  return `${contextualSymbol(view, symbol) || "GLOBAL"}:${view}`;
}

export function toggleTerminalFavorite(favorites: readonly ViewMode[], view: ViewMode): ViewMode[] {
  return favorites.includes(view)
    ? favorites.filter((candidate) => candidate !== view)
    : [view, ...favorites];
}

export function recordRecentAnalyticalContext(
  recents: readonly RecentAnalyticalContext[],
  view: ViewMode,
  symbol?: string | null,
  timestamp = Date.now(),
): RecentAnalyticalContext[] {
  const normalizedSymbol = contextualSymbol(view, symbol);
  const key = analyticalContextKey(view, normalizedSymbol);
  const label = normalizedSymbol
    ? `${normalizedSymbol} · ${getExperienceViewLabel(view)}`
    : getExperienceViewLabel(view);

  return [
    { key, view, symbol: normalizedSymbol, label, lastOpenedAt: timestamp },
    ...recents.filter((item) => item.key !== key),
  ].slice(0, MAX_RECENTS);
}

export function loadTerminalFavorites(): ViewMode[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is ViewMode => typeof value === "string").slice(0, 24);
  } catch {
    return [];
  }
}

export function saveTerminalFavorites(favorites: readonly ViewMode[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...new Set(favorites)].slice(0, 24)));
}

export function loadRecentAnalyticalContexts(): RecentAnalyticalContext[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((value): value is RecentAnalyticalContext => Boolean(
        value && typeof value === "object" &&
        typeof (value as RecentAnalyticalContext).key === "string" &&
        typeof (value as RecentAnalyticalContext).view === "string" &&
        typeof (value as RecentAnalyticalContext).symbol === "string" &&
        typeof (value as RecentAnalyticalContext).label === "string" &&
        typeof (value as RecentAnalyticalContext).lastOpenedAt === "number",
      ))
      .slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

export function saveRecentAnalyticalContexts(recents: readonly RecentAnalyticalContext[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(RECENTS_KEY, JSON.stringify(recents.slice(0, MAX_RECENTS)));
}

export function clearTerminalPersonalization(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(FAVORITES_KEY);
  localStorage.removeItem(RECENTS_KEY);
}
