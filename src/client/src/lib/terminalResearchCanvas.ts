export interface ResearchCanvasPosition {
  itemId: string;
  x: number;
  y: number;
  updatedAt: number;
}

const STORAGE_KEY = "limuria-terminal-research-canvas-v1";
const EVENT_NAME = "lios:research-canvas";

function clamp(value: number): number { return Math.max(2, Math.min(88, value)); }

export function loadResearchCanvasPositions(): Record<string, ResearchCanvasPosition> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as Record<string, ResearchCanvasPosition>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch { return {}; }
}

export function setResearchCanvasPosition(itemId: string, x: number, y: number): void {
  if (typeof window === "undefined") return;
  const all = loadResearchCanvasPositions();
  all[itemId] = { itemId, x: clamp(x), y: clamp(y), updatedAt: Date.now() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
}

export function removeResearchCanvasPosition(itemId: string): void {
  if (typeof window === "undefined") return;
  const all = loadResearchCanvasPositions();
  delete all[itemId];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
}

export function subscribeResearchCanvas(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => listener();
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
