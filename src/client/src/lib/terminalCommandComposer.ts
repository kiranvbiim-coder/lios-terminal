import type { AnalyticalOpenMode } from "./terminalActionContracts";
import type { ViewMode } from "./terminalTypes";
import { parseFlexibleTerminalCommand } from "./terminalIntentCommands";
import { getTerminalCapability } from "./terminalCatalog";

export interface ComposedCommandStep {
  id: string;
  raw: string;
  view: ViewMode;
  symbol?: string;
  openMode: AnalyticalOpenMode;
  label: string;
}

export interface ComposedWorkflow {
  id: string;
  name: string;
  source: string;
  steps: ComposedCommandStep[];
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = "limuria-terminal-command-composer-v1";
const EVENT_NAME = "lios:command-composer";

function id(prefix: string): string {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function parseCommandSequence(source: string, activeSymbol?: string): ComposedCommandStep[] {
  let symbol = activeSymbol?.trim().toUpperCase();
  return source
    .split(/(?:->|→|\n|;)/)
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((raw, index) => {
      const parsed = parseFlexibleTerminalCommand(raw);
      if (!parsed) {
        if (/^[A-Z][A-Z0-9.\-]{0,15}$/i.test(raw)) {
          symbol = raw.toUpperCase();
          return [];
        }
        return [];
      }
      if (parsed.symbol) symbol = parsed.symbol.trim().toUpperCase();
      const capability = getTerminalCapability(parsed.view);
      return [{
        id: id(`step-${index}`),
        raw,
        view: parsed.view,
        symbol: capability.symbolAware ? (parsed.symbol ?? symbol) : undefined,
        openMode: index === 0 ? "current" : "tab",
        label: capability.label,
      } satisfies ComposedCommandStep];
    });
}

export function createComposedWorkflow(name: string, source: string, activeSymbol?: string): ComposedWorkflow {
  const now = Date.now();
  return { id: id("workflow"), name: name.trim().slice(0, 80) || "Untitled Workflow", source: source.trim().slice(0, 2000), steps: parseCommandSequence(source, activeSymbol).slice(0, 30), createdAt: now, updatedAt: now };
}

export function loadComposedWorkflows(): ComposedWorkflow[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]") as ComposedWorkflow[];
    return Array.isArray(parsed) ? parsed.sort((a, b) => b.updatedAt - a.updatedAt) : [];
  } catch { return []; }
}

export function saveComposedWorkflow(workflow: ComposedWorkflow): void {
  if (typeof window === "undefined") return;
  const next = [{ ...workflow, updatedAt: Date.now() }, ...loadComposedWorkflows().filter((item) => item.id !== workflow.id)].slice(0, 60);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: next }));
}

export function removeComposedWorkflow(workflowId: string): void {
  if (typeof window === "undefined") return;
  const next = loadComposedWorkflows().filter((item) => item.id !== workflowId);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: next }));
}

export function subscribeComposedWorkflows(listener: (items: ComposedWorkflow[]) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => listener(loadComposedWorkflows());
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
