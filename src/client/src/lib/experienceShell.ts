import { EXPERIENCE_SHELL_SURFACES, type ExperienceShellSurface } from "@shared/waveCContracts";
import type { ViewMode } from "./terminalTypes";

export const EXPERIENCE_SURFACE_STORAGE_KEY = "lios.experience.surface";
export const EXPERIENCE_SELECTED_FIELDS_STORAGE_KEY = "lios.waveC.selectedFields";
const SURFACE_EVENT = "lios:experience-surface";
const EXPLORE_FIELD_EVENT = "lios:experience-explore-field";

export const PRIMARY_EXPERIENCE_SURFACES = EXPERIENCE_SHELL_SURFACES.map((item) => item.id);

export function isExperienceShellSurface(value: unknown): value is ExperienceShellSurface {
  return EXPERIENCE_SHELL_SURFACES.some((item) => item.id === value);
}

export function loadExperienceSurface(): ExperienceShellSurface {
  if (typeof window === "undefined") return "projects";
  try {
    const stored = window.localStorage.getItem(EXPERIENCE_SURFACE_STORAGE_KEY);
    if (isExperienceShellSurface(stored)) {
      // Projects/Chats/Artifacts is the canonical authenticated entry. Preserve an
      // explicitly-entered Workbench across restarts, but legacy supporting
      // surfaces must never become a competing launch shell.
      return stored === "workbench" ? "workbench" : "projects";
    }
    if (stored !== null) {
      try { window.localStorage.removeItem(EXPERIENCE_SURFACE_STORAGE_KEY); } catch {}
    }
  } catch {
    // Hardened/private browser context: use the safe Projects entry surface.
  }
  return "projects";
}

export function saveExperienceSurface(surface: ExperienceShellSurface): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(EXPERIENCE_SURFACE_STORAGE_KEY, surface);
  } catch {
    // Surface navigation still works in-memory when persistence is unavailable.
  }
}

export function setExperienceSurface(surface: ExperienceShellSurface): void {
  saveExperienceSurface(surface);
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SURFACE_EVENT, { detail: surface }));
}

export function subscribeExperienceSurface(listener: (surface: ExperienceShellSurface) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    if (isExperienceShellSurface(event.detail)) listener(event.detail);
  };
  window.addEventListener(SURFACE_EVENT, handler);
  return () => window.removeEventListener(SURFACE_EVENT, handler);
}

export function requestExperienceField(fieldId: string): void {
  const normalized = fieldId.trim();
  if (!normalized || typeof window === "undefined") return;
  let current: string[] = [];
  try {
    const stored = JSON.parse(window.localStorage.getItem(EXPERIENCE_SELECTED_FIELDS_STORAGE_KEY) ?? "[]");
    current = Array.isArray(stored) ? stored.filter((value): value is string => typeof value === "string") : [];
  } catch {
    current = [];
  }
  const next = [...current.filter((value) => value !== normalized), normalized].slice(-6);
  try {
    window.localStorage.setItem(EXPERIENCE_SELECTED_FIELDS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Discovery still broadcasts when persistence is unavailable.
  }
  window.dispatchEvent(new CustomEvent(EXPLORE_FIELD_EVENT, { detail: normalized }));
}

export function subscribeExperienceField(listener: (fieldId: string) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    if (!(event instanceof CustomEvent) || typeof event.detail !== "string" || !event.detail.trim()) return;
    listener(event.detail.trim());
  };
  window.addEventListener(EXPLORE_FIELD_EVENT, handler);
  return () => window.removeEventListener(EXPLORE_FIELD_EVENT, handler);
}

export function surfaceForView(view: ViewMode): ExperienceShellSurface {
  if (view === "missioncontrol" || view === "morningbrief") return "pulse";
  if (view === "screener" || view === "news" || view === "market" || view === "entity" || view === "peercomp") return "explore";
  if (view === "alerts" || view === "regime" || view === "decisionengine") return "signals";
  if (view === "workspaces" || view === "research" || view === "spreadsheet" || view === "publishdesk") return "library";
  return "workbench";
}

export function isExperienceHomeSurface(surface: ExperienceShellSurface): boolean {
  return surface !== "workbench";
}
